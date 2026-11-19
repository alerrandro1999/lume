import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { Presentations } = require('../electron/presentations.cjs');
const draft = { title: 'Seminário de Metodologia', course: 'Metodologia', audience: 'Turma', sections: [{ title: 'Abertura', notes: 'Apresentar a pergunta.', seconds: 60 }, { title: 'Resultados', notes: 'Explicar os dados.', seconds: 120 }] };
const root = () => fs.mkdtempSync(path.join(os.tmpdir(), 'lume-presentations-core-'));

test('cronometra cada tópico, desconta pausas, preserva o roteiro de cada ensaio e recupera interrupções', () => {
  const directory = root();
  let store = new Presentations(directory);
  const project = store.save(null, draft)[0];
  const take = store.begin(project.id, false);
  store.active.since -= 10_000;
  expect(store.checkpoint(take.id).durationMs).toBe(0);
  store.pause(take.id, false);
  store.active.since -= 1500;
  let clock = store.section(take.id, 1);
  expect(clock.sectionMs[0]).toBeGreaterThanOrEqual(1500);
  store.active.since -= 2500;
  clock = store.pause(take.id, true);
  const paused = clock.durationMs;
  store.active.since -= 20_000;
  expect(store.checkpoint(take.id).durationMs).toBe(paused);
  store.pause(take.id, false);
  store.active.since -= 1000;
  let state = store.finish(take.id);
  const saved = state[0].takes[0];
  expect(saved.durationMs).toBeGreaterThanOrEqual(5000);
  expect(saved.durationMs).toBeLessThan(5500);
  expect(saved.sectionMs[1]).toBeGreaterThanOrEqual(3500);
  expect(saved.durationMs).toBeCloseTo(saved.sectionMs.reduce((sum: number, time: number) => sum + time, 0), 5);
  state = store.save(project.id, { ...draft, title: 'Roteiro atualizado', sections: [{ title: 'Novo roteiro', notes: '', seconds: 600 }] });
  expect(state[0].takes[0].script).toEqual(draft);
  store.assess(take.id, { clarity: 4, organization: 3, knowledge: 5, pace: 2, notes: 'Explicar melhor o gráfico.' });
  expect(store.report(take.id)).toContain('Clareza: 4/5');
  expect(store.report(take.id)).toContain('Seminário de Metodologia');
  store = new Presentations(directory);
  expect(store.read()[0].takes[0].assessment.notes).toBe('Explicar melhor o gráfico.');
  const interrupted = store.begin(project.id, false);
  store.pause(interrupted.id, false);
  store.active.since -= 1100;
  store.checkpoint(interrupted.id);
  store = new Presentations(directory);
  expect(store.read()[0].takes[0]).toMatchObject({ id: interrupted.id, status: 'interrupted' });
  expect(store.read()[0].takes[0].durationMs).toBeGreaterThanOrEqual(1100);
  expect(store.remove(project.id)).toEqual([]);
});

test('grava trechos em ordem, aceita repetição após falha e serve intervalos WebM', async () => {
  const store = new Presentations(root());
  const project = store.save(null, draft)[0];
  const take = store.begin(project.id, true);
  const first = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]);
  store.append(take.id, 0, first);
  store.append(take.id, 0, first);
  expect(() => store.append(take.id, 2, new Uint8Array([7]))).toThrow('inválido');
  const write = fs.writeSync;
  let writes = 0;
  fs.writeSync = ((fd: number, buffer: Uint8Array, offset: number, length: number, position: number) => {
    if (++writes === 1) return write(fd, buffer, offset, 1, position);
    throw new Error('Disco sem espaço');
  }) as typeof fs.writeSync;
  try { expect(() => store.append(take.id, 1, new Uint8Array([5, 6, 7]))).toThrow('sem espaço'); }
  finally { fs.writeSync = write; }
  expect([...fs.readFileSync(store.audioFile(take.id))]).toEqual([...first]);
  store.append(take.id, 1, new Uint8Array([5, 6, 7]));
  store.finish(take.id);
  const response = await store.response(take.id, new Request('lume://app/test', { headers: { range: 'bytes=2-5' } }));
  expect(response.status).toBe(206);
  expect(response.headers.get('content-type')).toBe('audio/webm');
  expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([0xdf, 0xa3, 5, 6]);
  expect(store.read()[0].takes[0].audioUrl).toContain(take.id);
  store.removeTake(take.id);
  expect(fs.existsSync(store.audioFile(take.id))).toBe(false);
});

test('uma falha no disco conserva o catálogo e dados corrompidos não são sobrescritos', () => {
  const directory = root();
  const store = new Presentations(directory);
  const project = store.save(null, draft)[0];
  expect(() => store.save(null, { ...draft, sections: [] })).toThrow('tópicos');
  expect(() => store.save(null, { ...draft, sections: [{ ...draft.sections[0], seconds: -1 }] })).toThrow('tempo válido');
  expect(() => store.assess('missing', {})).toThrow('não encontrado');
  const before = fs.readFileSync(store.file, 'utf8');
  const rename = fs.renameSync;
  fs.renameSync = () => { throw new Error('Disco indisponível'); };
  try { expect(() => store.save(project.id, { ...draft, title: 'Não deve aparecer' })).toThrow('indisponível'); }
  finally { fs.renameSync = rename; }
  expect(store.read()[0].title).toBe(draft.title);
  expect(fs.readFileSync(store.file, 'utf8')).toBe(before);
  expect(fs.readdirSync(store.directory)).toEqual(['projects.json']);
  fs.writeFileSync(store.file, '{interrompido');
  const invalid = new Presentations(directory);
  expect(() => invalid.read()).toThrow('presentations');
  expect(() => invalid.save(null, draft)).toThrow('presentations');
  expect(fs.readFileSync(store.file, 'utf8')).toBe('{interrompido');
});
