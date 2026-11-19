const fs = require('node:fs/promises');
const nativeFs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHash, randomUUID } = require('node:crypto');
const { spawn } = require('node:child_process');
const { createInterface } = require('node:readline');
const { audioResponse } = require('./audio-response.cjs');
const { directFormats, containerFormats, importFormats, audioDuration, convertAudio } = require('./transcription-media.cjs');
const { TranscriptionStudy, normalize, tidy } = require('./transcription-study.cjs');
const { transcriptionTools } = require('./native-runtime.cjs');

const languages = ['pt', 'en', 'es', 'auto'];
const projectId = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const models = new Map([['fast', 'ggml-base-q5_1.bin'], ['accurate', 'ggml-small-q5_1.bin']]);
const maxTextLength = 5000;
const markCategories = new Set(['important', 'question', 'example']);

function publicSummary({ id, name, duration, createdAt, segments, course }) {
  return { id, name, duration, createdAt, course: course ?? '', segmentCount: segments.length };
}

function publicProject(project) {
  return { ...publicSummary(project), language: project.language, segments: project.segments, marks: project.marks ?? [], audioUrl: `lume://app/transcription-audio/${project.id}` };
}

function timestamp(ms) {
  const parts = [Math.floor(ms / 3600000), Math.floor(ms / 60000) % 60, Math.floor(ms / 1000) % 60];
  return `${parts.map(part => String(part).padStart(2, '0')).join(':')},${String(ms % 1000).padStart(3, '0')}`;
}

function readRange(project, range) {
  const { first, last } = range ?? {};
  if (!Number.isInteger(first) || !Number.isInteger(last) || first < 0 || last < first || last >= project.segments.length) throw new Error('Selecione um intervalo válido.');
  const selected = project.segments.slice(first, last + 1);
  const startMs = selected[0].startMs;
  const endMs = Math.max(...selected.map(segment => segment.endMs));
  if (endMs <= startMs || endMs - startMs > 180000) throw new Error('Selecione um intervalo de até 3 minutos.');
  const version = createHash('sha256').update(JSON.stringify([project.id, first, last, selected])).digest('hex');
  return { first, last, startMs, endMs, version };
}

