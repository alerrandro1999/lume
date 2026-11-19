const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');
const { randomUUID, createHash } = require('node:crypto');
const yazl = require('yazl');
const yauzl = require('yauzl');
const { validateStudyExtras } = require('./study.cjs');
const { validOcrPage, validReadingOrder } = require('./notebook.cjs');
const hashPattern = /^[a-f0-9]{64}$/;
const bookPattern = /^([a-f0-9]{64})\.(pdf|epub)$/;
const equalPath = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
async function exists(file) { try { return (await fsp.stat(file)).isFile(); } catch { return false; } }
async function hashFile(file, signal) { const hash = createHash('sha256'); for await (const chunk of fs.createReadStream(file, { signal })) hash.update(chunk); return hash.digest('hex'); }
function safeJson(data) {
  const text = Buffer.isBuffer(data) ? data.toString('utf8') : data;
  return JSON.parse(text, (key, value) => { if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('Pacote contém uma estrutura inválida.'); return value; });
}
function validateManifest(manifest) {
  if (manifest?.kind !== 'lume-backup' || manifest.version !== 1 || !Array.isArray(manifest.documents) || manifest.documents.length > 500 || !Array.isArray(manifest.archived) || manifest.archived.length > 20000 || !Array.isArray(manifest.tracks) || manifest.tracks.length > 100) throw new Error('Este arquivo não é um backup compatível do Lume.');
  const ids = new Set();
  for (const entry of [...manifest.documents, ...manifest.archived]) {
    if (!hashPattern.test(entry.id) || ids.has(entry.id) || !['pdf', 'epub'].includes(entry.format) || typeof entry.name !== 'string' || entry.name.length > 500 || !Number.isInteger(entry.page) || entry.page < 1 || !Number.isInteger(entry.totalPages) || entry.totalPages < 0 || entry.totalPages > 100000 || entry.payload && !/^books\/[a-f0-9]{64}\.(pdf|epub)$/.test(entry.payload) || entry.payload && entry.payload !== `books/${entry.contentHash}.${entry.format}`) throw new Error('Catálogo inválido no backup.');
    ids.add(entry.id);
    if (['title', 'author'].some(key => entry[key] !== undefined && (typeof entry[key] !== 'string' || entry[key].length > 1000)) || entry.tags && (!Array.isArray(entry.tags) || entry.tags.some(tag => typeof tag !== 'string' || tag.length > 100)) || entry.epubLocation && (typeof entry.epubLocation.cfi !== 'string' || !entry.epubLocation.cfi.startsWith('epubcfi(') || entry.epubLocation.cfi.length > 4000 || !Number.isInteger(entry.epubLocation.chapter) || !Number.isInteger(entry.epubLocation.chapters) || !Number.isFinite(entry.epubLocation.progress) || entry.epubLocation.progress < 0 || entry.epubLocation.progress > 1)) throw new Error('Metadados inválidos no backup.');
    if (entry.favorite !== undefined && typeof entry.favorite !== 'boolean' || entry.collection !== undefined && (typeof entry.collection !== 'string' || entry.collection.length > 80) || entry.status !== undefined && !['reading', 'finished', 'wishlist'].includes(entry.status) || entry.epubLocation && (typeof entry.epubLocation.title !== 'string' || entry.epubLocation.title.length > 1000 || entry.epubLocation.chapter < 1 || entry.epubLocation.chapter > entry.epubLocation.chapters || !Number.isInteger(entry.epubLocation.displayedPage) || !Number.isInteger(entry.epubLocation.displayedTotal) || entry.epubLocation.displayedPage < 1 || entry.epubLocation.displayedTotal < entry.epubLocation.displayedPage)) throw new Error('Organização ou posição inválida no backup.');
  }
  for (const track of manifest.tracks) if (!hashPattern.test(track.id) || typeof track.title !== 'string' || track.title.length > 1000 || !Array.isArray(track.chapters) || !Array.isArray(track.bookmarks) || track.chapters.some(chapter => typeof chapter.title !== 'string' || !Number.isFinite(chapter.start) || chapter.start < 0) || track.bookmarks.some(mark => typeof mark.id !== 'string' || typeof mark.label !== 'string' || !Number.isFinite(mark.time) || mark.time < 0) || !Number.isFinite(track.position) || track.position < 0 || !Number.isFinite(track.rate) || track.rate < .5 || track.rate > 3 || track.payload && !/^media\/[a-f0-9]{64}\.(mp3|m4b|m4a|wav)$/.test(track.payload)) throw new Error('Áudio inválido no backup.');
  const trackIds = new Set(); for (const track of manifest.tracks) { if (trackIds.has(track.id) || typeof track.name !== 'string' || typeof track.author !== 'string' || track.author.length > 1000 || !Number.isFinite(track.duration) || track.duration < 0 || track.chapters.length > 1000 || track.bookmarks.length > 20000) throw new Error('Metadados de áudio inválidos.'); trackIds.add(track.id); }
  if (!manifest.prefs || typeof manifest.prefs !== 'object' || Object.keys(manifest.prefs).length > 100 || Object.entries(manifest.prefs).some(([key, value]) => !key.startsWith('lume-') || key.length > 100 || typeof value !== 'string' || value.length > 20000)) throw new Error('Preferências inválidas no backup.');
  return manifest;
}
function allowedEntry(name) { return name === 'manifest.json' || name === 'study.json' || /^(documents\/[a-f0-9]{64}\.json|covers\/[a-f0-9]{64}\.img|books\/[a-f0-9]{64}\.(pdf|epub)|media\/[a-f0-9]{64}\.(mp3|m4b|m4a|wav))$/.test(name); }
function validateNotebook(notes) {
  const text = (value, max) => typeof value === 'string' && value.length <= max;
  const page = value => Number.isInteger(value) && value >= 1 && value <= 100000;
  const location = value => !value || text(value, 4000) && value.startsWith('epubcfi(');
  const rect = value => value && ['x', 'y', 'width', 'height'].every(key => Number.isFinite(value[key]) && value[key] >= 0 && value[key] <= 1);
  const valid = notes && Array.isArray(notes.annotations) && Array.isArray(notes.bookmarks) && notes.annotations.length <= 20000 && notes.bookmarks.length <= 20000 && notes.ocrPages && typeof notes.ocrPages === 'object'
    && notes.annotations.every(note => note && text(note.id, 100) && text(note.note, 10000) && text(note.quote, 12000) && page(note.page) && location(note.location) && ['yellow', 'green', 'blue', 'pink'].includes(note.color) && Array.isArray(note.anchors) && note.anchors.length <= 30 && note.anchors.every(anchor => page(anchor.page) && Array.isArray(anchor.rects) && anchor.rects.length <= 500 && anchor.rects.every(rect)) && Array.isArray(note.textAnchors) && note.textAnchors.length <= 100 && note.textAnchors.every(anchor => text(anchor.paragraph, 100) && Number.isInteger(anchor.start) && Number.isInteger(anchor.end) && anchor.start >= 0 && anchor.end > anchor.start && anchor.end <= 100000))
    && notes.bookmarks.every(mark => mark && text(mark.id, 100) && text(mark.label, 160) && page(mark.page) && location(mark.location))
    && Object.entries(notes.ocrPages).every(([key, value]) => page(Number(key)) && validOcrPage(value))
    && (notes.readingOrder === undefined || notes.readingOrder && typeof notes.readingOrder === 'object' && !Array.isArray(notes.readingOrder)
      && Object.entries(notes.readingOrder).every(([key, value]) => page(Number(key)) && validReadingOrder(value)));
  if (!valid) throw new Error('Anotações inválidas no pacote.');
}

