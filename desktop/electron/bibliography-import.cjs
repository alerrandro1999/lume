const formats = ['ris', 'bib', 'bibtex', 'csv'];
const field = (value, limit = 1500) => typeof value === 'string' ? value.replaceAll('\0', '').trim().slice(0, limit) : '';
const normalize = value => field(value, 32768).normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('pt-BR').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const yearOf = value => /\b[12]\d{3}\b/.exec(String(value ?? ''))?.[0] || '';

function decode(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { return new TextDecoder('windows-1252').decode(bytes); }
}

function doiOf(value) {
  let candidate = field(value, 1000);
  if (/^https?:\/\/(?:dx\.)?doi\.org\//i.test(candidate)) {
    try { candidate = new URL(candidate).pathname.slice(1); } catch { return ''; }
  }
  try { candidate = decodeURIComponent(candidate); } catch { /* Keep the original spelling if it is not URL encoded. */ }
  candidate = candidate.replace(/^doi:\s*/i, '').replace(/[.,;]+$/, '');
  return /^10\.\d{4,9}\/\S+$/i.test(candidate) ? candidate.toLowerCase() : '';
}

function familyOf(value) {
  const first = field(value).split(';')[0].split(',')[0];
  return normalize(first).split(' ').filter(word => word.length > 1).at(-1) || '';
}

function clean(record) {
  const authors = field(record.authors, 2500);
  const candidateUrl = field(record.url, 2000);
  let url = '';
  try {
    const parsed = new URL(candidateUrl);
    if (['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password) url = parsed.href;
  } catch { /* Some exports omit the URL. */ }
  return {
    title: field(record.title), authors, family: normalize(record.family) || familyOf(authors), year: yearOf(record.year),
    doi: doiOf(record.doi) || doiOf(/doi\.org\//i.test(url) ? url : ''), journal: field(record.journal), url,
    abstract: field(record.abstract, 16000),
  };
}

function ris(text) {
  const rows = [];
  let record = new Map();
  let previous;
  function finish() {
    if (!record.size) return;
    const get = (...keys) => keys.map(key => record.get(key)?.[0]).find(Boolean) || '';
    const authors = record.get('AU') || record.get('A1') || [];
    rows.push({ title: get('TI', 'T1', 'CT', 'ST'), authors: authors.join('; '), year: get('PY', 'Y1', 'DA'), doi: get('DO'),
      journal: get('JO', 'JF', 'T2', 'JA'), url: get('UR', 'L1'), abstract: get('AB', 'N2') });
    record = new Map();
    previous = undefined;
  }
  for (const line of text.split(/\r\n|\n|\r/)) {
    const match = /^\s*([A-Z][A-Z0-9])\s*-\s?(.*)$/.exec(line);
    if (!match) {
      if (previous && line.trim()) previous[previous.length - 1] += ` ${line.trim()}`;
      continue;
    }
    const [, tag, value] = match;
    if (tag === 'TY' || tag === 'ER') finish();
    if (tag === 'ER') continue;
    previous = record.get(tag) || [];
    previous.push(value.trim());
    record.set(tag, previous);
  }
  finish();
  return rows;
}

function bibtex(text) {
  const { Cite } = require('@citation-js/core');
  require('@citation-js/plugin-bibtex');
  return new Cite(text, { forceType: '@biblatex/text', generateGraph: false }).data.map(entry => {
    const authors = Array.isArray(entry.author) ? entry.author : [];
    return {
      title: entry.title, authors: authors.map(author => author.literal || [author.family, author.given].filter(Boolean).join(', ')).join('; '),
      family: authors[0]?.family, year: entry.issued?.['date-parts']?.[0]?.[0] || entry.issued?.raw, doi: entry.DOI,
      journal: entry['container-title'], abstract: entry.abstract, url: entry.URL,
    };
  });
}

const aliases = {
  title: ['title', 'titulo', 'article title', 'document title', 'publication title article', 'titulo do artigo'],
  authors: ['authors', 'author', 'autor', 'autores', 'author names', 'authors full names', 'nome dos autores'],
  year: ['year', 'ano', 'publication year', 'publication date', 'date', 'data', 'ano de publicacao'],
  doi: ['doi', 'digital object identifier'],
  journal: ['journal', 'journal title', 'publication title', 'source title', 'periodico', 'revista', 'container title'],
  abstract: ['abstract', 'resumo', 'abstract note', 'description'],
  url: ['url', 'link', 'endereco', 'document link'],
};

function csv(text) {
  const { parse } = require('csv-parse/sync');
  const cleanText = text.replace(/^sep=[;,\t]\r?\n/i, '');
  const header = cleanText.split(/\r\n|\n|\r/).find(line => line.trim()) || '';
  for (const delimiter of [';', ',', '\t']) {
    let columns;
    try { columns = parse(header, { delimiter })[0]?.map(normalize); } catch { continue; }
    if (!columns) continue;
    const indexes = Object.entries(aliases).map(([key, choices]) => [key, columns.findIndex(column => choices.includes(column))]);
    if (indexes.find(([key]) => key === 'title')[1] === -1) continue;
    const rows = parse(cleanText, { delimiter, skip_empty_lines: true, relax_column_count: true, max_record_size: 128000 });
    return rows.slice(1).filter(row => row.some(value => value.trim())).map(row => Object.fromEntries(indexes.map(([key, index]) => [key, row[index] || ''])));
  }
  throw new Error('O CSV precisa de uma coluna Título ou Title.');
}

function parseReferences(bytes, extension) {
  const text = decode(bytes).replace(/^\uFEFF/, '');
  let rows;
  if (extension === 'ris') rows = ris(text);
  else if (extension === 'csv') rows = csv(text);
  else if (extension === 'bib' || extension === 'bibtex') rows = bibtex(text);
  else throw new Error('Formato de referência não reconhecido.');
  if (!rows.length) throw new Error('O arquivo não contém registros reconhecidos.');
  return rows.map(clean);
}

module.exports = { formats, parseReferences, normalize, field };
