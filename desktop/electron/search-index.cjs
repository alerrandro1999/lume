const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const fold = text => String(text).normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('pt-BR');
class SearchIndex {
  constructor(directory, library, notebooks) { this.directory = path.join(directory, 'search'); this.library = library; this.notebooks = notebooks; this.cache = new Map(); }
  fingerprint(entry) {
    const file = this.library.pathFor(entry); let stamp = 'missing';
    try { const info = fs.statSync(file); stamp = `${info.size}:${info.mtimeMs}`; } catch {}
    let notes = ''; try { const book = this.notebooks.read(entry.id); notes = JSON.stringify(entry.format === 'epub' ? book.ocrPages : [book.ocrPages, book.readingOrder]); } catch {}
    return createHash('sha256').update(`${entry.contentHash || entry.path}|${stamp}|${notes}`).digest('hex');
  }
  read(id) {
    if (this.cache.has(id)) return this.cache.get(id);
    try { const data = JSON.parse(fs.readFileSync(path.join(this.directory, `${id}.json`), 'utf8')); this.cache.set(id, data); return data; } catch { return null; }
  }
  status() { return this.library.list().map(entry => { const data = this.read(entry.id); return { id: entry.id, ready: !!data && data.fingerprint === this.fingerprint(entry), units: data?.units?.length || 0, indexedAt: data?.indexedAt }; }); }
  save(id, units, fingerprint) {
    const entry = this.library.find(id); if (!entry || fingerprint !== this.fingerprint(entry)) throw new Error('O livro mudou durante a indexação. Tente novamente.');
    if (!Array.isArray(units) || units.length > 100000 || units.some(unit => !Number.isInteger(unit.page) || unit.page < 1 || unit.page > 100000 || typeof unit.text !== 'string' || unit.text.length > 100000 || unit.cfi && (typeof unit.cfi !== 'string' || unit.cfi.length > 4000 || !unit.cfi.startsWith('epubcfi(')))) throw new Error('Índice inválido.');
    const data = { fingerprint, indexedAt: new Date().toISOString(), units: units.map(unit => ({ page: unit.page, text: unit.text, cfi: unit.cfi })) };
    const encoded = JSON.stringify(data); if (Buffer.byteLength(encoded) > 30 * 1024 * 1024) throw new Error('Este livro excede o limite de texto do índice local (30 MB).');
    fs.mkdirSync(this.directory, { recursive: true }); const file = path.join(this.directory, `${id}.json`); fs.writeFileSync(`${file}.tmp`, encoded); fs.renameSync(`${file}.tmp`, file); this.cache.set(id, data);
  }
  query(query, scope = 'all') {
    if (typeof query !== 'string' || query.trim().length < 2 || query.length > 200 || !['all', 'text', 'notes'].includes(scope)) return { hits: [], indexed: 0, stale: 0, truncated: false };
    const term = fold(query.trim()), hits = []; let indexed = 0, stale = 0;
    const add = (entry, item, kind) => { const text = String(item.text || item.quote || item.note || item.label || ''), position = fold(text).indexOf(term); if (position >= 0 && hits.length < 200) hits.push({ id: entry.id, title: entry.title || entry.name, page: item.page, cfi: item.cfi || item.location, kind, snippet: (position > 65 ? '…' : '') + text.slice(Math.max(0, position - 65), position + term.length + 130) }); };
    for (const entry of this.library.list()) {
      const data = this.read(entry.id), valid = data && data.fingerprint === this.fingerprint(entry);
      if (valid) indexed++; else stale++;
      if (scope !== 'notes' && valid) for (const unit of data.units) add(entry, unit, 'text');
      if (scope !== 'text') { try { const notebook = this.notebooks.read(entry.id); for (const note of notebook.annotations) add(entry, { ...note, text: [note.quote, note.note].join('\n') }, 'note'); for (const mark of notebook.bookmarks) add(entry, { ...mark, text: mark.label }, 'bookmark'); } catch {} }
    }
    return { hits, indexed, stale, truncated: hits.length >= 200 };
  }
}
module.exports = { SearchIndex };
