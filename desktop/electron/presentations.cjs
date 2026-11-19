const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { audioResponse } = require('./audio-response.cjs');

const ratings = ['clarity', 'organization', 'knowledge', 'pace'];
const idPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;

function text(value, limit, required = false) {
  if (typeof value !== 'string' || value.length > limit || value.includes('\0')) throw new Error('Confira os campos da apresentação.');
  const clean = value.trim();
  if (required && !clean) throw new Error('Informe o título da apresentação e dos tópicos.');
  return clean;
}

function projectDraft(value) {
  if (!Array.isArray(value?.sections) || !value.sections.length || value.sections.length > 100) throw new Error('Organize o roteiro com 1 a 100 tópicos.');
  const sections = value.sections.map(section => {
    if (!Number.isInteger(section.seconds) || section.seconds < 1 || section.seconds > 86400) throw new Error('Informe um tempo válido para cada tópico.');
    return { title: text(section.title, 150, true), notes: text(section.notes, 20000), seconds: section.seconds };
  });
  return { title: text(value.title, 200, true), course: text(value.course, 150), audience: text(value.audience, 300), sections };
}

function assessment(value) {
  const clean = { notes: text(value?.notes, 6000) };
  for (const key of ratings) {
    if (!Number.isInteger(value[key]) || value[key] < 0 || value[key] > 5) throw new Error('Use notas de 1 a 5 ou deixe o critério sem avaliar.');
    clean[key] = value[key];
  }
  return clean;
}

