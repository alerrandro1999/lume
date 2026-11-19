import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { ConceptMaps, conceptSources, conceptSvg } = require('../electron/concept-maps.cjs');
const directory = () => fs.mkdtempSync(path.join(os.tmpdir(), 'lume-concept-core-'));
const node = (title: string, x = 0) => ({ id: randomUUID(), title, x, y: -80, kind: 'idea', notes: 'Uma ideia com acentos.', color: 'violet', source: null });

test('preserva posições, vínculos e relações, exporta SVG seguro e importa uma cópia editável', () => {
  const root = directory(), store = new ConceptMaps(root);
  const map = store.create('Pesquisa <conectada>');
  const first = node('Aprendizagem & pesquisa'), second = { ...node('Uma referência', 360), kind: 'reference', source: { kind: 'review', id: randomUUID(), recordId: randomUUID(), title: 'Obra de referência' } };
  const edge = { id: randomUUID(), from: first.id, to: second.id, fromPort: 'right', toPort: 'left', label: 'fundamenta <script>', style: 'dashed', color: 'teal' };
  const saved = store.save(map.id, { ...map, nodes: [first, second], edges: [edge] });
  expect(new ConceptMaps(root).open(map.id)).toEqual(saved);
  expect(store.list()[0]).toMatchObject({ nodeCount: 2, edgeCount: 1 });
  const xml = conceptSvg(saved);
  expect(xml).toContain('Pesquisa &lt;conectada&gt;');
  expect(xml).toContain('fundamenta &lt;script&gt;');
  expect(xml).not.toContain('<script>');
  expect(xml).toContain('marker-end="url(#arrow-teal)"');
  expect(xml).toContain('stroke-dasharray="7 5"');
  const imported = store.import(JSON.parse(store.json(map.id)));
  expect(imported.id).not.toBe(map.id);
  expect(imported.nodes).toEqual(saved.nodes);
  expect(imported.edges).toEqual(saved.edges);
  expect(store.remove(map.id)).toHaveLength(1);
  expect(store.open(imported.id).nodes).toHaveLength(2);
});

test('recusa conexões órfãs, duplicatas e posições inválidas e conserva o catálogo em falhas', () => {
  const root = directory(), store = new ConceptMaps(root);
  const map = store.create('Meu mapa'), first = node('Primeira'), second = node('Segunda', 300);
  const edge = { id: randomUUID(), from: first.id, to: second.id, fromPort: 'right', toPort: 'left', label: '', style: 'solid', color: 'slate' };
  store.save(map.id, { ...map, nodes: [first, second], edges: [edge] });
  const before = fs.readFileSync(store.file, 'utf8');
  expect(() => store.save(map.id, { ...map, nodes: [first], edges: [edge] })).toThrow('Conexão inválida');
  expect(() => store.save(map.id, { ...map, nodes: [first, second], edges: [edge, { ...edge, id: randomUUID() }] })).toThrow('Já existe');
  expect(() => store.save(map.id, { ...map, nodes: [{ ...first, x: Infinity }], edges: [] })).toThrow('Posição');
  expect(() => store.import({ format: 'outro-formato', version: 1 })).toThrow('exportado pelo Lume');
  const rename = fs.renameSync;
  fs.renameSync = () => { throw new Error('Disco indisponível'); };
  try { expect(() => store.save(map.id, { ...map, nodes: [], edges: [] })).toThrow('indisponível'); }
  finally { fs.renameSync = rename; }
  expect(fs.readFileSync(store.file, 'utf8')).toBe(before);
  expect(store.open(map.id).nodes).toHaveLength(2);
  expect(fs.readdirSync(root)).toEqual(['concept-maps.json']);
  fs.writeFileSync(store.file, '{interrompido');
  const broken = new ConceptMaps(root);
  expect(() => broken.list()).toThrow('concept-maps.json');
  expect(() => broken.create('Novo')).toThrow('concept-maps.json');
  expect(fs.readFileSync(store.file, 'utf8')).toBe('{interrompido');
});

test('busca fontes reais por título e autor e mantém o identificador da referência', () => {
  const library = { list: () => [{ id: 'book-1', title: 'Aprendizagem e leitura', author: 'Silva, Ana' }] };
  const referenceId = randomUUID(), projectId = randomUUID();
  const bibliography = { list: () => [{ id: projectId, title: 'Minha revisão' }], get: () => ({ records: [{ id: referenceId, title: 'Práticas de estudo', authors: 'Silva, Ana; Costa, João', year: '2025' }] }) };
  const all = conceptSources(library, bibliography);
  expect(all.filter((item: { kind: string }) => item.kind === 'author')).toHaveLength(2);
  expect(all.find((item: { kind: string }) => item.kind === 'reference').source).toMatchObject({ id: projectId, recordId: referenceId });
  expect(conceptSources(library, bibliography, 'joao').some((item: { title: string }) => item.title === 'Costa, João')).toBe(true);
  expect(conceptSources(library, bibliography, 'aprendizagem')[0].kind).toBe('book');
  expect(conceptSources(library, bibliography, 'não existe')).toEqual([]);
});
