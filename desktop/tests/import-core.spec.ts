import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, writeFile, readdir, realpath, unlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { Library } = require('../electron/library.cjs');
const { Notebooks } = require('../electron/notebook.cjs');
const { Study } = require('../electron/study.cjs');
const bytes = Buffer.from('%PDF-1.7\nLivro de teste.');
async function setup() { const directory = await mkdtemp(path.join(os.tmpdir(), 'lume-import-core-')); const library = new Library(path.join(directory, 'profile')); const source = path.join(directory, 'Meu livro.pdf'); await writeFile(source, bytes); return { directory, library, source }; }

test('cópia idêntica, independente do original e sem duplicatas por nome ou concorrência', async () => {
  const { library, directory, source } = await setup(); const renamed = path.join(directory, 'Outro nome.pdf'); await writeFile(renamed, bytes);
  const [first, second] = await Promise.all([library.acquire(source, bytes, 'pdf'), library.acquire(renamed, bytes, 'pdf')]);
  expect(first.entry.id).toBe(second.entry.id); expect(second.importStatus).toBe('duplicate'); expect(library.list()).toHaveLength(1); expect(await readdir(library.booksDirectory())).toHaveLength(1);
  expect(first.entry.path).not.toBe(source); expect(await readFile(first.entry.path)).toEqual(bytes); expect(await readFile(source)).toEqual(bytes);
  await unlink(source); const restored = new Library(library.directory); const result = await restored.acquire(restored.pathFor(restored.list()[0]), await readFile(first.entry.path), 'pdf', { mode: 'recent', entryId: first.entry.id });
  expect(result.entry).toMatchObject({ name: 'Meu livro.pdf', storage: 'managed', id: first.entry.id });
});
test('migrar referência antiga mantém identidade, progresso, notas, organização e cartões', async () => {
  const { library, source } = await setup(); const old = library.opened(source, bytes.length); library.progress(old.id, 2, 5); library.organize(old.id, { favorite: true, status: 'reading', collection: 'Estudos', tags: ['ler'] });
  const notes = new Notebooks(library.directory, library); notes.bookmark(old.id, { page: 2, label: 'Meu marcador' });
  const study = new Study(library.directory, library); study.card(old.id, { page: 2, front: 'Pergunta', back: 'Resposta' });
  const result = await library.acquire(await realpath(source), bytes, 'pdf'); expect(result.entry).toMatchObject({ id: old.id, page: 2, favorite: true, storage: 'managed' }); expect(notes.read(old.id).bookmarks[0].label).toBe('Meu marcador'); expect(study.read(old.id).book.cards[0].front).toBe('Pergunta');
  library.remove(old.id); expect(library.list()).toHaveLength(0); expect(await readFile(result.entry.path)).toEqual(bytes);
  const restarted = new Library(library.directory); const again = await restarted.acquire(source, bytes, 'pdf'); expect(again.entry).toMatchObject({ id: old.id, page: 2, favorite: true, collection: 'Estudos' }); expect(new Notebooks(library.directory, restarted).read(old.id).bookmarks).toHaveLength(1);
});
test('abrir sem copiar não grava livro e uma nova edição não substitui registros existentes', async () => {
  const { library, source } = await setup(); const first = await library.acquire(source, bytes, 'pdf', { mode: 'external' }); expect(first.entry.storage).toBe('external'); expect(first.entry.path).toBe(source); expect(await readdir(library.directory)).not.toContain('books');
  const different = Buffer.from('%PDF-1.7\nOutra edição.'); await expect(library.acquire(source, different, 'pdf', { mode: 'recent', entryId: first.entry.id })).rejects.toThrow('alterado');
  const second = await library.acquire(source, different, 'pdf'); expect(second.entry.id).not.toBe(first.entry.id); expect(library.list()).toHaveLength(2); expect(library.find(first.entry.id).storage).toBe('external');
});
test('falha no catálogo não cria registro parcial e cópia danificada pode ser reparada', async () => {
  const { library, source } = await setup(); const save = library.save; library.save = () => { throw new Error('disco indisponível'); };
  await expect(library.acquire(source, bytes, 'pdf')).rejects.toThrow('disco'); expect(library.list()).toHaveLength(0); expect((await readdir(library.booksDirectory())).some((file: string) => file.endsWith('.tmp'))).toBe(false);
  library.save = save; const result = await library.acquire(source, bytes, 'pdf'); await writeFile(result.entry.path, 'danificado'); await library.acquire(source, bytes, 'pdf'); expect(await readFile(result.entry.path)).toEqual(bytes); expect(library.list()).toHaveLength(1);
});
test('limite da biblioteca não descarta livros importados silenciosamente', async () => {
  const { library, source } = await setup(); library.documents = Array.from({ length: 500 }, (_, index) => ({ id: String(index), path: path.join(library.directory, `${index}.pdf`), name: `${index}.pdf`, page: 1, totalPages: 1 }));
  await expect(library.acquire(source, bytes, 'pdf')).rejects.toThrow('500'); expect(library.list()).toHaveLength(500); expect(await readdir(library.directory).catch(() => [])).not.toContain('books');
});