function runWhisper(engine, directory, args, job, report) {
  return new Promise((resolve, reject) => {
    const child = spawn(engine, args, { cwd: directory, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    job.child = child;
    const stderr = createInterface({ input: child.stderr });
    let diagnostics = '';
    stderr.on('line', line => {
      const found = /progress\s*=\s*(\d{1,3})%/.exec(line);
      if (found) report(Math.min(99, Number(found[1])));
      else diagnostics = `${diagnostics}\n${line}`.slice(-4000);
    });
    child.once('error', reject);
    child.once('close', code => {
      if (job.cancelled || code === 0) resolve();
      else {
        console.error(`Whisper (${code}): ${diagnostics}`);
        if ((code >>> 0) === 0xc0000135) {
          reject(new Error('O Whisper precisa do Microsoft Visual C++ Redistributable x64 para iniciar.'));
          return;
        }
        reject(new Error('O Whisper não conseguiu processar este áudio. Confira a gravação e tente novamente.'));
      }
    });
  });
}

class Transcriptions {
  constructor(userData, runtime, notify) {
    this.directory = path.join(userData, 'transcriptions');
    this.study = new TranscriptionStudy(this.directory);
    this.runtime = runtime;
    this.notify = notify;
    this.projects = new Map();
    this.job = null;
    try {
      for (const id of nativeFs.readdirSync(this.directory).filter(name => projectId.test(name))) {
        try {
          const data = JSON.parse(nativeFs.readFileSync(this.recordPath(id), 'utf8'));
          if (data.version !== 1 || data.id !== id || !directFormats.includes(data.extension) || !Array.isArray(data.segments) || typeof data.name !== 'string') continue;
          if (!Array.isArray(data.marks)) data.marks = [];
          this.projects.set(id, data);
        } catch (error) { if (error.code !== 'ENOENT') console.error('Estúdio: não foi possível abrir um projeto.', error); }
      }
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }

  projectDirectory(id) { return path.join(this.directory, id); }
  recordPath(id) { return path.join(this.projectDirectory(id), 'project.json'); }
  audioFile(project) { return `gravacao.${project.extension}`; }

  get(id) {
    const project = this.projects.get(id);
    if (!project) throw new Error('Projeto de transcrição não encontrado.');
    return project;
  }

  save(project) {
    const record = this.recordPath(project.id);
    const temporary = `${record}.tmp`;
    try {
      nativeFs.writeFileSync(temporary, JSON.stringify(project));
      nativeFs.renameSync(temporary, record);
    } catch (error) {
      try { nativeFs.rmSync(temporary, { force: true }); } catch { /* Preserve the original error. */ }
      throw error;
    }
    this.projects.set(project.id, project);
    return publicProject(project);
  }

  list() { return [...this.projects.values()].sort((a, b) => b.createdAt - a.createdAt).map(publicSummary); }
  open(id) { return publicProject(this.get(id)); }

  async importAudio(file) {
    if (this.job) throw new Error('Já há uma operação em andamento no Estúdio.');
    if (typeof file !== 'string' || !path.isAbsolute(file)) throw new Error('Escolha uma gravação válida.');
    const extension = path.extname(file).slice(1).toLowerCase();
    if (!importFormats.includes(extension)) throw new Error('Escolha um arquivo MP3, WAV, FLAC, MP4 ou M4A.');
    const convert = containerFormats.includes(extension);
    const id = randomUUID();
    const job = { id, cancelled: false, child: null };
    const directory = this.projectDirectory(id);
    const project = { version: 1, id, name: path.basename(file), extension: convert ? 'flac' : extension, createdAt: Date.now(), language: null, segments: [], marks: [] };
    const audio = path.join(directory, this.audioFile(project));
    this.job = job;
    let saved = false;
    try {
      const info = await fs.stat(file);
      if (!info.isFile() || !info.size) throw new Error('Escolha um arquivo de gravação válido.');
      if (info.size > (convert ? 2 * 1024 : 700) * 1024 ** 2) throw new Error(convert ? 'Escolha um MP4 ou M4A de até 2 GB.' : 'Escolha um áudio de até 700 MB.');
      if (!convert) project.duration = await audioDuration(file);
      if (job.cancelled) return null;
      await fs.mkdir(directory, { recursive: true });
      if (convert) {
        await convertAudio(this.runtime, file, audio, job);
        if (job.cancelled) return null;
        project.duration = await audioDuration(audio);
      } else await fs.copyFile(file, audio, nativeFs.constants.COPYFILE_EXCL);
      if (job.cancelled) return null;
      const result = this.save(project);
      saved = true;
      return result;
    } finally {
      if (!saved) await fs.rm(directory, { recursive: true, force: true }).catch(() => {});
      this.job = null;
    }
  }

  async transcribe(id, language, quality = 'accurate', range = null) {
    if (this.job) throw new Error('Já há uma operação em andamento no Estúdio.');
    const project = this.get(id);
    const interval = range === null ? null : readRange(project, range);
    if (!languages.includes(language)) throw new Error('Idioma inválido.');
    const modelName = models.get(quality);
    if (!modelName) throw new Error('Qualidade de transcrição inválida.');
    const job = { id, cancelled: false, child: null };
    this.job = job;
    const directory = this.projectDirectory(id);
    const prefix = `whisper-${randomUUID()}`;
    const stagedModel = `${prefix}.bin`;
    const output = path.join(directory, `${prefix}.json`);
    const clip = `${prefix}.flac`;
    const engine = transcriptionTools(this.runtime).whisper;
    const sourceModel = path.join(this.runtime, modelName);
    const report = (phase, percent) => { if (!job.cancelled) this.notify({ id, phase, percent }); };
    try {
      report('preparing', 0);
      const available = await Promise.all([fs.access(engine), fs.access(sourceModel)]).then(() => true, () => false);
      if (!available) throw new Error('O componente de transcrição não está instalado nesta cópia do Lume.');
      // Relative, ASCII-only arguments also work when the Windows profile has a name outside the system code page.
      const localModel = path.join(directory, stagedModel);
      await fs.link(sourceModel, localModel).catch(() => fs.copyFile(sourceModel, localModel, nativeFs.constants.COPYFILE_EXCL));
      if (interval && !job.cancelled) await convertAudio(this.runtime, path.join(directory, this.audioFile(project)), path.join(directory, clip), job, interval);
      if (job.cancelled) return null;
      const terms = this.study.terms(project.course);
      // The Windows CLI reads narrow argv. Use ASCII hints and keep the user's spelling in matched terms.
      const prompt = terms.join(', ').normalize('NFD').replace(/\p{M}/gu, '').replace(/[^\x20-\x7e]/g, '').slice(0, 500);
      const spellings = new Map(terms.filter(term => /^[\p{L}\p{M}\p{N}-]+$/u.test(term)).map(term => [normalize(term), term]));
      report('transcribing', 0);
      await runWhisper(engine, directory, [
        '-m', stagedModel, '-f', interval ? clip : this.audioFile(project), '-l', language, '-t', String(Math.max(1, Math.min(6, os.availableParallelism() - 1))),
        ...(prompt ? ['--prompt', prompt] : []),
        '-ng', '-oj', '-of', prefix, '-pp',
      ], job, percent => report('transcribing', percent));
      if (job.cancelled) return null;

      const data = await fs.readFile(output, 'utf8').then(JSON.parse).catch(() => null);
      if (!Array.isArray(data?.transcription)) throw new Error('O Whisper não conseguiu gerar uma transcrição para este áudio.');
      const durationMs = interval ? interval.endMs - interval.startMs : Math.ceil(project.duration * 1000);
      const segments = data.transcription.flatMap(({ offsets, text }) => {
        if (!Number.isSafeInteger(offsets?.from) || !Number.isSafeInteger(offsets?.to) || typeof text !== 'string' || !text.trim()) return [];
        const startMs = Math.max(0, offsets.from);
        const endMs = Math.min(offsets.to, durationMs);
        const formatted = text.trim().replace(/[\p{L}\p{M}\p{N}-]+/gu, word => spellings.get(normalize(word)) ?? word);
        return endMs > startMs ? [{ startMs, endMs, text: formatted.slice(0, maxTextLength) }] : [];
      }).sort((a, b) => a.startMs - b.startMs);
      if (job.cancelled) return null;
      if (!segments.length) throw new Error('Nenhuma fala foi encontrada. Confira o áudio ou tente outro idioma.');
      if (interval) return { ...interval, segments: segments.map(segment => ({
        ...segment, startMs: interval.startMs + segment.startMs, endMs: interval.startMs + segment.endMs,
      })) };
      const result = { ...project, language: data.result?.language || language, segments };
      return project.segments.length ? await this.saveRevision(result, job) : this.save(result);
    } catch (error) {
      if (job.cancelled) return null;
      throw error;
    } finally {
      const temporary = [output, path.join(directory, stagedModel)];
      if (interval) temporary.push(path.join(directory, clip));
      await Promise.all(temporary.map(file => fs.rm(file, { force: true }).catch(() => {})));
      this.job = null;
    }
  }

  async saveRevision(result, job) {
    const sourceId = result.id;
    const familyId = result.familyId || sourceId;
    const original = path.parse(result.originalName || result.name);
    const revision = [...this.projects.values()].reduce((next, item) => item.familyId === familyId
      ? Math.max(next, item.revision + 1)
      : next, 2);
    const project = {
      ...result, id: randomUUID(), familyId, originalName: original.base, revision,
      name: `${original.name} (versão ${revision})${original.ext}`, createdAt: Date.now(),
    };
    const source = path.join(this.projectDirectory(sourceId), this.audioFile(result));
    const directory = this.projectDirectory(project.id);
    await fs.mkdir(directory);
    try {
      // The files live on the same volume and the recording is never modified in place.
      const destination = path.join(directory, this.audioFile(project));
      await fs.link(source, destination).catch(() => fs.copyFile(source, destination, nativeFs.constants.COPYFILE_EXCL));
      if (!job.cancelled) return this.save(project);
      await fs.rm(directory, { recursive: true, force: true });
      return null;
    } catch (error) {
      await fs.rm(directory, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
  }

  cancel(id) {
    if (!this.job || (id !== undefined && this.job.id !== id)) return;
    this.job.cancelled = true;
    this.job.child?.kill();
  }

  edit(id, index, text) {
    const project = this.get(id);
    if (this.job?.id === id || !Number.isInteger(index) || !project.segments[index] || typeof text !== 'string' || text.length > maxTextLength) throw new Error('Trecho inválido.');
    const segments = [...project.segments];
    segments[index] = { ...segments[index], text: text.trim() };
    return this.save({ ...project, segments });
  }

  replaceRange(id, value) {
    const project = this.get(id);
    if (this.job?.id === id) throw new Error('Aguarde a conclusão da transcrição.');
    const range = readRange(project, value);
    if (range.version !== value?.version) throw new Error('Este trecho mudou. Gere uma nova sugestão.');
    const replacement = value.segments;
    if (!Array.isArray(replacement) || !replacement.length || replacement.length > 1000 || replacement.some((segment, index) =>
      !Number.isSafeInteger(segment?.startMs) || !Number.isSafeInteger(segment.endMs) || segment.startMs < range.startMs ||
      segment.endMs > range.endMs || segment.endMs <= segment.startMs || (index > 0 && segment.startMs < replacement[index - 1].startMs) ||
      typeof segment.text !== 'string' || segment.text.length > maxTextLength)) throw new Error('A correção contém trechos inválidos.');
    const edited = replacement.map(({ startMs, endMs, text }) => ({ startMs, endMs, text: text.trim() })).filter(segment => segment.text);
    if (!edited.length) throw new Error('Digite o texto corrigido.');
    const segments = [...project.segments];
    segments.splice(range.first, range.last - range.first + 1, ...edited);
    return this.save({ ...project, segments });
  }

  organize(id, course) {
    const project = this.get(id);
    if (this.job?.id === id || typeof course !== 'string' || course.length > 80) throw new Error('Disciplina inválida.');
    const name = tidy(course);
    const existing = [...this.projects.values()].find(item => item.course && normalize(item.course) === normalize(name));
    return this.save({ ...project, course: existing?.course || name });
  }

  search(query, course) {
    if (typeof query !== 'string' || query.length > 200 || typeof course !== 'string' || course.length > 80) throw new Error('Busca inválida.');
    const terms = normalize(tidy(query)).split(' ').filter(Boolean);
    if (!terms.length) return [];
    const scope = normalize(tidy(course));
    const hits = [];
    for (const item of this.list()) {
      if (scope && normalize(item.course) !== scope) continue;
      for (const segment of this.get(item.id).segments) {
        const content = normalize(segment.text);
        if (!terms.every(term => content.includes(term))) continue;
        hits.push({ ...segment, projectId: item.id, lesson: item.name, course: item.course });
        if (hits.length === 150) return hits;
      }
    }
    return hits;
  }

  saveGlossary(id, text) { return this.study.glossary(this.get(id).course, text); }

  card(id, markId, value) {
    const project = this.get(id);
    const mark = project.marks?.find(item => item.id === markId);
    if (!mark) throw new Error('Marcação não encontrada.');
    return this.study.card(project, mark, value);
  }

  cards() {
    return this.study.cards().map(card => {
      const source = this.projects.get(card.projectId);
      return { ...card, course: source ? source.course || '' : card.course, available: !!source };
    });
  }

  saveMark(id, markId, input) {
    const project = this.get(id);
    if (this.job?.id === id) throw new Error('Aguarde a conclusão da transcrição.');
    if (!markCategories.has(input?.category) || typeof input.note !== 'string' || input.note.length > 2000) throw new Error('Anotação inválida.');
    const marks = project.marks ?? [];
    const details = { category: input.category, note: input.note.trim() };
    const previous = marks.find(mark => mark.id === markId);
    if (markId !== null) {
      if (!previous) throw new Error('Marcação não encontrada.');
      return this.save({ ...project, marks: marks.map(mark => mark.id === markId ? { ...mark, ...details } : mark) });
    }
    const segment = Number.isInteger(input.segmentIndex) ? project.segments[input.segmentIndex] : null;
    if (!segment || marks.length >= 2000) throw new Error('Trecho inválido ou limite de marcações atingido.');
    const { startMs, endMs, text } = segment;
    const mark = { id: randomUUID(), startMs, endMs, text, ...details };
    return this.save({ ...project, marks: [...marks, mark].sort((a, b) => a.startMs - b.startMs) });
  }

  removeMark(id, markId) {
    const project = this.get(id);
    if (this.job?.id === id) throw new Error('Aguarde a conclusão da transcrição.');
    const marks = (project.marks ?? []).filter(mark => mark.id !== markId);
    return this.save({ ...project, marks });
  }

  exportText(id, format) {
    const segments = this.get(id).segments.filter(segment => segment.text.trim());
    if (!segments.length) throw new Error('A transcrição não tem texto para exportar.');
    if (format === 'txt') return segments.map(segment => segment.text.replace(/\r?\n/g, '\r\n')).join('\r\n\r\n') + '\r\n';
    if (format === 'srt') return segments.map(({ startMs, endMs, text }, index) => {
      const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
      return [`${index + 1}`, `${timestamp(startMs)} --> ${timestamp(endMs)}`, ...lines].join('\r\n');
    }).join('\r\n\r\n') + '\r\n';
    throw new Error('Formato de exportação inválido.');
  }

  async remove(id) {
    const project = this.get(id);
    if (this.job?.id === id) throw new Error('Cancele a transcrição antes de excluir este projeto.');
    const directory = this.projectDirectory(project.id);
    const removed = path.join(this.directory, `.deleted-${project.id}`);
    // Rename first so it cannot reopen as a partially deleted project.
    nativeFs.renameSync(directory, removed);
    this.projects.delete(id);
    await fs.rm(removed, { recursive: true, force: true, maxRetries: 3 }).catch(error => console.error('Estúdio: não foi possível limpar os arquivos excluídos.', error));
    return this.list();
  }

  response(id, request) {
    const project = this.projects.get(id);
    return audioResponse(project && path.join(this.projectDirectory(project.id), this.audioFile(project)), request);
  }
}

module.exports = { Transcriptions };
