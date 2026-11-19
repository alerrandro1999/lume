const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const empty = () => ({ annotations: [], bookmarks: [], ocrPages: {} });
const text = (value, limit) => typeof value === 'string' && value.length <= limit;
const validBlockId = value => text(value, 100) && /^p\d+-[\da-f-]+$/i.test(value);
const validIds = value => Array.isArray(value) && value.length <= 5000 && value.every(validBlockId) && new Set(value).size === value.length;
const validReadingOrder = value => value && validIds(value.order) && validIds(value.hidden) && typeof value.includeMargins === 'boolean';
function validOcrPage(value) {
  const rect = area => area && ['x', 'y', 'width', 'height'].every(key => Number.isFinite(area[key]) && area[key] >= 0 && area[key] <= 1);
  if (!value || !text(value.text, 1000000) || !Number.isFinite(value.confidence) || !Array.isArray(value.words) || value.words.length > 100000 ||
      !value.words.every(word => word && text(word.text, 10000) && rect(word.rect)) || value.reviewedAt !== undefined && !text(value.reviewedAt, 50)) return false;
  if (value.blocks === undefined) return true;
  return Array.isArray(value.blocks) && value.blocks.length <= 5000 && value.blocks.every(block => block && validBlockId(block.id) && text(block.text, 100000) && Number.isInteger(block.wordCount) && block.wordCount >= 0) &&
    new Set(value.blocks.map(block => block.id)).size === value.blocks.length &&
    value.blocks.reduce((count, block) => count + block.wordCount, 0) === value.words.length;
}
const cfi = value => {
  if (value == null || value === '') return undefined;
  if (typeof value !== 'string' || !value.startsWith('epubcfi(') || value.length > 4000) throw new Error('Localização do livro inválida.');
  return value;
};

class Notebooks {
  constructor(directory, library) {
    this.directory = path.join(directory, 'documents');
    this.library = library;
  }

