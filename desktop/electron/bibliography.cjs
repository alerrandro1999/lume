const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { formats, parseReferences, normalize, field } = require('./bibliography-import.cjs');

const stages = ['pending', 'screen_excluded', 'awaiting_text', 'not_retrieved', 'awaiting_assessment', 'full_excluded', 'included'];
const evidenceFields = ['studyKey', 'design', 'population', 'intervention', 'comparison', 'outcomes', 'results', 'limitations'];
const idPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const emptyCounts = () => Object.fromEntries(stages.map(stage => [stage, 0]));
const evidenceDefaults = () => Object.fromEntries(evidenceFields.map(name => [name, '']));
const fingerprint = record => record.year && record.family && normalize(record.title).length >= 12
  ? `${normalize(record.title)}|${record.year}|${record.family}` : '';

function totals(project) {
  const counts = emptyCounts();
  const groups = new Set();
  const reasons = new Map();
  let studyKeysMissing = 0;
  for (const record of project.records) {
    counts[record.status]++;
    if (record.status === 'included') {
      const key = field(record.evidence?.studyKey, 100).normalize('NFC').toLocaleLowerCase('pt-BR');
      if (key) groups.add(key);
      else studyKeysMissing++;
    }
    if (record.status === 'full_excluded') {
      const key = normalize(record.reason);
      const current = reasons.get(key) || { reason: record.reason, count: 0 };
      reasons.set(key, { ...current, count: current.count + 1 });
    }
  }
  const flow = { database: 0, register: 0, duplicates: 0, invalid: 0 };
  for (const entry of project.imports) {
    flow[entry.kind] += entry.identified;
    flow.duplicates += entry.duplicates;
    flow.invalid += entry.invalid;
  }
  const reportsAssessed = counts.full_excluded + counts.included;
  const reportsSought = counts.awaiting_text + counts.not_retrieved + counts.awaiting_assessment + reportsAssessed;
  return {
    counts, ...flow, identified: flow.database + flow.register, screened: reportsSought + counts.screen_excluded, reportsSought,
    reportsNotRetrieved: counts.not_retrieved, reportsAssessed, articlesIncluded: counts.included,
    studiesIncluded: studyKeysMissing ? null : groups.size, studyKeysMissing,
    fullTextReasons: [...reasons.values()].sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason, 'pt-BR')),
  };
}

function exportCsv(rows) {
  const cell = value => {
    const text = String(value ?? '').replace(/\r\n|\r/g, '\n');
    const safe = /^\s*[=+\-@]/.test(text) || /^[\t\n]/.test(text) ? `'${text}` : text;
    return `"${safe.replaceAll('"', '""')}"`;
  };
  return `\uFEFF${rows.map(row => row.map(cell).join(';')).join('\r\n')}\r\n`;
}

function publicRecord(record) {
  const { family, ...detail } = record;
  return { ...detail, evidence: { ...evidenceDefaults(), ...detail.evidence } };
}

class BibliographicReviews {
  constructor(userData) {
    this.directory = path.join(userData, 'bibliography');
    this.projects = new Map();
    try {
      for (const name of fs.readdirSync(this.directory)) {
        const id = path.basename(name, '.json');
        if (!name.endsWith('.json') || !idPattern.test(id)) continue;
        try {
          const project = JSON.parse(fs.readFileSync(this.file(id), 'utf8'));
          if (project.version === 1 && project.id === id && typeof project.title === 'string' && Array.isArray(project.records) && Array.isArray(project.imports)) this.projects.set(id, project);
        } catch (error) { console.warn('Não foi possível abrir uma revisão bibliográfica:', error.message); }
      }
    } catch (error) { if (error.code !== 'ENOENT') console.warn('Não foi possível abrir a Bancada:', error.message); }
  }

  file(id) { return path.join(this.directory, `${id}.json`); }

  get(id) {
    const project = this.projects.get(id);
    if (!project) throw new Error('Projeto de revisão não encontrado.');
    return project;
  }

  save(project) {
    const record = { ...project, updatedAt: Date.now() };
    const json = JSON.stringify(record);
    if (Buffer.byteLength(json, 'utf8') > 96 * 1024 ** 2) throw new Error('Este projeto atingiu o limite de armazenamento da Bancada.');
    fs.mkdirSync(this.directory, { recursive: true });
    const file = this.file(project.id);
    const temp = `${file}.tmp`;
    try { fs.writeFileSync(temp, json, 'utf8'); fs.renameSync(temp, file); }
    catch (error) { try { fs.rmSync(temp, { force: true }); } catch { /* Keep the original save error. */ } throw error; }
    this.projects.set(project.id, record);
    return this.open(project.id);
  }

  summarize(project) { return { id: project.id, title: project.title, recordCount: project.records.length, updatedAt: project.updatedAt }; }

  list() { return [...this.projects.values()].sort((a, b) => b.updatedAt - a.updatedAt).map(project => this.summarize(project)); }

