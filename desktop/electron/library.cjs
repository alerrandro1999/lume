const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const samePath = (left, right) => typeof left === 'string' && typeof right === 'string' && (process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right);

class Library {
  constructor(directory) {
    this.directory = directory;
    this.file = path.join(directory, 'library.json');
    this.documents = [];
    this.archived = [];
    this.pending = Promise.resolve();
    this.booksRoot = null;
    try {
      const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (typeof saved.booksRoot === 'string' && path.isAbsolute(saved.booksRoot)) this.booksRoot = saved.booksRoot;
      if (Array.isArray(saved.documents)) {
        this.documents = saved.documents.filter(item =>
          typeof item.id === 'string' && typeof item.path === 'string' &&
          typeof item.name === 'string' && Number.isInteger(item.page) && item.page > 0,
        ).slice(0, 500).map(item => ({ ...item, format: path.extname(item.path).toLowerCase() === '.epub' ? 'epub' : 'pdf' }));
        this.archived = Array.isArray(saved.archived) ? saved.archived.filter(item => typeof item.id === 'string' && typeof item.path === 'string' && typeof item.name === 'string' && Number.isInteger(item.page) && item.page > 0) : [];
      }
    } catch (error) {
      if (error.code !== 'ENOENT') console.warn('Não foi possível recuperar a biblioteca:', error.message);
    }
  }

  list() { return this.documents; }

  find(id) { return this.documents.find(item => item.id === id); }

