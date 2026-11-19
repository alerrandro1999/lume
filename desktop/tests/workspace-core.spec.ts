import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { mkdtemp, writeFile, readFile, mkdir, readdir, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { Library } = require('../electron/library.cjs'), { Notebooks } = require('../electron/notebook.cjs'), { Study } = require('../electron/study.cjs'), { AudioPlayer } = require('../electron/audio-player.cjs'), { SearchIndex } = require('../electron/search-index.cjs'), { Workspace } = require('../electron/workspace.cjs');
const JSZip = require('jszip');
function services(profile: string) { const library = new Library(profile), notes = new Notebooks(profile, library), study = new Study(profile, library), player = new AudioPlayer(profile), index = new SearchIndex(profile, library, notes), workspace = new Workspace(profile, library, notes, study, player, index, () => {}); return { library, notes, study, player, index, workspace }; }
export function wav(seconds = 10) { const data = Buffer.alloc(44 + 8000 * 2 * seconds); data.write('RIFF'); data.writeUInt32LE(data.length - 8, 4); data.write('WAVEfmt ', 8); data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22); data.writeUInt32LE(8000, 24); data.writeUInt32LE(16000, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34); data.write('data', 36); data.writeUInt32LE(data.length - 44, 40); return data; }
async function setup() { const dir = await mkdtemp(path.join(os.tmpdir(), 'lume-workspace-core-')); const s = services(path.join(dir, 'profile')); const source = path.join(dir, 'Original.pdf'), data = Buffer.from('%PDF-1.7\nBiblioteca de teste.'); await writeFile(source, data); const { entry } = await s.library.acquire(source, data, 'pdf'); s.library.progress(entry.id, 2, 3); return { ...s, dir, source, data, entry }; }