  open(id) {
    const project = this.get(id);
    return { ...this.summarize(project), question: project.question, includeCriteria: project.includeCriteria, excludeCriteria: project.excludeCriteria,
      flow: totals(project), sources: project.imports.map(({ hash, sourceKey, ...source }) => source) };
  }

  create(title) {
    const name = field(title, 140);
    if (!name) throw new Error('Dê um nome à revisão.');
    return this.save({ version: 1, id: randomUUID(), title: name, question: '', includeCriteria: '', excludeCriteria: '', records: [], imports: [] });
  }

  configure(id, input) {
    const project = this.get(id);
    const title = field(input?.title, 140);
    if (!title) throw new Error('Dê um nome à revisão.');
    return this.save({ ...project, title, question: field(input.question, 1200), includeCriteria: field(input.includeCriteria, 4000), excludeCriteria: field(input.excludeCriteria, 4000) });
  }

  async import(id, paths, origin) {
    this.get(id);
    if (!Array.isArray(paths) || paths.length > 20) throw new Error('Selecione até 20 arquivos por importação.');
    const kind = origin?.kind;
    if (!['database', 'register'].includes(kind)) throw new Error('Selecione o tipo de origem da busca.');
    const label = field(origin?.source, 120);
    const sourceKey = normalize(label);
    const batches = [];
    const errors = [];
    let bytes = 0;
    for (const file of paths) {
      const name = path.basename(file);
      try {
        const extension = path.extname(name).slice(1).toLowerCase();
        if (!formats.includes(extension)) throw new Error('Use arquivos RIS, BibTeX ou CSV.');
        const info = await fsp.stat(file);
        if (!info.isFile() || !info.size || info.size > 15 * 1024 ** 2) throw new Error('Cada arquivo pode ter até 15 MB.');
        bytes += info.size;
        if (bytes > 30 * 1024 ** 2) throw new Error('Importe até 30 MB de arquivos por vez.');
        const data = await fsp.readFile(file);
        const hash = createHash('sha256').update(data).digest('hex');
        const rows = parseReferences(data, extension);
        batches.push({ name, hash, rows });
      } catch (error) {
        const detail = error.code ? 'Não foi possível ler o arquivo.' : field(error.message, 250);
        errors.push({ file: name, detail });
      }
    }

    const project = this.get(id);
    const records = project.records.map(record => ({ ...record }));
    const imports = [...project.imports];
    const byDoi = new Map();
    const byFingerprint = new Map();
    function remember(record) {
      if (record.doi) byDoi.set(record.doi, record);
      const key = fingerprint(record);
      if (!key) return;
      const matches = byFingerprint.get(key) || [];
      if (!matches.includes(record)) byFingerprint.set(key, [...matches, record]);
    }
    for (const record of records) remember(record);
    const report = { added: 0, duplicates: 0, invalid: 0, repeated: [], duplicateExamples: [], errors };
    for (const batch of batches) {
      if (imports.some(entry => entry.hash === batch.hash && entry.sourceKey === sourceKey && entry.kind === kind)) {
        report.repeated.push(batch.name);
        continue;
      }
      const source = { hash: batch.hash, sourceKey, kind, name: batch.name, source: label || batch.name,
        identified: batch.rows.length, duplicates: 0, invalid: 0, added: 0, importedAt: Date.now() };

      for (const input of batch.rows) {
        if (!input.title) { source.invalid++; continue; }
        const candidates = (byFingerprint.get(fingerprint(input)) || []).filter(record => !record.doi || !input.doi || record.doi === input.doi);
        const duplicate = (input.doi && byDoi.get(input.doi)) || (candidates.length === 1 && candidates[0]);
        if (duplicate) {
          source.duplicates++;
          if (report.duplicateExamples.length < 12) report.duplicateExamples.push(input.title);
          for (const key of ['authors', 'family', 'year', 'doi', 'journal', 'abstract', 'url']) {
            if (!duplicate[key] && input[key]) duplicate[key] = input[key];
          }
          remember(duplicate);
          continue;
        }
        if (records.length >= 20000) throw new Error('Limite de 20.000 referências por revisão atingido.');
        const record = { ...input, id: randomUUID(), source: source.source, status: 'pending', reason: '', notes: '', evidence: {} };
        records.push(record);
        source.added++;
        remember(record);
      }
      imports.push(source);
      for (const name of ['added', 'duplicates', 'invalid']) report[name] += source[name];
    }
    const next = imports.length !== project.imports.length ? this.save({ ...project, records, imports }) : this.open(id);
    return { project: next, report };
  }

