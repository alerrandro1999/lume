const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const kinds = {
  summary: ['Resumo', [['Texto do resumo', 'Qual é o tema, o objetivo, o método e a principal conclusão? Escreva uma síntese fiel ao trabalho.']]],
  review: ['Resenha', [['Apresentação da obra', 'Qual obra será analisada? Apresente autoria, contexto e tema.'], ['Síntese', 'Quais são as ideias centrais? Diferencie a voz do autor da sua leitura.'], ['Análise crítica', 'Como os argumentos se sustentam? Relacione-os às fontes e justifique sua avaliação.'], ['Considerações finais', 'Que contribuição e limites você identifica na obra?']]],
  report: ['Relatório de estágio', [['Introdução', 'Apresente o local, o período, os objetivos e o contexto do estágio.'], ['Atividades realizadas', 'Descreva sua participação e registre exemplos concretos.'], ['Aprendizados e análise', 'Relacione a experiência à formação e às referências do curso.'], ['Considerações finais', 'Quais foram os aprendizados, dificuldades e próximos passos?']]],
  article: ['Artigo', [['Resumo', 'Sintetize objetivo, método, resultados e conclusão.'], ['Introdução', 'Delimite o tema, apresente o problema, a justificativa e o objetivo.'], ['Metodologia', 'Explique como o estudo foi conduzido e como os dados foram analisados.'], ['Resultados e discussão', 'Apresente evidências e dialogue com a literatura. Diferencie resultado e interpretação.'], ['Considerações finais', 'Responda ao objetivo e indique limites e possibilidades de continuidade.']]],
  project: ['Projeto de pesquisa', [['Tema e delimitação', 'Qual recorte será investigado e por que ele é relevante?'], ['Problema e justificativa', 'Formule a pergunta e justifique a importância do estudo.'], ['Objetivos', 'Defina o objetivo geral e os objetivos específicos.'], ['Metodologia', 'Descreva abordagem, fontes, procedimentos e análise.'], ['Cronograma', 'Distribua as etapas da pesquisa no período disponível.']]],
  chapter: ['Capítulo de TCC', [['Abertura do capítulo', 'Apresente o propósito do capítulo e sua relação com o problema de pesquisa.'], ['Desenvolvimento', 'Organize os argumentos, estabeleça relações entre autores e sustente suas afirmações.'], ['Síntese e articulação', 'Retome o argumento central e conecte-o ao próximo capítulo.']]],
};
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
function id(value) { if (typeof value !== 'string' || !uuid.test(value)) throw new Error('Identificador de escrita inválido.'); return value; }
function text(value, max = 1000, required = false) { if (typeof value !== 'string' || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value) || (required && !value.trim())) throw new Error('Confira os campos e o tamanho do texto.'); return value; }
function count(value) { return (value.match(/[\p{L}\p{N}]+(?:['’‐-][\p{L}\p{N}]+)*/gu) || []).length; }
function blockText(block, citations) { return block.runs.map(run => run.citationId ? citations.find(c => c.id === run.citationId)?.label || '' : run.text).join(''); }
function words(doc) { return doc.sections.reduce((sum, section) => sum + section.blocks.reduce((n, block) => n + count(blockText(block, doc.citations)), 0), 0); }
function draft(value, citations) {
  if (!kinds[value?.type] || !Number.isInteger(value.goal) || value.goal < 0 || value.goal > 200000 || !Array.isArray(value.sections) || !value.sections.length || value.sections.length > 80) throw new Error('Confira o tipo, a meta e as seções do texto.');
  const seen = new Set(), unique = value => { id(value); if (seen.has(value)) throw new Error('Seção ou parágrafo duplicado.'); seen.add(value); return value; };
  let length = 0, blocks = 0;
  const sections = value.sections.map(section => {
    if (typeof section.include !== 'boolean' || !Array.isArray(section.blocks) || section.blocks.length > 3000) throw new Error('Seção inválida.');
    return { id: unique(section.id), title: text(section.title, 200), guide: text(section.guide, 4000), notes: text(section.notes, 12000), include: section.include, blocks: section.blocks.map(block => {
      if (++blocks > 3000 || !['paragraph', 'heading', 'bullet', 'number', 'quote'].includes(block.type) || !Array.isArray(block.runs) || block.runs.length > 5000) throw new Error('O texto atingiu o limite de parágrafos ou formatação.');
      return { id: unique(block.id), type: block.type, runs: block.runs.map(run => {
        const content = text(run.text, 100000); length += content.length;
        if (length > 1000000 || typeof run.bold !== 'boolean' || typeof run.italic !== 'boolean') throw new Error('O texto atingiu o limite de tamanho.');
        const citationId = run.citationId ? id(run.citationId) : '';
        if (citationId && !citations.some(c => c.id === citationId)) throw new Error('Referência vinculada não encontrada.');
        return { text: citationId ? '' : content, bold: run.bold, italic: run.italic, citationId };
      }) };
    }) };
  });
  const context = Object.fromEntries(['projectId','projectTitle','topic','problem','objective','methodology','mapId','mapTitle'].map(key => [key, text(value.context?.[key] ?? '', 12000)]));
  return { title: text(value.title, 200, true), type: value.type, author: text(value.author, 200), course: text(value.course, 200), goal: value.goal, context, sections };
}
function citation(value) {
  id(value.id);
  if (!['book', 'review'].includes(value.source?.kind)) throw new Error('Fonte de escrita inválida.');
  return { id: value.id, source: { kind: value.source.kind, id: text(value.source.id, 150, true), ...(value.source.recordId ? { recordId: text(value.source.recordId, 150, true) } : {}) }, ...Object.fromEntries(['label','locator','title','authors','year','journal','doi','url'].map(key => [key, text(value[key] ?? '', key === 'label' || key === 'locator' ? 1000 : 4000)])) };
}
function validate(data) {
  if (data?.version !== 1 || !Array.isArray(data.documents) || data.documents.length > 100) throw new Error('Arquivo da oficina inválido.');
  const seen = new Set();
  for (const doc of data.documents) {
    id(doc.id); if (seen.has(doc.id)) throw new Error('Documento duplicado.'); seen.add(doc.id);
    if (typeof doc.updatedAt !== 'string' || !Number.isFinite(Date.parse(doc.updatedAt))) throw new Error('Data do texto inválida.');
    if (!Array.isArray(doc.citations) || doc.citations.length > 200 || !Array.isArray(doc.versions) || doc.versions.length > 20) throw new Error('Limite de referências ou versões excedido.');
    doc.citations.forEach(citation); if (new Set(doc.citations.map(c => c.id)).size !== doc.citations.length) throw new Error('Referência duplicada.');
    draft(doc, doc.citations);
    const versions = new Set();
    for (const version of doc.versions) { id(version.id); if (versions.has(version.id) || typeof version.createdAt !== 'string' || !Number.isFinite(Date.parse(version.createdAt))) throw new Error('Versão inválida.'); versions.add(version.id); text(version.label, 200, true); if (!Array.isArray(version.snapshot?.citations) || version.snapshot.citations.length > 200) throw new Error('Versão inválida.'); version.snapshot.citations.forEach(citation); draft(version.snapshot, version.snapshot.citations); }
  }
}
class AcademicWriting {
  constructor(userData, notify = () => {}) {
    this.file = path.join(userData, 'academic-writing.json'); this.notify = notify; this.pending = new Map(); this.rejected = new Map(); this.timers = new Map(); this.data = { version: 1, documents: [] };
    try { const data = JSON.parse(fs.readFileSync(this.file, 'utf8')); validate(data); this.data = data; } catch (error) { if (error.code !== 'ENOENT') this.problem = 'Não foi possível ler a oficina. Preserve o arquivo academic-writing.json nos dados do Lume para recuperação.'; }
  }
  check() { if (this.problem) throw new Error(this.problem); }
  commit(next) {
    this.check(); validate(next); const json = JSON.stringify(next); if (Buffer.byteLength(json) > 128 * 1024 ** 2) throw new Error('A oficina atingiu o limite de armazenamento. Exporte e remova textos antigos.');
    fs.mkdirSync(path.dirname(this.file), { recursive: true }); const temporary = this.file + '.' + randomUUID() + '.tmp';
    try { fs.writeFileSync(temporary, json, { flag: 'wx' }); fs.renameSync(temporary, this.file); } catch (error) { try { fs.unlinkSync(temporary); } catch { /* Preserva o arquivo anterior. */ } throw error; }
    this.data = next;
  }
  get(docId) { this.check(); const doc = this.data.documents.find(d => d.id === id(docId)); if (!doc) throw new Error('Texto não encontrado.'); return doc; }
  open(docId) { const doc = this.get(docId); return structuredClone(this.pending.get(docId)?.doc ?? doc); }
  list() { this.check(); return this.data.documents.map(doc => { const current = this.pending.get(doc.id)?.doc ?? doc; return { id: current.id, title: current.title, type: current.type, updatedAt: current.updatedAt, words: words(current) }; }).sort((a,b) => b.updatedAt.localeCompare(a.updatedAt)); }
  create(value, context = {}) {
    this.check(); if (!kinds[value?.type]) throw new Error('Escolha um tipo de texto.');
    const doc = { ...draft({ ...value, context, sections: kinds[value.type][1].map(([title, guide]) => ({ id: randomUUID(), title, guide, notes: '', include: true, blocks: [] })) }, []), id: randomUUID(), updatedAt: new Date().toISOString(), citations: [], versions: [] };
    const next = structuredClone(this.data); next.documents.push(doc); this.commit(next); return structuredClone(doc);
  }
  stage(docId, value, token) {
    const old = this.get(docId); id(token); let doc;
    try { doc = { ...old, ...draft(value, old.citations), updatedAt: new Date().toISOString() }; }
    catch (error) { this.rejected.set(docId,error.message); throw error; }
    this.rejected.delete(docId);
    this.pending.set(docId, { doc, token }); clearTimeout(this.timers.get(docId));
    this.timers.set(docId, setTimeout(() => { try { this.flush(docId); } catch { /* O erro já foi comunicado; o rascunho continua na memória. */ } }, 600));
  }
  flush(docId) {
    this.get(docId); if (this.rejected.has(docId)) throw new Error(this.rejected.get(docId)); const pending = this.pending.get(docId); if (!pending) return this.open(docId);
    clearTimeout(this.timers.get(docId)); this.timers.delete(docId);
    try { const next = structuredClone(this.data); next.documents = next.documents.map(doc => doc.id === docId ? pending.doc : doc); this.commit(next); this.pending.delete(docId); this.notify({ id: docId, token: pending.token, state: 'saved' }); return this.open(docId); }
    catch (error) { this.notify({ id: docId, token: pending.token, state: 'error', message: 'Não foi possível salvar. Seu texto continua aberto; libere espaço e tente novamente.' }); throw error; }
  }
  flushAll() { if (this.rejected.size) throw new Error('Há alterações que precisam ser corrigidas antes de salvar.'); for (const docId of this.pending.keys()) this.flush(docId); }
  mutate(docId, action) { this.flush(docId); const next = structuredClone(this.data), doc = next.documents.find(d => d.id === docId); action(doc); doc.updatedAt = new Date().toISOString(); this.commit(next); return this.open(docId); }
  remove(docId) { this.flush(docId); const next = structuredClone(this.data); next.documents = next.documents.filter(doc => doc.id !== docId); this.commit(next); }
  addCitation(docId, source, value) { return this.mutate(docId, doc => { doc.citations.push(citation({ ...source, id: randomUUID(), label: text(value.label, 1000, true), locator: text(value.locator, 1000) })); }); }
  removeCitation(docId, citationId) { return this.mutate(docId, doc => { if (doc.sections.some(s => s.blocks.some(b => b.runs.some(r => r.citationId === citationId)))) throw new Error('Remova a marca de citação do texto antes de excluir a referência.'); doc.citations = doc.citations.filter(c => c.id !== citationId); }); }
  version(docId, label) { return this.mutate(docId, doc => { const { versions, id: ignored, updatedAt, ...snapshot } = doc; doc.versions.push({ id: randomUUID(), label: text(label, 200, true), createdAt: new Date().toISOString(), snapshot: structuredClone(snapshot) }); doc.versions = doc.versions.slice(-20); }); }
  restore(docId, versionId) { return this.mutate(docId, doc => { const version = doc.versions.find(v => v.id === versionId); if (!version) throw new Error('Versão não encontrada.'); const { versions, id: ignored, updatedAt, ...snapshot } = doc; const previous = { id: randomUUID(), label: 'Antes de restaurar ' + version.label.slice(0, 150), createdAt: new Date().toISOString(), snapshot: structuredClone(snapshot) }; Object.assign(doc, structuredClone(version.snapshot)); doc.versions = [...versions, previous].slice(-20); }); }
  removeVersion(docId, versionId) { return this.mutate(docId, doc => { doc.versions = doc.versions.filter(v => v.id !== versionId); }); }
}
const stop = new Set('para como uma umas uns que com por dos das nos nas aos seu sua seus suas esse essa isso esta este estão entre mais muito pela pelo sem sobre não também foi são ser tem pela pelo de do da em um os as ao se na no e o a'.split(' '));
function review(doc) {
  const results = [];
  for (const section of doc.sections) for (const block of section.blocks) {
    const value = blockText(block, doc.citations), push = (kind, message) => results.push({ sectionId: section.id, blockId: block.id, section: section.title, kind, message, excerpt: value.slice(0, 140) });
    if (count(value) > 120) push('paragraph', 'Parágrafo com mais de 120 palavras. Considere separar ideias.');
    if (value.split(/(?<=[.!?])\s+|\n/u).some(sentence => count(sentence) > 35)) push('sentence', 'Frase com mais de 35 palavras. Confira a clareza e a pontuação.');
    if (/\[(?:fonte|cita[çc][aã]o|refer[eê]ncia)[^\]]*(?:pendente|inserir)?\]|\bTODO\b/iu.test(value)) push('citation', 'Há um marcador de fonte ou tarefa pendente neste trecho.');
    const counts = new Map(); for (const term of value.toLocaleLowerCase('pt-BR').match(/\p{L}{4,}/gu) || []) if (!stop.has(term)) counts.set(term, (counts.get(term) || 0) + 1);
    const repeated = [...counts].filter(([, n]) => n >= 5).sort((a,b) => b[1] - a[1]).slice(0, 3);
    if (repeated.length) push('repetition', 'Repetição no parágrafo: ' + repeated.map(([term,n]) => `“${term}” (${n} vezes)`).join(', ') + '. Avalie se é necessária.');
  }
  return results.slice(0, 300);
}
module.exports = { AcademicWriting, kinds, count, words, blockText, review };