class Workspace {
  constructor(directory, library, notebooks, study, player, index, notify) { Object.assign(this, { directory, library, notebooks, study, player, index, notify }); this.job = null; this.plans = new Map(); }
  check(job) { if (job.canceled) throw new Error('Operação cancelada.'); }
  report(job, done, total, detail) { this.notify({ kind: job.kind, running: true, done, total, detail, cancellable: !job.committing }); }
  cancel() { if (this.job && !this.job.committing) { this.job.canceled = true; this.job.controller.abort(); } }
  async run(kind, task) {
    if (this.job) throw new Error('Aguarde a operação atual da biblioteca.');
    const job = { id: randomUUID(), kind, canceled: false, committing: false, controller: new AbortController() }; this.job = job;
    try { const result = await task(job); this.notify({ kind, running: false, done: 1, total: 1, detail: 'Concluído', result }); return result; }
    catch (error) { const message = job.canceled ? 'Operação cancelada.' : error.message; this.notify({ kind, running: false, done: 0, total: 1, detail: message, error: message }); throw new Error(message); }
    finally { this.job = null; }
  }
  async scan(folder, job) {
    const result = []; let folders = 0, ignored = 0;
    const visit = async directory => { if (job) { this.check(job); this.report(job, result.length, result.length + 1, 'Procurando livros'); } if (++folders > 10000) throw new Error('A pasta possui subpastas demais. Escolha uma pasta menor.'); for (const item of await fsp.readdir(directory, { withFileTypes: true })) { if (item.isSymbolicLink()) { ignored++; continue; } const file = path.join(directory, item.name); if (item.isDirectory()) await visit(file); else if (item.isFile() && /\.(pdf|epub)$/i.test(item.name)) { result.push(file); if (result.length > 5000) throw new Error('Escolha até 5.000 arquivos por lote.'); } else ignored++; } };
    await visit(await fsp.realpath(folder)); return { files: result.sort((a, b) => a.localeCompare(b)), ignored };
  }
  async batch(files, readBook, ignored = 0) {
    return this.run('import', async job => {
      const result = { added: 0, duplicates: 0, failed: 0, canceled: false, ignored, items: [] };
      for (let index = 0; index < files.length; index++) {
        if (job.canceled) { result.canceled = true; break; }
        const file = files[index]; this.report(job, index, files.length, path.basename(file));
        try { const data = await readBook(file, { metadataOnly: true }); const duplicate = data.importStatus === 'duplicate'; result[duplicate ? 'duplicates' : 'added']++; result.items.push({ name: path.basename(file), status: duplicate ? 'duplicate' : 'added', id: data.entry.id }); }
        catch (error) { result.failed++; result.items.push({ name: path.basename(file), status: 'error', error: error.message }); }
      }
      return result;
    });
  }
  async storage() {
    const root = this.library.booksDirectory(), records = [...this.library.documents, ...this.library.archived], files = []; let total = 0;
    for (const item of await fsp.readdir(root, { withFileTypes: true }).catch(error => { if (error.code === 'ENOENT') return []; throw error; })) {
      if (!item.isFile() || !bookPattern.test(item.name)) continue; const info = await fsp.lstat(path.join(root, item.name));
      const matches = records.filter(entry => entry.contentHash === item.name.slice(0, 64) && entry.storage === 'managed'); total += info.size;
      files.push({ key: item.name, size: info.size, title: matches[0]?.title || matches[0]?.name || item.name, ids: matches.map(entry => entry.id), archived: matches.length > 0 && !matches.some(entry => this.library.find(entry.id)), deletable: matches.length > 0 });
    }
    return { root, total, files, active: this.library.documents.length, archived: this.library.archived.length };
  }
  async deleteCopy(key) {
    return this.run('delete', async job => {
      if (!bookPattern.test(key)) throw new Error('Cópia inválida.');
      const root = await fsp.realpath(this.library.booksDirectory()), file = path.join(root, key), info = await fsp.lstat(file);
      if (!info.isFile() || info.isSymbolicLink() || path.dirname(file) !== root) throw new Error('A exclusão está restrita a cópias locais do Lume.');
      const records = [...this.library.documents, ...this.library.archived], matches = records.filter(entry => entry.storage === 'managed' && entry.contentHash === key.slice(0, 64));
      if (!matches.length) throw new Error('Este arquivo não foi identificado como uma cópia cadastrada.');
      if (await this.isOriginal(file, records)) throw new Error('Este arquivo também é uma origem cadastrada. Ele foi preservado.');
      job.committing = true; this.report(job, 0, 1, 'Excluindo somente a cópia local');
      // Keep the catalog rollback possible until the physical deletion succeeds.
      const oldDocs = this.library.documents, oldArchive = this.library.archived;
      const ids = new Set(matches.map(entry => entry.id));
      this.library.documents = oldDocs.filter(entry => !ids.has(entry.id));
      this.library.archived = [...matches.map(entry => ({ ...entry, storage: 'external', copyDeleted: true, path: path.join(this.directory, 'missing', `${entry.id}.${entry.format}`) })), ...oldArchive.filter(entry => !ids.has(entry.id))];
      try { this.library.save(); await fsp.unlink(file); } catch (error) { this.library.documents = oldDocs; this.library.archived = oldArchive; this.library.save(); throw error; }
      return { ids: [...ids], bytes: info.size };
    });
  }
  async isOriginal(file, records) { for (const entry of records) for (const original of [entry.originalPath, ...(entry.storage !== 'managed' ? [entry.path] : [])].filter(Boolean)) if (equalPath(original, file) || await fsp.realpath(original).then(real => equalPath(real, file), () => false)) return true; return false; }
  async relocate(folder, removeOld) {
    return this.run('move', async job => {
      await this.library.pending; const old = await fsp.realpath(this.library.booksDirectory().replace(/[\\/]$/, '')).catch(error => { if (error.code === 'ENOENT') return this.library.booksDirectory(); throw error; });
      const destination = path.join(await fsp.realpath(folder), 'Lume Livros');
      if (equalPath(old, destination)) return { root: old, copied: 0, removed: 0 };
      if (destination.toLowerCase().startsWith(path.resolve(old).toLowerCase() + path.sep)) throw new Error('Escolha uma pasta fora da biblioteca atual.');
      await fsp.mkdir(destination, { recursive: true }); const files = (await this.storage()).files; let copied = 0;
      for (const item of files) {
        this.check(job); this.report(job, copied, files.length, item.title);
        const source = path.join(old, item.key), target = path.join(destination, item.key), digest = item.key.slice(0, 64);
        if (await exists(target)) { if (!await this.library.validCopy(target, digest, item.size)) throw new Error('A pasta de destino contém um arquivo conflitante. Escolha outra pasta.'); }
        else { const temporary = path.join(destination, `${item.key}.${job.id}.tmp`); try { await pipeline(fs.createReadStream(source), fs.createWriteStream(temporary, { flags: 'wx' }), { signal: job.controller.signal }); if (await hashFile(temporary, job.controller.signal) !== digest) throw new Error('A conferência da cópia falhou. A pasta atual foi mantida.'); await fsp.rename(temporary, target); } finally { await fsp.unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); } }
        copied++;
      }
      this.check(job); job.committing = true; this.report(job, copied, files.length, 'Atualizando a pasta da biblioteca');
      const previous = { root: this.library.booksRoot, documents: this.library.documents, archived: this.library.archived };
      this.library.booksRoot = destination; const remap = entry => entry.storage === 'managed' ? { ...entry, path: path.join(destination, `${entry.contentHash}.${entry.format}`) } : entry;
      this.library.documents = previous.documents.map(remap); this.library.archived = previous.archived.map(remap);
      try { this.library.save(); } catch (error) { this.library.booksRoot = previous.root; this.library.documents = previous.documents; this.library.archived = previous.archived; throw error; }
      let removed = 0; const warnings = [];
      if (removeOld) for (const item of files) { try { const source = path.join(old, item.key); if (!item.deletable || await this.isOriginal(source, [...previous.documents, ...previous.archived])) continue; if (await this.library.validCopy(path.join(destination, item.key), item.key.slice(0, 64), item.size)) { await fsp.unlink(source); removed++; } } catch (error) { warnings.push(item.title); } }
      return { root: destination, copied, removed, warnings };
    });
  }
  async backupPlan(includeAudio = true, signal) {
    const documents = structuredClone(this.library.documents), archived = structuredClone(this.library.archived), tracks = includeAudio ? structuredClone(this.player.tracks) : [];
    const payloads = new Map(), missing = [];
    for (const entry of [...documents, ...archived]) {
      if (entry.copyDeleted) continue;
      const original = this.library.pathFor(entry);
      if (!await exists(original)) { missing.push({ id: entry.id, name: entry.name }); continue; }
      const digest = await hashFile(original, signal); entry.contentHash = digest; entry.payload = `books/${digest}.${entry.format}`; payloads.set(entry.payload, original);
    }
    for (const track of tracks) { if (!await exists(track.path)) { missing.push({ id: track.id, name: track.name }); continue; } const digest = await hashFile(track.path, signal); track.payload = `media/${digest}${path.extname(track.path).toLowerCase()}`; payloads.set(track.payload, track.path); }
    return { documents, archived, tracks, payloads, missing };
  }
  async createBackup(file, prefs, { includeAudio = true, allowMissing = false } = {}) {
    return this.run('backup', async job => {
      if (typeof file !== 'string' || !path.isAbsolute(file) || !/\.(zip|lumebackup)$/i.test(file)) throw new Error('Escolha um arquivo ZIP para o backup.');
      await this.library.pending; this.report(job, 0, 1, 'Conferindo arquivos'); const plan = await this.backupPlan(includeAudio, job.controller.signal); this.check(job);
      if (plan.missing.length && !allowMissing) throw new Error(`${plan.missing.length} arquivos estão indisponíveis. Localize-os ou escolha explicitamente criar um backup parcial.`);
      const manifest = validateManifest({ kind: 'lume-backup', version: 1, createdAt: new Date().toISOString(), documents: plan.documents, archived: plan.archived, tracks: plan.tracks, prefs, missing: plan.missing });
      const zip = new yazl.ZipFile(), temporary = `${file}.${job.id}.tmp`; const destination = path.resolve(file);
      if ([...plan.payloads.values()].some(source => equalPath(source, destination))) throw new Error('Escolha um destino diferente de um livro ou áudio.');
      zip.on('error', error => zip.outputStream.destroy(error));
      const writing = pipeline(zip.outputStream, fs.createWriteStream(temporary, { flags: 'wx' }), { signal: job.controller.signal }); writing.catch(() => {});
      try {
        zip.addBuffer(Buffer.from(JSON.stringify(manifest)), 'manifest.json'); zip.addBuffer(Buffer.from(JSON.stringify(this.study.data)), 'study.json');
        for (const entry of [...plan.documents, ...plan.archived]) for (const [folder, ext] of [['documents', 'json'], ['covers', 'img']]) { const source = path.join(this.directory, folder, `${entry.id}.${ext}`); if (await exists(source)) zip.addFile(source, `${folder}/${entry.id}.${ext}`); }
        for (const [name, source] of plan.payloads) zip.addFile(source, name, { compress: false });
        zip.end(); this.report(job, 0, 1, `Gravando ${plan.payloads.size} arquivos no pacote`); await writing; this.check(job); await fsp.rename(temporary, file); return { path: file, books: plan.documents.length, audio: plan.tracks.length, missing: plan.missing };
      }
      finally { zip.outputStream.destroy(); await writing.catch(() => {}); await fsp.unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
    });
  }
  async readZip(file, staging, job) {
    return new Promise((resolve, reject) => {
      yauzl.open(file, { lazyEntries: true, strictFileNames: true, validateEntrySizes: true }, (error, zip) => {
        if (error) return reject(new Error('Não foi possível abrir o pacote de backup.'));
        let manifest, count = 0, total = 0, settled = false; const names = new Set();
        const fail = error => { if (settled) return; settled = true; zip.close(); reject(error instanceof Error ? error : new Error(String(error))); };
        zip.on('error', fail); zip.on('entry', entry => {
          try { this.check(job); count++; total += entry.uncompressedSize; if (!allowedEntry(entry.fileName) || names.has(entry.fileName) || count > 50000 || total > 2 * 1024 ** 4 || entry.isEncrypted() || (entry.externalFileAttributes >>> 16 & 0o170000) === 0o120000 || entry.uncompressedSize > (entry.fileName.startsWith('media/') ? 8 * 1024 ** 3 : entry.fileName.startsWith('books/') ? 300 * 1024 ** 2 : 32 * 1024 ** 2)) throw new Error('O pacote contém caminhos, tamanhos ou arquivos inválidos.'); names.add(entry.fileName); }
          catch (error) { fail(error); return; }
          if (!staging && entry.fileName !== 'manifest.json') { zip.readEntry(); return; }
          zip.openReadStream(entry, async (error, stream) => {
            if (error) return fail(error);
            try {
              if (entry.fileName === 'manifest.json') { const chunks = []; let length = 0; for await (const chunk of stream) { this.check(job); length += chunk.length; if (length > 8 * 1024 ** 2) throw new Error('Catálogo grande demais.'); chunks.push(chunk); } manifest = validateManifest(safeJson(Buffer.concat(chunks))); if (staging) await fsp.writeFile(path.join(staging, 'manifest.json'), JSON.stringify(manifest)); }
              else { const target = path.resolve(staging, ...entry.fileName.split('/')); if (!target.startsWith(path.resolve(staging) + path.sep)) throw new Error('Caminho inválido no pacote.'); await fsp.mkdir(path.dirname(target), { recursive: true }); await pipeline(stream, fs.createWriteStream(target, { flags: 'wx' }), { signal: job.controller.signal }); }
              this.report(job, count, count + 1, entry.fileName); zip.readEntry();
            } catch (error) { fail(error); }
          });
        });
        zip.on('end', () => { if (settled) return; settled = true; zip.close(); if (!manifest || !names.has('study.json')) reject(new Error('O pacote está incompleto.')); else resolve({ manifest, names }); }); zip.readEntry();
      });
    });
  }
  async preview(file) {
    return this.run('inspect', async job => { const { manifest } = await this.readZip(file, null, job); const id = randomUUID(); this.plans.clear(); this.plans.set(id, { file, digest: createHash('sha256').update(JSON.stringify(manifest)).digest('hex') }); return { id, createdAt: manifest.createdAt, books: manifest.documents.length, archived: manifest.archived.length, audio: manifest.tracks.length, missing: manifest.missing?.length || 0 }; });
  }
  async restore(id) {
    const plan = this.plans.get(id); if (!plan) throw new Error('Selecione o pacote de backup novamente.');
    return this.run('restore', async job => {
      await this.library.pending; const staging = path.join(this.directory, `.restore-${job.id}`); await fsp.mkdir(staging, { recursive: true }); let recovery;
      try {
        const { manifest, names } = await this.readZip(plan.file, staging, job);
        if (createHash('sha256').update(JSON.stringify(manifest)).digest('hex') !== plan.digest) throw new Error('O pacote mudou após a conferência. Selecione-o novamente.');
        const payloads = new Set([...manifest.documents, ...manifest.archived, ...manifest.tracks].map(item => item.payload).filter(Boolean));
        const bookIds = new Set([...manifest.documents, ...manifest.archived].map(item => item.id));
        for (const name of names) if ((name.startsWith('books/') || name.startsWith('media/')) && !payloads.has(name) || (name.startsWith('documents/') || name.startsWith('covers/')) && !bookIds.has(path.basename(name).split('.')[0])) throw new Error('O pacote contém arquivos sem registro no catálogo.');
        for (const payload of new Set([...manifest.documents, ...manifest.archived, ...manifest.tracks].map(item => item.payload).filter(Boolean))) { if (!names.has(payload)) throw new Error('Um arquivo listado no backup está ausente.'); const expected = path.basename(payload).slice(0, 64); if (await hashFile(path.join(staging, ...payload.split('/')), job.controller.signal) !== expected) throw new Error('A integridade de um arquivo do backup falhou. Nenhum catálogo foi substituído.'); }
        const studyData = safeJson(await fsp.readFile(path.join(staging, 'study.json'))); if (!studyData.settings || !studyData.books || !studyData.days) throw new Error('Dados de estudo inválidos.');
        const settings = studyData.settings; for (const [key, min, max] of [['goal', 1, 480], ['breakEvery', 5, 180], ['breakDuration', 1, 30], ['wpm', 50, 1000]]) if (!Number.isInteger(settings[key]) || settings[key] < min || settings[key] > max) throw new Error('Preferências de estudo inválidas.');
        if (typeof settings.autoPace !== 'boolean' || typeof settings.reminders !== 'boolean') throw new Error('Preferências de estudo inválidas.');
        for (const [id, record] of Object.entries(studyData.books)) if (!hashPattern.test(id) || !Array.isArray(record.cards) || record.cards.length > 20000 || record.cards.some(card => typeof card.id !== 'string' || typeof card.front !== 'string' || card.front.length > 2000 || typeof card.back !== 'string' || card.back.length > 12000 || !Number.isInteger(card.page) || card.page < 1 || !Number.isFinite(card.due)) || !record.crop || !['top', 'bottom', 'left', 'right'].every(key => Number.isFinite(record.crop[key]) && record.crop[key] >= 0 && record.crop[key] <= .3)) throw new Error('Cartões ou recortes inválidos no backup.');
        for (const record of Object.values(studyData.books)) validateStudyExtras(record);
        for (const entry of [...manifest.documents, ...manifest.archived]) if (names.has(`documents/${entry.id}.json`)) validateNotebook(safeJson(await fsp.readFile(path.join(staging, 'documents', `${entry.id}.json`))));
        await fsp.mkdir(this.library.booksDirectory(), { recursive: true }); await fsp.mkdir(path.join(this.directory, 'media'), { recursive: true });
        for (const [prefix, targetRoot] of [['books', this.library.booksDirectory()], ['media', path.join(this.directory, 'media')]]) for (const name of names) if (name.startsWith(`${prefix}/`)) { this.check(job); const source = path.join(staging, ...name.split('/')), target = path.join(targetRoot, path.basename(name)); if (await exists(target)) { const digest = await hashFile(target, job.controller.signal); if (digest !== path.basename(name).slice(0, 64)) throw new Error('Existe um arquivo conflitante na pasta de destino. Os dados atuais foram preservados.'); } else await fsp.copyFile(source, target, fs.constants.COPYFILE_EXCL); }
        this.check(job); job.committing = true; this.report(job, 0, 1, 'Preservando os dados atuais e aplicando o catálogo');
        recovery = path.join(this.directory, 'recovery', job.id); await fsp.mkdir(recovery, { recursive: true });
        const originals = ['library.json', 'study.json', 'player.json', 'documents', 'covers', 'search']; const moved = [], created = [];
        const old = { docs: this.library.documents, archived: this.library.archived, study: this.study.data, tracks: this.player.tracks };
        try {
          for (const name of originals) { try { await fsp.rename(path.join(this.directory, name), path.join(recovery, name)); moved.push(name); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
          const remap = entry => { const { payload, ...data } = entry; return { ...data, storage: payload ? 'managed' : 'external', path: payload ? path.join(this.library.booksDirectory(), path.basename(payload)) : path.join(this.directory, 'missing', `${entry.id}.${entry.format}`) }; };
          this.library.documents = manifest.documents.map(remap); this.library.archived = manifest.archived.map(remap); created.push('library.json'); this.library.save();
          this.study.data = studyData; created.push('study.json'); this.study.save();
          this.player.tracks = manifest.tracks.map(track => { const { payload, ...data } = track; return { ...data, path: payload ? path.join(this.directory, 'media', path.basename(payload)) : path.join(this.directory, 'missing', `${track.id}.m4b`) }; }); created.push('player.json'); this.player.save();
          for (const name of ['documents', 'covers']) if (await fsp.stat(path.join(staging, name)).then(info => info.isDirectory(), () => false)) { await fsp.rename(path.join(staging, name), path.join(this.directory, name)); created.push(name); }
          this.index.cache.clear(); this.plans.delete(id); return { prefs: manifest.prefs, recovery, books: manifest.documents.length };
        } catch (error) {
          for (const name of created.reverse()) { const target = path.resolve(this.directory, name); if (path.dirname(target) === path.resolve(this.directory)) await fsp.rm(target, { recursive: true, force: true }); }
          for (const name of moved) await fsp.rename(path.join(recovery, name), path.join(this.directory, name));
          this.library.documents = old.docs; this.library.archived = old.archived; this.study.data = old.study; this.player.tracks = old.tracks; throw error;
        }
      } finally { if (path.dirname(staging) === path.resolve(this.directory) && path.basename(staging) === `.restore-${job.id}`) await fsp.rm(staging, { recursive: true, force: true, maxRetries: 3 }); }
    });
  }
}
module.exports = { Workspace, validateManifest, hashFile };
