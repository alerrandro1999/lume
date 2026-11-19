const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const kinds = ['idea', 'book', 'author', 'reference'];
const colors = ['violet', 'blue', 'teal', 'amber', 'rose', 'slate'];
const ports = ['top', 'right', 'bottom', 'left'];
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const NODE_WIDTH = 224, NODE_HEIGHT = 132;

function text(value, limit, required = false) {
  if (typeof value !== 'string' || value.length > limit || value.includes('\0')) throw new Error('Confira os textos do mapa conceitual.');
  const clean = value.trim();
  if (required && !clean) throw new Error('Informe um título para o mapa e para os blocos.');
  return clean;
}
function source(value) {
  if (value === null || value === undefined) return null;
  if (!['book', 'review'].includes(value.kind)) throw new Error('Vínculo de origem inválido.');
  const result = { kind: value.kind, id: text(value.id, 150, true) };
  if (value.title !== undefined) result.title = text(value.title, 300);
  if (value.recordId !== undefined) {
    if (value.kind !== 'review') throw new Error('Vínculo de referência inválido.');
    result.recordId = text(value.recordId, 150, true);
  }
  return result;
}
function graphDraft(value) {
  if (!Array.isArray(value?.nodes) || value.nodes.length > 500 || !Array.isArray(value.edges) || value.edges.length > 1500) throw new Error('Use até 500 blocos e 1.500 conexões em cada mapa.');
  const ids = new Set();
  const nodes = value.nodes.map(node => {
    if (!node || !uuid.test(node.id) || ids.has(node.id) || !kinds.includes(node.kind) || !colors.includes(node.color)) throw new Error('Bloco inválido.');
    if (![node.x, node.y].every(number => Number.isFinite(number) && Math.abs(number) <= 100000)) throw new Error('Posição do bloco inválida.');
    ids.add(node.id);
    return { id: node.id, kind: node.kind, color: node.color, title: text(node.title, 180, true), notes: text(node.notes, 6000), x: node.x, y: node.y, source: source(node.source) };
  });
  const edgeIds = new Set(), pairs = new Set();
  const edges = value.edges.map(edge => {
    if (!edge || !uuid.test(edge.id) || edgeIds.has(edge.id) || !ids.has(edge.from) || !ids.has(edge.to) || edge.from === edge.to || !ports.includes(edge.fromPort) || !ports.includes(edge.toPort) || !['solid', 'dashed'].includes(edge.style) || !colors.includes(edge.color)) throw new Error('Conexão inválida.');
    const pair = edge.from + ':' + edge.to;
    if (pairs.has(pair)) throw new Error('Já existe uma seta entre esses blocos nessa direção.');
    pairs.add(pair); edgeIds.add(edge.id);
    return { id: edge.id, from: edge.from, to: edge.to, fromPort: edge.fromPort, toPort: edge.toPort, label: text(edge.label, 100), style: edge.style, color: edge.color };
  });
  return { title: text(value.title, 160, true), nodes, edges };
}