  file(id) {
    if (typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id) || !this.library.find(id)) throw new Error('Documento não encontrado.');
    return path.join(this.directory, `${id}.json`);
  }

  read(id) {
    try {
      const data = JSON.parse(fs.readFileSync(this.file(id), 'utf8'));
      return {
        annotations: Array.isArray(data.annotations) ? data.annotations : [],
        bookmarks: Array.isArray(data.bookmarks) ? data.bookmarks : [],
        ocrPages: data.ocrPages && typeof data.ocrPages === 'object' ? data.ocrPages : {},
        ...(data.readingOrder && typeof data.readingOrder === 'object' ? { readingOrder: data.readingOrder } : {}),
      };
    } catch (error) {
      if (error.code === 'ENOENT') return empty();
      throw new Error('Não foi possível ler as anotações deste documento.');
    }
  }

  write(id, notebook) {
    const file = this.file(id);
    fs.mkdirSync(this.directory, { recursive: true });
    fs.writeFileSync(`${file}.tmp`, JSON.stringify({ version: 1, ...notebook }), 'utf8');
    fs.renameSync(`${file}.tmp`, file);
    return notebook;
  }

  page(id, page) {
    this.file(id);
    if (!Number.isInteger(page) || page < 1 || page > (this.library.find(id).totalPages || 100000)) throw new Error('Página inválida.');
  }

  annotation(id, value) {
    this.page(id, value?.page);
    if (typeof value.quote !== 'string' || value.quote.length > 12000 || typeof value.note !== 'string' || value.note.length > 10000 || (!value.quote.trim() && !value.note.trim())) throw new Error('Selecione um trecho ou escreva uma anotação.');
    if (!['yellow', 'green', 'blue', 'pink'].includes(value.color)) throw new Error('Cor inválida.');
    const notebook = this.read(id);
    const existing = value.id ? notebook.annotations.find(item => item.id === value.id) : null;
    if (value.id && !existing) throw new Error('Anotação não encontrada.');
    const rect = item => {
      if (!item || !['x', 'y', 'width', 'height'].every(key => Number.isFinite(item[key]) && item[key] >= 0 && item[key] <= 1)) throw new Error('Posição de destaque inválida.');
      return { x: item.x, y: item.y, width: Math.min(item.width, 1 - item.x), height: Math.min(item.height, 1 - item.y) };
    };
    const anchors = (Array.isArray(value.anchors) ? value.anchors : []).slice(0, 30).map(anchor => {
      this.page(id, anchor.page);
      return { page: anchor.page, rotation: [0, 90, 180, 270].includes(anchor.rotation) ? anchor.rotation : 0, rects: (Array.isArray(anchor.rects) ? anchor.rects : []).slice(0, 500).map(rect) };
    });
    const textAnchors = (Array.isArray(value.textAnchors) ? value.textAnchors : []).slice(0, 100).map(anchor => {
      if (typeof anchor.paragraph !== 'string' || anchor.paragraph.length > 100 || !Number.isInteger(anchor.start) || !Number.isInteger(anchor.end) || anchor.start < 0 || anchor.end <= anchor.start || anchor.end > 100000) throw new Error('Trecho inválido.');
      return { paragraph: anchor.paragraph, start: anchor.start, end: anchor.end };
    });
    const annotation = { id: existing?.id || randomUUID(), page: value.page, quote: value.quote.trim(), note: value.note.trim(), color: value.color, anchors, textAnchors, location: cfi(value.location), createdAt: existing?.createdAt || new Date().toISOString() };
    notebook.annotations = [annotation, ...notebook.annotations.filter(item => item.id !== annotation.id)];
    return this.write(id, notebook);
  }

  bookmark(id, value) {
    this.page(id, value?.page);
    if (typeof value.label !== 'string' || !value.label.trim() || value.label.length > 160) throw new Error('Dê um nome de até 160 caracteres ao marcador.');
    const notebook = this.read(id);
    const previous = value.id ? notebook.bookmarks.find(item => item.id === value.id) : null;
    if (value.id && !previous) throw new Error('Marcador não encontrado.');
    const bookmark = { id: previous?.id || randomUUID(), page: value.page, label: value.label.trim(), location: cfi(value.location), createdAt: previous?.createdAt || new Date().toISOString() };
    notebook.bookmarks = [bookmark, ...notebook.bookmarks.filter(item => item.id !== bookmark.id)];
    return this.write(id, notebook);
  }

  remove(id, kind, itemId) {
    if (!['annotations', 'bookmarks'].includes(kind) || typeof itemId !== 'string') throw new Error('Item inválido.');
    const notebook = this.read(id);
    notebook[kind] = notebook[kind].filter(item => item.id !== itemId);
    return this.write(id, notebook);
  }

  ocr(id, page, result) {
    this.page(id, page);
    const notebook = this.read(id);
    const previous = notebook.ocrPages[page];
    if (previous?.reviewedAt || notebook.readingOrder?.[page]) throw new Error('Esta página tem uma revisão salva. Use Revisar a página para corrigir o texto ou refazer uma área.');
    if (result.blocks) result.blocks = result.blocks.map((block, index) => ({ ...block, id: `p${page}-${index}` }));
    notebook.ocrPages[page] = result;
    this.write(id, notebook);
    return result;
  }

  reviewPage(id, page, update) {
    this.page(id, page);
    if (this.library.find(id).format === 'epub' || !update || update.layout !== null && !validReadingOrder(update.layout)) throw new Error('Ordem de leitura inválida.');
    const notebook = this.read(id);
    const current = notebook.ocrPages[page];
    if ((current?.reviewedAt || current?.createdAt) !== update.expectedRevision) throw new Error('O texto mudou. Abra a revisão da página novamente.');
    if (update.ocr !== undefined) {
      if (!current || !validOcrPage(update.ocr) || !update.ocr.blocks) throw new Error('Texto revisado inválido.');
      const { blocks, text, words } = update.ocr;
      notebook.ocrPages[page] = { ...current, blocks, text, words, reviewedAt: new Date().toISOString() };
    }
    if (update.layout) {
      notebook.readingOrder ||= {};
      notebook.readingOrder[page] = update.layout;
    } else if (notebook.readingOrder) {
      delete notebook.readingOrder[page];
      if (!Object.keys(notebook.readingOrder).length) delete notebook.readingOrder;
    }
    return this.write(id, notebook);
  }
}

module.exports = { Notebooks, validOcrPage, validReadingOrder };