  references(id, filter = {}) {
    const project = this.get(id);
    const stage = stages.includes(filter.stage) ? filter.stage : '';
    const words = normalize(field(filter.query, 250)).split(' ').filter(Boolean);
    const matches = project.records.filter(item => {
      if (stage && item.status !== stage) return false;
      if (!words.length) return true;
      const text = normalize([item.title, item.authors, item.year, item.journal, item.doi, item.abstract].join(' '));
      return words.every(word => text.includes(word));
    });
    const page = Number.isInteger(filter.page) ? Math.max(0, Math.min(filter.page, Math.ceil(matches.length / 40) - 1)) : 0;
    const rows = matches.slice(page * 40, (page + 1) * 40).map(({ id, title, authors, year, journal, status, doi }) => ({ id, title, authors, year, journal, status, doi }));
    return { page, total: matches.length, pageSize: 40, rows };
  }

  reference(id, recordId) {
    const record = this.get(id).records.find(item => item.id === recordId);
    if (!record) throw new Error('Referência não encontrada.');
    return publicRecord(record);
  }

  update(id, recordId, input) {
    const project = this.get(id);
    const record = this.reference(id, recordId);
    const status = input?.status;
    if (!stages.includes(status)) throw new Error('Selecione uma etapa de triagem válida.');
    const reason = field(input.reason, 300).replace(/\s+/g, ' ');
    const excluded = status === 'screen_excluded' || status === 'full_excluded';
    if (excluded && !reason) throw new Error('Informe o motivo da exclusão.');
    const evidence = Object.fromEntries(evidenceFields.map(key => [key, field(input.evidence?.[key], key === 'studyKey' ? 100 : 5000)]));
    const next = { ...record, family: project.records.find(item => item.id === recordId).family, status,
      reason: excluded || status === 'not_retrieved' ? reason : '', notes: field(input.notes, 6000), evidence, decidedAt: Date.now() };
    return { project: this.save({ ...project, records: project.records.map(item => item.id === recordId ? next : item) }), record: publicRecord(next) };
  }

  sourceUrl(id, recordId) {
    const record = this.reference(id, recordId);
    if (record.doi) return `https://doi.org/${record.doi.split('/').map(encodeURIComponent).join('/')}`;
    if (!record.url) throw new Error('Esta referência não tem DOI ou endereço.');
    const url = new URL(record.url);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('Endereço de fonte inválido.');
    return url.href;
  }

  export(id, format) {
    const project = this.get(id);
    if (format === 'evidence') {
      const included = project.records.filter(record => record.status === 'included');
      if (!included.length) throw new Error('Inclua ao menos uma referência para exportar evidências.');
      return exportCsv([['ID do estudo', 'Título', 'Autores', 'Ano', 'Periódico', 'DOI', 'URL', 'Delineamento', 'População / amostra',
        'Intervenção / exposição', 'Comparador', 'Desfechos', 'Resultados', 'Limitações', 'Notas'], ...included.map(record => {
        const data = record.evidence || {};
        return [data.studyKey, record.title, record.authors, record.year, record.journal, record.doi, record.url,
          ...evidenceFields.filter(key => key !== 'studyKey').map(key => data[key]), record.notes];
      })]);
    }
    if (format !== 'prisma') throw new Error('Formato de exportação inválido.');
    const flow = totals(project);
    return exportCsv([['Etapa', 'Indicador', 'Quantidade'],
      ['Identificação', 'Registros identificados em bases de dados', flow.database], ['Identificação', 'Registros identificados em registros de estudos', flow.register],
      ['Identificação', 'Registros identificados (total)', flow.identified], ['Identificação', 'Duplicatas removidas antes da triagem', flow.duplicates],
      ['Identificação', 'Removidos antes da triagem por outros motivos (sem título)', flow.invalid],
      ['Triagem', 'Registros triados', flow.screened], ['Triagem', 'Registros excluídos por título ou resumo', flow.counts.screen_excluded],
      ['Texto completo', 'Relatórios procurados para recuperação', flow.reportsSought], ['Texto completo', 'Relatórios não recuperados', flow.reportsNotRetrieved],
      ['Texto completo', 'Relatórios avaliados quanto à elegibilidade', flow.reportsAssessed], ['Texto completo', 'Relatórios excluídos após avaliação', flow.counts.full_excluded],
      ...flow.fullTextReasons.map(item => ['Motivos de exclusão após texto completo', item.reason, item.count]),
      ['Inclusão', 'Relatórios de estudos incluídos', flow.articlesIncluded], ['Inclusão', 'Estudos incluídos (IDs distintos)', flow.studiesIncluded],
      ['Pendências', 'Registros ainda sem triagem', flow.counts.pending], ['Pendências', 'Relatórios aguardando recuperação', flow.counts.awaiting_text],
      ['Pendências', 'Textos recuperados aguardando avaliação', flow.counts.awaiting_assessment],
      ['Pendências', 'Relatórios incluídos sem ID do estudo', flow.studyKeysMissing],
      ...project.imports.map(source => ['Fonte de busca', `${source.kind === 'database' ? 'Base' : 'Registro'}: ${source.source}`, source.identified]),
    ]);
  }
}

module.exports = { BibliographicReviews };