function clock(ms) {
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}min ${String(total % 60).padStart(2, '0')}s`;
}

class Presentations {
  constructor(userData) {
    this.directory = path.join(userData, 'presentations');
    this.file = path.join(this.directory, 'projects.json');
    this.data = { version: 1, projects: [] };
    this.active = null;
    try {
      const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (saved?.version !== 1 || !Array.isArray(saved.projects)) throw new Error('Formato inválido.');
      const ids = new Set();
      for (const project of saved.projects) {
        if (!idPattern.test(project.id) || ids.has(project.id) || !Array.isArray(project.takes) || !Number.isFinite(Date.parse(project.updatedAt))) throw new Error('Projeto inválido.');
        ids.add(project.id);
        projectDraft(project);
        for (const take of project.takes) {
          if (!idPattern.test(take.id) || ids.has(take.id) || !['running', 'paused', 'finished', 'interrupted'].includes(take.status)) throw new Error('Ensaio inválido.');
          ids.add(take.id);
          projectDraft(take.script);
          if (!Number.isFinite(take.durationMs) || take.durationMs < 0 || !Array.isArray(take.sectionMs) || take.sectionMs.length !== take.script.sections.length || take.sectionMs.some(value => !Number.isFinite(value) || value < 0)) throw new Error('Tempos do ensaio inválidos.');
          if (!Number.isFinite(Date.parse(take.createdAt)) || typeof take.audio !== 'boolean') throw new Error('Registro do ensaio inválido.');
          assessment(take.assessment);
        }
      }
      this.data = saved;
      const recovering = saved.projects.some(project => project.takes.some(take => ['running', 'paused'].includes(take.status)));
      if (recovering) {
        const next = structuredClone(saved);
        for (const project of next.projects) for (const take of project.takes) if (['running', 'paused'].includes(take.status)) take.status = 'interrupted';
        this.commit(next);
      }
    } catch (error) {
      if (error.code !== 'ENOENT') this.problem = 'Não foi possível ler os ensaios. Confira a pasta presentations nos dados do Lume.';
    }
  }

  commit(next) {
    if (this.problem) throw new Error(this.problem);
    fs.mkdirSync(this.directory, { recursive: true });
    const temporary = this.file + '.' + randomUUID() + '.tmp';
    try {
      fs.writeFileSync(temporary, JSON.stringify(next), { flag: 'wx', encoding: 'utf8' });
      fs.renameSync(temporary, this.file);
    } catch (error) {
      try { fs.unlinkSync(temporary); } catch { /* Mantém o erro da gravação. */ }
      throw error;
    }
    this.data = next;
  }

  project(id, data = this.data) {
    if (this.problem) throw new Error(this.problem);
    const project = data.projects.find(project => project.id === id);
    if (!project) throw new Error('Apresentação não encontrada.');
    return project;
  }

  findTake(id, data = this.data) {
    for (const project of data.projects) {
      const take = project.takes.find(take => take.id === id);
      if (take) return take;
    }
    throw new Error('Ensaio não encontrado.');
  }

  audioFile(id) {
    if (!idPattern.test(id)) throw new Error('Ensaio inválido.');
    return path.join(this.directory, id + '.webm');
  }

  availableAudio(take) {
    try { return take.audio && fs.statSync(this.audioFile(take.id)).size > 0; } catch { return false; }
  }

  read() {
    if (this.problem) throw new Error(this.problem);
    const projects = structuredClone(this.data.projects);
    for (const project of projects) for (const take of project.takes) {
      take.audioUrl = this.availableAudio(take) ? `lume://app/presentation-audio/${take.id}` : null;
    }
    return projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  save(id, value) {
    if (this.active?.projectId === id) throw new Error('Finalize o ensaio antes de editar o roteiro.');
    const draft = projectDraft(value);
    const next = structuredClone(this.data);
    const previous = id === null ? null : this.project(id, next);
    const project = { ...draft, id: previous?.id ?? randomUUID(), takes: previous?.takes ?? [], updatedAt: new Date().toISOString() };
    next.projects = previous ? next.projects.map(item => item.id === id ? project : item) : [...next.projects, project];
    this.commit(next);
    return this.read();
  }

  remove(id) {
    if (this.active?.projectId === id) throw new Error('Finalize o ensaio antes de excluir a apresentação.');
    const project = this.project(id);
    const next = structuredClone(this.data);
    next.projects = next.projects.filter(item => item.id !== id);
    this.commit(next);
    for (const take of project.takes) {
      try { fs.unlinkSync(this.audioFile(take.id)); } catch (error) { if (error.code !== 'ENOENT') console.warn('Não foi possível limpar o áudio excluído:', error.message); }
    }
    return this.read();
  }

  begin(projectId, audio) {
    if (this.active) throw new Error('Já existe um ensaio em andamento.');
    if (typeof audio !== 'boolean') throw new Error('Escolha um modo de gravação válido.');
    const next = structuredClone(this.data);
    const project = this.project(projectId, next);
    const take = {
      id: randomUUID(), createdAt: new Date().toISOString(), script: projectDraft(project),
      durationMs: 0, sectionMs: project.sections.map(() => 0), status: 'paused', audio,
      assessment: { clarity: 0, organization: 0, knowledge: 0, pace: 0, notes: '' },
    };
    project.takes.unshift(take);
    this.commit(next);
    this.active = { projectId, id: take.id, section: 0, status: 'paused', elapsed: 0, sections: [...take.sectionMs], since: performance.now(), nextChunk: 0 };
    return structuredClone(take);
  }

  capture(id) {
    const active = this.active;
    if (!active || active.id !== id) throw new Error('Este ensaio não está em andamento.');
    const now = performance.now();
    if (active.status === 'running') {
      const delta = now - active.since;
      active.elapsed += delta;
      active.sections[active.section] += delta;
    }
    active.since = now;
    return active;
  }

  checkpoint(id) {
    const active = this.capture(id);
    const next = structuredClone(this.data);
    const take = this.findTake(id, next);
    take.durationMs = active.elapsed;
    take.sectionMs = [...active.sections];
    take.status = active.status;
    this.commit(next);
    return { durationMs: active.elapsed, section: active.section, sectionMs: [...active.sections] };
  }

  pause(id, paused) {
    if (typeof paused !== 'boolean') throw new Error('Estado de pausa inválido.');
    const active = this.capture(id);
    active.status = paused ? 'paused' : 'running';
    return this.checkpoint(id);
  }

  section(id, index) {
    const active = this.capture(id);
    if (!Number.isInteger(index) || index < 0 || index >= active.sections.length) throw new Error('Tópico inválido.');
    const previous = active.section;
    active.section = index;
    try { return this.checkpoint(id); }
    catch (error) { active.section = previous; throw error; }
  }

  append(id, index, bytes) {
    const active = this.active;
    if (!active || active.id !== id || !this.findTake(id).audio) throw new Error('Gravação indisponível.');
    if (!Number.isSafeInteger(index) || index < 0 || index > active.nextChunk || !(bytes instanceof Uint8Array) || bytes.byteLength > 32 * 1024 * 1024) throw new Error('Trecho de áudio inválido.');
    if (index < active.nextChunk) return;
    if (!bytes.byteLength) throw new Error('O trecho de áudio está vazio.');
    let fd;
    try { fd = fs.openSync(this.audioFile(id), 'r+'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; fd = fs.openSync(this.audioFile(id), 'wx+'); }
    const previous = fs.fstatSync(fd).size;
    try {
      let written = 0;
      while (written < bytes.byteLength) {
        const count = fs.writeSync(fd, bytes, written, bytes.byteLength - written, previous + written);
        if (!count) throw new Error('Não foi possível gravar o áudio.');
        written += count;
      }
      active.nextChunk++;
    } catch (error) {
      fs.ftruncateSync(fd, previous);
      throw error;
    } finally { fs.closeSync(fd); }
  }

  finish(id, interrupted = false) {
    const active = this.capture(id);
    const next = structuredClone(this.data);
    const take = this.findTake(id, next);
    take.durationMs = active.elapsed;
    take.sectionMs = [...active.sections];
    take.status = interrupted ? 'interrupted' : 'finished';
    this.project(active.projectId, next).updatedAt = new Date().toISOString();
    this.commit(next);
    this.active = null;
    return this.read();
  }

  cancel(id) {
    const active = this.capture(id);
    const next = structuredClone(this.data);
    const project = this.project(active.projectId, next);
    project.takes = project.takes.filter(take => take.id !== id);
    this.commit(next);
    this.active = null;
    try { fs.unlinkSync(this.audioFile(id)); } catch (error) { if (error.code !== 'ENOENT') console.warn(error.message); }
    return this.read();
  }

  assess(id, value) {
    if (this.active?.id === id) throw new Error('Finalize o ensaio antes da autoavaliação.');
    const next = structuredClone(this.data);
    this.findTake(id, next).assessment = assessment(value);
    this.commit(next);
    return this.read();
  }

  removeTake(id) {
    if (this.active?.id === id) throw new Error('Finalize o ensaio antes de excluir.');
    this.findTake(id);
    const next = structuredClone(this.data);
    for (const project of next.projects) project.takes = project.takes.filter(take => take.id !== id);
    this.commit(next);
    try { fs.unlinkSync(this.audioFile(id)); } catch (error) { if (error.code !== 'ENOENT') console.warn(error.message); }
    return this.read();
  }

  response(id, request) {
    let take;
    try { take = this.findTake(id); } catch { return new Response('Ensaio não encontrado', { status: 404 }); }
    return audioResponse(this.availableAudio(take) ? this.audioFile(id) : null, request);
  }

  report(id) {
    const take = this.findTake(id);
    const { script } = take;
    const planned = script.sections.reduce((sum, section) => sum + section.seconds * 1000, 0);
    const lines = [
      `# ${script.title}`, '', `Ensaio de ${new Date(take.createdAt).toLocaleString('pt-BR')}`,
      `Disciplina: ${script.course || 'Não informada'}`, `Público: ${script.audience || 'Não informado'}`, '',
      `Tempo previsto: ${clock(planned)}`, `Tempo realizado: ${clock(take.durationMs)}`,
      `Estado: ${take.status === 'interrupted' ? 'Interrompido' : 'Finalizado'}`, '',
      '## Roteiro e tempos', '',
    ];
    script.sections.forEach((section, index) => {
      lines.push(`### ${section.title}`, `Previsto: ${clock(section.seconds * 1000)} · Realizado: ${clock(take.sectionMs[index])}`, section.notes, '');
    });
    lines.push('## Autoavaliação', '');
    for (const [key, label] of Object.entries({ clarity: 'Clareza', organization: 'Organização', knowledge: 'Domínio do conteúdo', pace: 'Ritmo' })) lines.push(`- ${label}: ${take.assessment[key] ? take.assessment[key] + '/5' : 'Sem avaliação'}`);
    lines.push('', '### O que melhorar', take.assessment.notes, '');
    return lines.join('\n');
  }
}

module.exports = { Presentations };
