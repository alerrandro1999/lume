import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { Library } = require('../electron/library.cjs');
const { Study } = require('../electron/study.cjs');
const { waveParts } = require('../electron/audiobook.cjs');

test('coleções e favoritos sobrevivem ao progresso e à migração da biblioteca', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'lume-library-core-'));
  const library = new Library(directory), entry = library.opened(path.join(directory, 'Livro.pdf'), 100);
  library.organize(entry.id, { status: 'wishlist', favorite: true, collection: 'Faculdade', tags: ['história', 'história'] });
  library.progress(entry.id, 2, 9); library.opened(entry.path, 100);
  const restored = new Library(directory).find(entry.id);
  expect(restored).toMatchObject({ page: 2, favorite: true, status: 'wishlist', collection: 'Faculdade', tags: ['história'] });
  expect(() => library.organize(entry.id, { favorite: true, status: 'invalid', tags: [], collection: '' })).toThrow();
});
test('tempo, amostras, recorte e revisões persistem sem modificar o livro', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'lume-study-core-'));
  const library = new Library(directory), entry = library.opened(path.join(directory, 'Livro.pdf'), 100); library.progress(entry.id, 1, 8);
  const study = new Study(directory, library), settings = study.read(entry.id).settings;
  study.settings({ ...settings, goal: 30, reminders: true });
  study.tick(entry.id, 20); study.tick(entry.id, 0, { words: 90, seconds: 30 });
  study.crop(entry.id, { top: .1, left: .05, right: .05, bottom: .1 });
  study.card(entry.id, { front: 'Qual a ideia?', back: 'A resposta fica no livro.', page: 3 });
  const card = study.read(entry.id).book.cards[0];
  study.review(entry.id, card.id, 'good');
  let restored = new Study(directory, library).read(entry.id);
  expect(restored).toMatchObject({ todaySeconds: 20, settings: { goal: 30, reminders: true }, book: { seconds: 20, paceWords: 90, paceSeconds: 30, samples: 1, crop: { top: .1 }, cards: [{ reviews: 1, interval: 1 }] } });
  expect(restored.book.cards[0].due).toBeGreaterThan(Date.now() + 23 * 3600000);
  study.review(entry.id, card.id, 'again'); restored = study.read(entry.id); expect(restored.book.cards[0].due).toBeLessThan(Date.now() + 61000);
  expect(() => study.tick(entry.id, 600)).toThrow(); expect(() => study.crop(entry.id, { top: 1 })).toThrow(); expect(() => study.read('../invalid')).toThrow();
  expect(JSON.parse(await readFile(path.join(directory, 'study.json'), 'utf8')).books[entry.id].cards[0].reviews).toBe(2);
});
test('o leitor de WAV aceita blocos extras e rejeita áudio truncado', () => {
  const format = Buffer.alloc(16); format.writeUInt16LE(1, 0); format.writeUInt16LE(1, 2); format.writeUInt32LE(16000, 4); format.writeUInt32LE(32000, 8); format.writeUInt16LE(2, 12); format.writeUInt16LE(16, 14);
  const riff = Buffer.alloc(64); riff.write('RIFF'); riff.writeUInt32LE(56, 4); riff.write('WAVE', 8); riff.write('JUNK', 12); riff.writeUInt32LE(4, 16); riff.write('fmt ', 24); riff.writeUInt32LE(16, 28); format.copy(riff, 32); riff.write('data', 48); riff.writeUInt32LE(8, 52); riff.fill(1, 56);
  const result = waveParts(riff); expect(result.format.equals(format)).toBe(true); expect(result.pcm.length).toBe(8);
  expect(() => waveParts(riff.subarray(0, 60))).toThrow('incompleto');
});