test('backup completo restaura livros, notas, cartões, OCR, preferências, áudio e preserva o catálogo anterior', async () => {
  const s = await setup(), audio = path.join(s.dir, 'Trecho.wav'); await writeFile(audio, wav());
  s.notes.bookmark(s.entry.id, { page: 2, label: 'Capítulo favorito' }); s.notes.annotation(s.entry.id, { page: 2, quote: 'Biblioteca', note: 'Lembrar', color: 'yellow', anchors: [], textAnchors: [] });
  const ocr = s.notes.ocr(s.entry.id, 3, { text: 'Texto reconhecido', confidence: 90, words: [], createdAt: new Date().toISOString() });
  const layout = { order: ['p3-0'], hidden: [], includeMargins: true };
  s.notes.reviewPage(s.entry.id, 3, { layout, expectedRevision: ocr.createdAt, ocr: { ...ocr, text: 'Texto corrigido', blocks: [{ id: 'p3-0', text: 'Texto corrigido', wordCount: 0 }] } });
  s.study.card(s.entry.id, { front: 'Pergunta?', back: 'Resposta!', page: 2 }); s.study.tick(s.entry.id, 20);
  const track = await s.player.add(audio); s.player.progress(track.id, 4, 1.5); s.player.bookmark(track.id, { label: 'Trecho', time: 3 });
  const archive = path.join(s.dir, 'backup.zip'); await s.workspace.createBackup(archive, { 'lume-theme': 'dark' });
  const target = services(path.join(s.dir, 'restored')); const previous = await target.library.acquire(s.source, s.data, 'pdf'); target.notes.bookmark(previous.entry.id, { page: 1, label: 'Anterior' });
  const plan = await target.workspace.preview(archive); expect(plan.books).toBe(1); expect(plan.audio).toBe(1); const result = await target.workspace.restore(plan.id);
  expect(result.prefs).toEqual({ 'lume-theme': 'dark' }); expect(target.library.list()[0].page).toBe(2); expect(await readFile(target.library.list()[0].path)).toEqual(s.data); expect(target.notes.read(s.entry.id)).toEqual(s.notes.read(s.entry.id)); expect(target.study.data).toEqual(s.study.data); expect(target.player.list()[0].position).toBe(4); expect(await readFile(target.player.list()[0].path)).toEqual(wav()); expect(await readdir(result.recovery)).toContain('library.json'); expect(await readFile(s.source)).toEqual(s.data); expect((await readdir(target.library.directory)).some(name => name.startsWith('.restore-'))).toBe(false);
  const reloaded = services(target.library.directory); expect(reloaded.library.list()[0].storage).toBe('managed'); expect(reloaded.player.list()[0].bookmarks[0].label).toBe('Trecho');
});
test('backup adulterado e caminhos maliciosos são recusados sem alterar a biblioteca', async () => {
  const s = await setup(), archive = path.join(s.dir, 'backup.zip'); await s.workspace.createBackup(archive, {}); const zip = await JSZip.loadAsync(await readFile(archive)); const payload = Object.keys(zip.files).find(name => name.startsWith('books/'))!; zip.file(payload, 'conteúdo adulterado', { createFolders: false }); await writeFile(archive, await zip.generateAsync({ type: 'nodebuffer' }));
  const before = JSON.stringify(s.library.list()), plan = await s.workspace.preview(archive); await expect(s.workspace.restore(plan.id)).rejects.toThrow('integridade'); expect(JSON.stringify(s.library.list())).toBe(before); expect(await readFile(s.entry.path)).toEqual(s.data);
  zip.file('arquivo-intruso.txt', 'recusado'); await writeFile(archive, await zip.generateAsync({ type: 'nodebuffer' })); await expect(s.workspace.preview(archive)).rejects.toThrow('inválidos');
});
test('restauração volta ao catálogo anterior se houver falha ao gravar os metadados', async () => {
  const s = await setup(), archive = path.join(s.dir, 'backup.zip'); await s.workspace.createBackup(archive, {}); const before = await readFile(s.library.file), plan = await s.workspace.preview(archive), originalSave = s.study.save; s.study.save = () => { throw new Error('Falha simulada no disco'); };
  await expect(s.workspace.restore(plan.id)).rejects.toThrow('Falha simulada'); s.study.save = originalSave; expect(await readFile(s.library.file)).toEqual(before); expect(s.library.find(s.entry.id)).toBeTruthy();
});
test('muda pasta, confere conteúdo e exclui apenas cópia local mantendo notas recuperáveis', async () => {
  const s = await setup(); s.notes.bookmark(s.entry.id, { page: 2, label: 'Preservado' }); const folder = path.join(s.dir, 'nova'); await mkdir(folder); const moved = await s.workspace.relocate(folder, true); expect(moved.copied).toBe(1); expect(moved.removed).toBe(1); expect(await readFile(s.source)).toEqual(s.data); const reloaded = services(s.library.directory); expect(reloaded.library.booksDirectory()).toBe(moved.root); expect(await readFile(reloaded.library.pathFor(reloaded.library.list()[0]))).toEqual(s.data);
  const storage = await s.workspace.storage(); expect(storage.files).toHaveLength(1); await s.workspace.deleteCopy(storage.files[0].key); expect(s.library.list()).toHaveLength(0); expect(await readFile(s.source)).toEqual(s.data); const recovered = await s.library.acquire(s.source, s.data, 'pdf'); expect(recovered.entry.id).toBe(s.entry.id); expect(recovered.entry.page).toBe(2); expect(s.notes.read(s.entry.id).bookmarks[0].label).toBe('Preservado');
});
test('exclusão protege uma cópia que também é origem cadastrada e rejeita caminhos arbitrários', async () => {
  const s = await setup(); s.library.find(s.entry.id).originalPath = s.entry.path; const file = (await s.workspace.storage()).files[0]; await expect(s.workspace.deleteCopy(file.key)).rejects.toThrow('origem cadastrada'); await expect(s.workspace.deleteCopy('../Original.pdf')).rejects.toThrow('inválida'); expect(await readFile(s.entry.path)).toEqual(s.data);
});
test('pasta conflitante e cancelamento preservam catálogo e arquivos originais', async () => {
  const s = await setup(), folder = path.join(s.dir, 'conflito'); await mkdir(path.join(folder, 'Lume Livros'), { recursive: true }); await writeFile(path.join(folder, 'Lume Livros', path.basename(s.entry.path)), 'errado'); const before = s.library.booksDirectory(); await expect(s.workspace.relocate(folder, true)).rejects.toThrow('conflitante'); expect(s.library.booksDirectory()).toBe(before);
  const archive = path.join(s.dir, 'cancelado.zip'); s.workspace.notify = (progress: {running: boolean}) => { if (progress.running) s.workspace.cancel(); }; await expect(s.workspace.createBackup(archive, {})).rejects.toThrow('cancelada'); expect((await readdir(s.dir)).some(name => name.endsWith('.tmp'))).toBe(false); expect(await readFile(s.source)).toEqual(s.data);
});
test('busca local ignora acentos, inclui notas sem índice e invalida conteúdo após OCR', async () => {
  const s = await setup(); s.notes.bookmark(s.entry.id, { page: 2, label: 'Observação importante' }); expect(s.index.query('observacao').hits[0].kind).toBe('bookmark'); const fingerprint = s.index.fingerprint(s.entry); s.index.save(s.entry.id, [{ page: 3, text: 'Uma história sobre a leitura.' }], fingerprint); expect(s.index.query('historia').hits[0].page).toBe(3); expect(s.index.status()[0].ready).toBe(true); s.notes.ocr(s.entry.id, 3, { text: 'Novo OCR', words: [] }); expect(s.index.status()[0].ready).toBe(false); expect(s.index.query('historia').hits).toHaveLength(0); expect(s.index.query('importante', 'notes').hits).toHaveLength(1); expect(() => s.index.save(s.entry.id, [], fingerprint)).toThrow('mudou');
});
test('player salva posição, marcadores e serve intervalos para busca no áudio', async () => {
  const s = await setup(), audio = path.join(s.dir, 'Teste.wav'), data = wav(); await writeFile(audio, data); const track = await s.player.add(audio); expect(track.duration).toBe(10); s.player.progress(track.id, 3, 1.25); s.player.bookmark(track.id, { time: 3, label: 'Voltar aqui' }); expect(new AudioPlayer(s.library.directory).list()[0].position).toBe(3);
  const response = await s.player.response(track.id, new Request(track.url, { headers: { range: 'bytes=44-63' } })); expect(response.status).toBe(206); expect(response.headers.get('content-range')).toBe(`bytes 44-63/${data.length}`); expect(Buffer.from(await response.arrayBuffer())).toEqual(data.subarray(44, 64)); const invalid = await s.player.response(track.id, new Request(track.url, { headers: { range: 'bytes=9999999-' } })); expect(invalid.status).toBe(416); expect(s.player.sleep(30, () => {})).toBeGreaterThan(Date.now()); expect(s.player.sleep(0, () => {})).toBe(0); expect((await s.player.add(await realpath(audio))).id).toBe(track.id); expect(s.player.list()).toHaveLength(1);
});
test('player converte corretamente a escala de tempo dos capítulos M4B', async () => {
  const s = await setup(), audio = path.join(s.dir, 'Metadados de capítulos.m4b');
  const box = (name: string, data: Buffer) => { const header = Buffer.alloc(8); header.writeUInt32BE(data.length + 8); header.write(name, 4); return Buffer.concat([header, data]); };
  const chapters = [{ title: 'Introdução', start: 0 }, { title: 'Segunda parte', start: 90.5 }];
  const table = Buffer.concat([Buffer.from([0, 0, 0, 0, 2]), ...chapters.map(chapter => { const title = Buffer.from(chapter.title), timing = Buffer.alloc(9); timing.writeBigUInt64BE(BigInt(chapter.start * 10000000)); timing[8] = title.length; return Buffer.concat([timing, title]); })]);
  await writeFile(audio, Buffer.concat([box('ftyp', Buffer.from('M4B \0\0\0\0M4B isom')), box('moov', box('udta', box('chpl', table)))]));
  const result = await s.player.add(audio); expect(result.chapters).toEqual(chapters);
});