class ConceptMaps {
  constructor(userData) {
    this.file = path.join(userData, 'concept-maps.json');
    this.data = { version: 1, maps: [] };
    try {
      const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (saved?.version !== 1 || !Array.isArray(saved.maps) || saved.maps.length > 100) throw new Error('Formato inválido.');
      const ids = new Set();
      const maps = saved.maps.map(map => {
        if (!uuid.test(map.id) || ids.has(map.id) || !Number.isFinite(Date.parse(map.updatedAt))) throw new Error('Mapa inválido.');
        ids.add(map.id);
        return { ...graphDraft(map), id: map.id, updatedAt: map.updatedAt };
      });
      this.data = { version: 1, maps };
    } catch (error) {
      if (error.code !== 'ENOENT') this.problem = 'Não foi possível ler os mapas. Confira o arquivo concept-maps.json na pasta de dados do Lume.';
    }
  }
  check() { if (this.problem) throw new Error(this.problem); }
  list() { this.check(); return this.data.maps.map(({ id, title, updatedAt, nodes, edges }) => ({ id, title, updatedAt, nodeCount: nodes.length, edgeCount: edges.length })).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); }
  open(id) { this.check(); const map = this.data.maps.find(item => item.id === id); if (!map) throw new Error('Mapa não encontrado.'); return structuredClone(map); }
  commit(next) {
    this.check();
    if (Buffer.byteLength(JSON.stringify(next)) > 64 * 1024 ** 2) throw new Error('Os mapas atingiram o limite de armazenamento. Exporte os mapas antigos antes de removê-los.');
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temporary = this.file + '.' + randomUUID() + '.tmp';
    try { fs.writeFileSync(temporary, JSON.stringify(next), { flag: 'wx', encoding: 'utf8' }); fs.renameSync(temporary, this.file); }
    catch (error) { try { fs.unlinkSync(temporary); } catch { /* Preserva o erro original. */ } throw error; }
    this.data = next;
  }
  create(title, draft = null) {
    this.check();
    if (this.data.maps.length >= 100) throw new Error('Você já possui 100 mapas. Exporte e remova um mapa antes de criar outro.');
    const map = { ...graphDraft(draft || { title, nodes: [], edges: [] }), id: randomUUID(), updatedAt: new Date().toISOString() };
    this.commit({ ...this.data, maps: [...this.data.maps, map] });
    return structuredClone(map);
  }
  save(id, value) {
    this.open(id);
    const map = { ...graphDraft(value), id, updatedAt: new Date().toISOString() };
    this.commit({ ...this.data, maps: this.data.maps.map(item => item.id === id ? map : item) });
    return structuredClone(map);
  }
  remove(id) { this.open(id); this.commit({ ...this.data, maps: this.data.maps.filter(item => item.id !== id) }); return this.list(); }
  import(value) {
    if (value?.format !== 'lume-concept-map' || value.version !== 1) throw new Error('Selecione um mapa JSON exportado pelo Lume.');
    return this.create(value.title, graphDraft(value));
  }
  json(id) { const { id: ignored, updatedAt, ...draft } = this.open(id); return JSON.stringify({ format: 'lume-concept-map', version: 1, ...draft }, null, 2); }
}

function conceptSources(library, bibliography, query = '') {
  const normalize = value => String(value).normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('pt-BR');
  const needle = normalize(text(query, 200));
  const items = [], authors = new Set();
  const add = item => { if ((!needle || normalize(item.title + ' ' + item.subtitle).includes(needle)) && items.length < 160) items.push(item); };
  function addAuthor(name, origin) {
    const title = String(name).trim().slice(0, 180), key = normalize(title);
    if (!title || authors.has(key)) return;
    authors.add(key); add({ key: 'author:' + key, kind: 'author', title, subtitle: 'Autor · ' + origin.title, source: origin.source });
  }
  for (const book of library.list()) {
    const title = String(book.title || book.name).slice(0, 180);
    const origin = { key: 'book:' + book.id, kind: 'book', title, subtitle: String(book.author || 'Livro da biblioteca').slice(0, 300), source: { kind: 'book', id: book.id, title } };
    add(origin);
    if (book.author) addAuthor(book.author, origin);
  }
  for (const project of bibliography.list()) {
    for (const record of bibliography.get(project.id).records) {
      const origin = { key: 'reference:' + project.id + ':' + record.id, kind: 'reference', title: String(record.title).slice(0, 180), subtitle: [record.authors, record.year, project.title].filter(Boolean).join(' · ').slice(0, 500), source: { kind: 'review', id: project.id, recordId: record.id, title: String(record.title).slice(0, 300) } };
      add(origin);
      for (const author of String(record.authors || '').split(';')) addAuthor(author, origin);
      if (items.length >= 160) return items;
    }
  }
  return items;
}