  save() {
    fs.mkdirSync(this.directory, { recursive: true });
    const temporary = `${this.file}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify({ version: 3, booksRoot: this.booksRoot, documents: this.documents, archived: this.archived }, null, 2), 'utf8');
    fs.renameSync(temporary, this.file);
  }

  opened(filePath, size, format = 'pdf') {
    const id = createHash('sha256').update(process.platform === 'win32' ? filePath.toLowerCase() : filePath).digest('hex');
    const previous = this.find(id);
    const entry = {
      ...previous,
      id, path: filePath, name: path.basename(filePath), size, format,
      page: previous?.page ?? 1,
      totalPages: previous?.totalPages ?? 0,
      openedAt: new Date().toISOString(),
    };
    this.documents = [entry, ...this.documents.filter(item => item.id !== id)].slice(0, 500);
    this.save();
    return entry;
  }

  booksDirectory() { return this.booksRoot || path.join(this.directory, 'books'); }

  pathFor(entry) {
    if (entry.storage !== 'managed') return entry.path;
    if (!/^[a-f0-9]{64}$/.test(entry.contentHash) || !['pdf', 'epub'].includes(entry.format)) throw new Error('Registro da cópia local inválido. Reimporte o livro.');
    return path.join(this.booksDirectory(), `${entry.contentHash}.${entry.format}`);
  }

  async validCopy(file, digest, size) {
    try {
      const info = await fsp.lstat(file); if (!info.isFile() || info.size !== size) return false;
      const hash = createHash('sha256'); for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
      return hash.digest('hex') === digest;
    } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  }

  acquire(filePath, data, format, options = {}) {
    const next = this.pending.then(() => this.acquireOne(filePath, data, format, options));
    this.pending = next.catch(() => {}); return next;
  }

  async acquireOne(filePath, data, format, { mode = 'import', entryId } = {}) {
    if (!['import', 'external', 'recent'].includes(mode) || !['pdf', 'epub'].includes(format) || !path.isAbsolute(filePath) || !Buffer.isBuffer(data)) throw new Error('Importação inválida.');
    const digest = createHash('sha256').update(data).digest('hex');
    const records = [...this.documents, ...this.archived];
    const selected = entryId ? this.find(entryId) : null;
    if (entryId && !selected) throw new Error('Livro não encontrado na biblioteca.');
    if (selected?.format && selected.format !== format) throw new Error('Escolha um arquivo do mesmo formato deste livro.');
    if (selected?.contentHash && selected.contentHash !== digest) throw new Error('O arquivo foi alterado. Use Importar livro para abrir a nova versão sem substituir os registros anteriores.');
    let matchingPath = records.find(item => (samePath(item.path, filePath) || samePath(item.originalPath, filePath)) && (!item.contentHash || item.contentHash === digest));
    if (!selected && !matchingPath) for (const item of records) {
      if (item.contentHash || item.size !== data.length || item.format && item.format !== format) continue;
      try { if (samePath(await fsp.realpath(item.path), filePath)) { matchingPath = item; break; } } catch { /* A missing legacy reference can be located explicitly by the user. */ }
    }
    const previous = selected || matchingPath || records.find(item => item.contentHash === digest);
    if (!this.documents.some(item => item.id === previous?.id) && this.documents.length >= 500) throw new Error('A biblioteca atingiu 500 livros. Remova um item da lista antes de importar outro.');
    let storage = mode === 'import' || mode === 'recent' && previous?.storage === 'managed' ? 'managed' : 'external';
    let destination = filePath, copied = false;
    if (storage === 'managed') {
      destination = path.join(this.booksDirectory(), `${digest}.${format}`);
      if (mode === 'import' && !await this.validCopy(destination, digest, data.length)) {
        await fsp.mkdir(this.booksDirectory(), { recursive: true });
        const temporary = path.join(this.booksDirectory(), `${digest}.${randomUUID()}.tmp`);
        try { await fsp.writeFile(temporary, data, { flag: 'wx' }); await fsp.rename(temporary, destination); copied = true; }
        finally { await fsp.unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
      }
    } else if (previous?.storage === 'managed' && await this.validCopy(this.pathFor(previous), digest, data.length)) {
      storage = 'managed'; destination = this.pathFor(previous);
    }
    // Re-read the record after disk I/O so concurrent progress/notes keep the same identity.
    const current = previous ? this.find(previous.id) || this.archived.find(item => item.id === previous.id) || previous : undefined;
    const entry = { ...current, id: current?.id || digest, path: destination, name: current?.name || path.basename(filePath), format, size: data.length, storage, contentHash: digest, originalPath: current?.originalPath || (storage === 'managed' ? filePath : undefined), page: current?.page || 1, totalPages: current?.totalPages || 0, openedAt: new Date().toISOString() };
    delete entry.copyDeleted;
    const documents = this.documents, archived = this.archived;
    this.documents = [entry, ...documents.filter(item => item.id !== entry.id)]; this.archived = archived.filter(item => item.id !== entry.id);
    try { this.save(); } catch (error) { this.documents = documents; this.archived = archived; throw error; }
    return { entry, importStatus: mode === 'recent' ? undefined : storage === 'managed' ? copied ? 'copied' : 'duplicate' : 'external' };
  }

  progress(id, page, totalPages) {
    const entry = this.find(id);
    if (!entry) throw new Error('Este documento não está na biblioteca.');
    if (!Number.isInteger(page) || !Number.isInteger(totalPages) || totalPages < 1 || page < 1 || page > totalPages) {
      throw new Error('Posição de leitura inválida.');
    }
    entry.page = page;
    entry.totalPages = totalPages;
    this.save();
  }

  epubProgress(id, location) {
    const entry = this.find(id);
    if (!entry || entry.format !== 'epub' || !location || typeof location.cfi !== 'string' || !location.cfi.startsWith('epubcfi(') || location.cfi.length > 4000 || !Number.isInteger(location.chapter) || !Number.isInteger(location.chapters) || location.chapter < 1 || location.chapter > location.chapters || location.chapters > 20000 || !Number.isFinite(location.progress) || location.progress < 0 || location.progress > 1 || !Number.isInteger(location.displayedPage) || !Number.isInteger(location.displayedTotal) || location.displayedPage < 1 || location.displayedTotal < location.displayedPage) throw new Error('Posição do EPUB inválida.');
    entry.page = location.chapter;
    entry.totalPages = location.chapters;
    entry.epubLocation = { cfi: location.cfi, chapter: location.chapter, chapters: location.chapters, title: String(location.title || '').slice(0, 300), progress: location.progress, displayedPage: location.displayedPage, displayedTotal: location.displayedTotal, atStart: location.atStart === true, atEnd: location.atEnd === true };
    this.save();
  }

  metadata(id, metadata) {
    const entry = this.find(id);
    if (!entry || entry.format !== 'epub' || typeof metadata?.title !== 'string' || typeof metadata.author !== 'string') throw new Error('Metadados do livro inválidos.');
    entry.title = metadata.title.trim().slice(0, 300);
    entry.author = metadata.author.trim().slice(0, 300);
    if (metadata.cover instanceof Uint8Array && metadata.cover.length < 3 * 1024 * 1024) {
      const bytes = Buffer.from(metadata.cover);
      const signature = bytes.subarray(0, 8).toString('hex');
      if (signature.startsWith('89504e470d0a1a0a') || signature.startsWith('ffd8ff')) {
        const covers = path.join(this.directory, 'covers');
        fs.mkdirSync(covers, { recursive: true });
        fs.writeFileSync(path.join(covers, `${id}.img`), bytes);
        entry.hasCover = true;
      }
    }
    this.save();
    return entry;
  }

  cover(id) {
    if (typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id) || !this.find(id)?.hasCover) return null;
    return path.join(this.directory, 'covers', `${id}.img`);
  }

  remove(id) {
    const entry = this.find(id), documents = this.documents, archived = this.archived;
    if (entry) this.archived = [entry, ...archived.filter(item => item.id !== id)];
    this.documents = documents.filter(item => item.id !== id);
    try { this.save(); } catch (error) { this.documents = documents; this.archived = archived; throw error; }
    return this.list();
  }

  organize(id, value) {
    const entry = this.find(id);
    if (!entry || !value || typeof value.favorite !== 'boolean' || !['reading', 'finished', 'wishlist'].includes(value.status) || typeof value.collection !== 'string' || value.collection.length > 80 || !Array.isArray(value.tags) || value.tags.length > 12 || !value.tags.every(tag => typeof tag === 'string' && tag.trim().length > 0 && tag.length <= 40)) throw new Error('Organização do livro inválida.');
    Object.assign(entry, { favorite: value.favorite, status: value.status, collection: value.collection.trim(), tags: [...new Set(value.tags.map(tag => tag.trim()))] }); this.save(); return entry;
  }
}

module.exports = { Library };
