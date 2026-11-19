import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { AcademicPortfolio, portfolioHtml } = require('../electron/portfolio.cjs');
const root = () => fs.mkdtempSync(path.join(os.tmpdir(), 'lume-portfolio-core-'));
const draft = { kind: 'experience', title: 'Estágio em educação', organization: 'Instituição', role: 'Estagiária', start: '2026-01', end: '', current: true, summary: 'Atividades de apoio.', outcomes: 'Planejamento de atividades.', skills: 'Competência relacionada', url: '', visible: true, featured: false, experienceType: 'internship', supervisor: 'Supervisora', targetHours: 100 };

test('persiste a trajetória e o diário em minutos e protege atividades ao alterar o tipo de estágio', () => {
  const directory = root(), store = new AcademicPortfolio(directory);
  let data = store.saveProfile({ ...store.read().profile, name: 'Ana Silva', email: 'ana@example.org' });
  data = store.saveEntry(null, draft); const entry = data.entries[0];
  data = store.saveLog(null, { entryId: entry.id, date: '2026-11-19', minutes: 150, activity: 'Planejamento', learning: 'Trabalho em equipe.' });
  expect(data.logs[0].minutes).toBe(150); expect(store.csv()).toContain('2,50');
  expect(() => store.saveEntry(entry.id, { ...draft, kind: 'project' })).toThrow('atividades registradas');
  expect(() => store.saveLog(null, { entryId: entry.id, date: '2026-02-30', minutes: 30, activity: 'Teste', learning: '' })).toThrow('data válida');
  expect(() => store.saveLog(null, { entryId: entry.id, date: '2026-11-19', minutes: -1, activity: 'Teste', learning: '' })).toThrow('24 horas');
  expect(new AcademicPortfolio(directory).read()).toEqual(data);
  data = store.removeEntry(entry.id); expect(data.logs).toHaveLength(0);
});
test('respeita a seleção para exportação, oculta contatos e competências e escapa textos no HTML', () => {
  const store = new AcademicPortfolio(root());
  store.saveProfile({ ...store.read().profile, name: 'Ana <script>alert(1)</script>', email: 'email-reservado@example.org', website: 'https://example.org' });
  store.saveEntry(null, draft); store.saveEntry(null, { ...draft, kind: 'project', title: 'PROJETO RESERVADO', visible: false });
  store.saveSkill(null, { name: 'Competência global', category: 'technical', level: 'learning' });
  store.savePreferences({ theme: 'violet', showContacts: false, showSkills: false });
  const html = portfolioHtml(store.read());
  expect(html).toContain('Ana &lt;script&gt;'); expect(html).not.toContain('<script>');
  expect(html).not.toContain('email-reservado'); expect(html).not.toContain('PROJETO RESERVADO'); expect(html).not.toContain('Competência global'); expect(html).not.toContain('Competência relacionada');
  expect(() => store.saveEntry(null, { ...draft, url: 'javascript:alert(1)' })).toThrow('HTTP');
  expect(() => store.saveProfile({ ...store.read().profile, name: '' })).toThrow('nome completo');
});
test('importa projetos uma única vez, preserva a ordem por categoria e mantém os dados anteriores se a gravação falhar', () => {
  const store = new AcademicPortfolio(root());
  const project = { id: randomUUID(), title: 'Projeto do hub', course: 'Pedagogia', startDate: '2026-01-01', status: 'active', plan: { generalObjective: 'Investigar práticas.', topic: '' } };
  store.importProject(project); expect(() => store.importProject(project)).toThrow('já foi');
  let data = store.saveEntry(null, { ...draft, kind: 'education', title: 'Formação' });
  data = store.saveEntry(null, { ...draft, kind: 'project', title: 'Outro projeto' }); const other = data.entries[2];
  data = store.move(other.id, -1); expect(data.entries.filter((entry: { kind: string }) => entry.kind === 'project')[0].title).toBe('Outro projeto');
  const before = fs.readFileSync(store.file, 'utf8'), rename = fs.renameSync;
  fs.renameSync = () => { throw Error('Disco indisponível'); };
  try { expect(() => store.saveEntry(null, draft)).toThrow('indisponível'); } finally { fs.renameSync = rename; }
  expect(fs.readFileSync(store.file, 'utf8')).toBe(before); expect(store.read()).toEqual(data);
  fs.writeFileSync(store.file, '{interrompido'); const broken = new AcademicPortfolio(path.dirname(store.file));
  expect(() => broken.read()).toThrow('portfolio.json'); expect(() => broken.saveEntry(null, draft)).toThrow('portfolio.json'); expect(fs.readFileSync(store.file, 'utf8')).toBe('{interrompido');
});
test('guarda comprovantes como cópias e remove apenas os arquivos cadastrados', async () => {
  const directory = root(), store = new AcademicPortfolio(directory), data = store.saveEntry(null, draft), entry = data.entries[0];
  const original = path.join(directory, 'Declaracao.pdf'); fs.writeFileSync(original, '%PDF-conteudo-de-teste');
  const result = await store.addEvidence(entry.id, [original]); expect(result.added).toBe(1); expect(result.errors).toEqual([]);
  const file = result.data.evidence[0]; expect(store.fileFor(file)).not.toBe(original); expect(fs.existsSync(store.fileFor(file))).toBe(true);
  store.removeEntry(entry.id); expect(fs.existsSync(store.fileFor(file))).toBe(false); expect(fs.readFileSync(original, 'utf8')).toBe('%PDF-conteudo-de-teste');
});