const xml = value => String(value).toWellFormed().replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[char]));
const ink = { violet: '#7963b7', blue: '#4a77b6', teal: '#348577', amber: '#b38538', rose: '#b25f80', slate: '#74808e' };
function point(node, port) { return { x: node.x + (port === 'left' ? 0 : port === 'right' ? NODE_WIDTH : NODE_WIDTH / 2), y: node.y + (port === 'top' ? 0 : port === 'bottom' ? NODE_HEIGHT : NODE_HEIGHT / 2) }; }
function connectionPath(from, to, fromPort, toPort) {
  const bend = Math.max(60, Math.min(220, Math.hypot(to.x - from.x, to.y - from.y) / 2));
  const offset = (p, port) => ({ x: p.x + (port === 'right' ? bend : port === 'left' ? -bend : 0), y: p.y + (port === 'bottom' ? bend : port === 'top' ? -bend : 0) });
  const a = offset(from, fromPort), b = offset(to, toPort);
  return { d: `M ${from.x} ${from.y} C ${a.x} ${a.y}, ${b.x} ${b.y}, ${to.x} ${to.y}`, x: (from.x + 3 * a.x + 3 * b.x + to.x) / 8, y: (from.y + 3 * a.y + 3 * b.y + to.y) / 8 };
}
function lines(value, width, count) {
  const words = String(value).replace(/\s+/g, ' ').trim().match(new RegExp(`.{1,${width}}(?:\\s|$)|.{1,${width}}`, 'g')) || [];
  const result = words.slice(0, count).map(line => line.trim());
  if (words.length > count) result[count - 1] = result[count - 1].slice(0, width - 1) + '…';
  return result;
}
function conceptSvg(map) {
  const minX = Math.min(0, ...map.nodes.map(node => node.x)) - 260;
  const minY = Math.min(0, ...map.nodes.map(node => node.y)) - 260;
  const maxX = Math.max(600, ...map.nodes.map(node => node.x + NODE_WIDTH)) + 260;
  const maxY = Math.max(300, ...map.nodes.map(node => node.y + NODE_HEIGHT)) + 260;
  const width = maxX - minX, height = maxY - minY;
  const labels = { idea: 'IDEIA', book: 'LIVRO', author: 'AUTOR', reference: 'REFERÊNCIA' };
  const defs = `<defs>${colors.map(color => `<marker id="arrow-${color}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="${ink[color]}"/></marker>`).join('')}</defs>`;
  const edges = map.edges.map(edge => {
    const from = map.nodes.find(node => node.id === edge.from), to = map.nodes.find(node => node.id === edge.to);
    const curve = connectionPath(point(from, edge.fromPort), point(to, edge.toPort), edge.fromPort, edge.toPort);
    const label = edge.label.length > 54 ? edge.label.slice(0, 53) + '…' : edge.label;
    const caption = label ? `<rect x="${curve.x - (label.length * 6 + 18) / 2}" y="${curve.y - 12}" width="${label.length * 6 + 18}" height="24" rx="7" fill="#fff"/><text x="${curve.x}" y="${curve.y + 4}" text-anchor="middle" font-size="11" fill="#566078">${xml(label)}</text>` : '';
    return `<path d="${curve.d}" fill="none" stroke="${ink[edge.color]}" stroke-width="2.5"${edge.style === 'dashed' ? ' stroke-dasharray="7 5"' : ''} marker-end="url(#arrow-${edge.color})"/>${caption}`;
  }).join('');
  const nodes = map.nodes.map(node => `<g transform="translate(${node.x} ${node.y})"><rect width="${NODE_WIDTH}" height="${NODE_HEIGHT}" rx="15" fill="#fff" stroke="${ink[node.color]}" stroke-width="1.5"/><rect x="15" y="15" width="4" height="16" rx="2" fill="${ink[node.color]}"/><text x="26" y="27" font-size="9" font-weight="700" letter-spacing="1" fill="${ink[node.color]}">${labels[node.kind]}</text>${lines(node.title, 27, 2).map((line, index) => `<text x="16" y="${53 + index * 18}" font-size="14" font-weight="600" fill="#253047">${xml(line)}</text>`).join('')}${lines(node.notes || (node.source ? 'Vinculado ao hub' : ''), 34, 2).map((line, index) => `<text x="16" y="${99 + index * 14}" font-size="10" fill="#6b7280">${xml(line)}</text>`).join('')}</g>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.min(width, 2400)}" height="${Math.min(width, 2400) * height / width}" viewBox="${minX} ${minY} ${width} ${height}" role="img"><title>${xml(map.title)}</title>${defs}<rect x="${minX}" y="${minY}" width="${width}" height="${height}" fill="#f6f7fb"/><g font-family="Segoe UI,Arial,sans-serif"><text x="${minX + 40}" y="${minY + 50}" fill="#253047" font-size="23" font-weight="600">${xml(map.title)}</text>${edges}${nodes}</g></svg>`;
}

module.exports = { ConceptMaps, conceptSources, conceptSvg, graphDraft };
