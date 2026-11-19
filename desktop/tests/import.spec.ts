import { _electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, readdir, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { Library } = require('../electron/library.cjs');
const { Notebooks } = require('../electron/notebook.cjs');
const { Study } = require('../electron/study.cjs');
test.describe.configure({ mode: 'serial' });
let app: ElectronApplication, window: Page, directory: string, profile: string, legacyPath: string, original: string, renamed: string, external: string, relocated: string, epub: string, bad: string;
let legacyId: string, copiedId: string, externalId: string, epubId: string, pdfHash: string;
const errors: string[] = [];
async function makePdf(file: string, title: string) { const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica); for (let index = 1; index <= 3; index++) pdf.addPage([595, 842]).drawText(`${title} - ${index}`, { x: 60, y: 700, size: 20, font }); await writeFile(file, await pdf.save()); }
async function launch() {
  const env: Record<string, string> = {}; for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value;
  delete env.ELECTRON_RUN_AS_NODE; delete env.LUME_DEV_URL; env.LUME_TEST_MODE = '1'; env.LUME_USER_DATA = profile;
  app = await _electron.launch({ args: ['.'], env }); window = await app.firstWindow(); window.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false));
  await window.getByRole('button', { name: 'Abrir Lume Leitor' }).click();
  await expect(window.getByRole('heading', { name: /Sua próxima página/ })).toBeVisible();
}
async function dialog(file: string | null) { await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = (async () => ({ canceled: file === null, filePaths: file ? [file] : [] })) as typeof dialog.showOpenDialog; }, file); }
async function choose(file: string, mode = 'import') { await dialog(file); await window.getByRole('button', { name: mode === 'import' ? 'Importar livro' : 'Abrir sem copiar', exact: true }).click(); await expect(window.locator('.loading-overlay')).toHaveCount(0); }
async function entries() { return window.evaluate(() => globalThis.window.lume.listRecent()); }
test.beforeAll(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'lume-import-ui-')); profile = path.join(directory, 'profile'); await mkdir(profile);
  legacyPath = path.join(directory, 'Livro antigo.pdf'); original = path.join(directory, 'Livro com cópia.pdf'); renamed = path.join(directory, 'Mesmo conteúdo com outro nome.pdf'); external = path.join(directory, 'Somente externo.pdf'); relocated = path.join(directory, 'Externo movido.pdf'); epub = path.join(directory, 'Meu EPUB.epub'); bad = path.join(directory, 'Inválido.pdf');
  await makePdf(legacyPath, 'Livro antigo'); await makePdf(original, 'Copia local'); await makePdf(external, 'Arquivo externo'); await copyFile(original, renamed); await copyFile('examples/Entre páginas.epub', epub); await writeFile(bad, 'Arquivo sem PDF.');
  pdfHash = createHash('sha256').update(await readFile(original)).digest('hex');
  const library = new Library(profile); const record = library.opened(legacyPath, (await readFile(legacyPath)).length); legacyId = record.id; library.progress(legacyId, 2, 3);
  new Notebooks(profile, library).bookmark(legacyId, { page: 2, label: 'Marcador antigo' }); new Study(profile, library).card(legacyId, { page: 2, front: 'Pergunta antiga', back: 'Resposta antiga' });
  await writeFile(path.join(profile, 'library.json'), JSON.stringify({ version: 1, documents: library.list() })); await launch();
});
test.afterAll(async () => { await app?.close(); });

test('guarda um livro antigo no app sem perder progresso, marcadores e cartões', async () => {
  await expect(window.locator('.book-storage')).toHaveText('Arquivo externo');
  expect(await window.getByRole('button', { name: 'Guardar Livro antigo no app', exact: true }).evaluate(element => element.getBoundingClientRect().bottom <= element.closest('.document-card')!.getBoundingClientRect().bottom)).toBe(true);
  await window.getByRole('button', { name: 'Guardar Livro antigo no app', exact: true }).click(); await expect(window.locator('.document-heading h1')).toHaveText('Livro antigo');
  const entry = (await entries())[0]; expect(entry.id).toBe(legacyId); expect(entry.storage).toBe('managed'); expect(entry.path.startsWith(path.join(profile, 'books'))).toBe(true); await expect(window.getByLabel('Página atual', { exact: true })).toHaveValue('2');
  const data = await window.evaluate(async id => ({ notes: await globalThis.window.lume.readNotebook(id), study: await globalThis.window.lume.readStudy(id) }), legacyId); expect(data.notes.bookmarks[0].label).toBe('Marcador antigo'); expect(data.study.book.cards[0].front).toBe('Pergunta antiga'); expect(await readFile(legacyPath)).toEqual(await readFile(entry.path));
});
test('importa por padrão, deduplica nomes diferentes e mantém a posição salva', async () => {
  await choose(original); await expect(window.locator('.document-heading h1')).toHaveText('Livro com cópia'); const entry = (await entries())[0]; copiedId = entry.id; expect(entry.contentHash).toBe(pdfHash); expect(entry.storage).toBe('managed'); expect(entry.path).not.toBe(original);
  await window.getByLabel('Página atual', { exact: true }).fill('2'); await window.getByLabel('Página atual', { exact: true }).press('Enter'); await expect(window.locator('.position-saved')).toContainText('página 2');
  await window.evaluate(id => globalThis.window.lume.saveBookmark(id, { page: 2, label: 'Preservar na reimportação' }), copiedId);
  await choose(renamed); await expect(window.locator('.import-notice')).toContainText('já está guardado'); expect((await entries())[0].id).toBe(copiedId); expect(await entries()).toHaveLength(2); expect(await readdir(path.join(profile, 'books'))).toHaveLength(2); await expect(window.getByLabel('Página atual', { exact: true })).toHaveValue('2');
});
test('reabre a cópia após excluir o original e reiniciar o aplicativo', async () => {
  await unlink(original); await app.close(); await launch(); await window.locator('.document-card').filter({ hasText: 'Livro com cópia' }).locator('.document-card-main').click(); await expect(window.locator('.document-heading h1')).toHaveText('Livro com cópia'); await expect(window.getByLabel('Página atual', { exact: true })).toHaveValue('2'); await expect(window.locator('#pdf-container .textLayer')).toContainText('Copia local');
  const entry = (await entries())[0]; expect(createHash('sha256').update(await readFile(entry.path)).digest('hex')).toBe(pdfHash);
});
test('abre sem copiar e permite localizar e guardar uma referência movida', async () => {
  await choose(external, 'external'); const entry = (await entries())[0]; externalId = entry.id; expect(entry.path).toBe(await realpath(external)); expect(entry.storage).toBe('external'); expect(await readdir(path.join(profile, 'books'))).toHaveLength(2);
  await rename(external, relocated); await app.close(); await launch(); await window.locator('.document-card').filter({ hasText: 'Somente externo' }).locator('.document-card-main').click(); await expect(window.getByRole('alert')).toContainText('Arquivo não encontrado'); await window.getByRole('button', { name: 'Fechar aviso' }).click();
  await dialog(relocated); await window.getByRole('button', { name: 'Guardar Somente externo no app', exact: true }).click(); await expect(window.locator('.document-heading h1')).toHaveText('Somente externo'); const restored = (await entries())[0]; expect(restored.id).toBe(externalId); expect(restored.storage).toBe('managed'); expect(await readdir(path.join(profile, 'books'))).toHaveLength(3);
});
test('arquivos inválidos e diálogo cancelado não criam cópias nem substituem a leitura', async () => {
  await choose(bad); await expect(window.getByRole('alert')).toContainText('não contém um PDF válido'); await expect(window.locator('.document-heading h1')).toHaveText('Somente externo'); await window.getByRole('button', { name: 'Fechar aviso' }).click();
  await dialog(null); await window.getByRole('button', { name: 'Importar livro', exact: true }).click(); await expect(window.locator('.loading-overlay')).toHaveCount(0); expect(await entries()).toHaveLength(3); expect(await readdir(path.join(profile, 'books'))).toHaveLength(3);
});
test('EPUB copiado mantém nome, capa e CFI sem depender do arquivo de origem', async () => {
  await choose(epub); await expect(window.locator('.document-heading h1')).toHaveText('Entre páginas'); const entry = (await entries())[0]; epubId = entry.id; expect(entry.storage).toBe('managed'); expect(entry.name).toBe('Meu EPUB.epub');
  await window.getByRole('button', { name: 'Virar para a próxima página', exact: true }).click(); await expect.poll(async () => (await entries())[0].epubLocation?.cfi).not.toBe(entry.epubLocation?.cfi); await unlink(epub); await app.close(); await launch(); await expect(window.locator('.actual-cover')).toBeVisible(); await window.locator('.document-card').filter({ hasText: 'Entre páginas' }).locator('.document-card-main').click(); await expect(window.locator('.document-heading h1')).toHaveText('Entre páginas'); expect((await entries())[0].id).toBe(epubId); expect((await entries())[0].epubLocation?.cfi).toMatch(/^epubcfi\(/);
});
test('remover da lista e reimportar recupera o livro, sem apagar a cópia e as notas', async () => {
  await window.getByRole('button', { name: 'Lume, ir para biblioteca', exact: true }).click(); const previous = (await entries()).find(entry => entry.id === copiedId)!;
  await window.getByRole('button', { name: 'Remover Livro com cópia.pdf da lista', exact: true }).click(); expect((await entries()).some(entry => entry.id === copiedId)).toBe(false); expect(await readFile(previous.path)).toBeTruthy();
  await choose(renamed); await expect(window.locator('.document-heading h1')).toHaveText('Livro com cópia'); expect((await entries())[0].id).toBe(copiedId); expect((await entries())[0].page).toBe(2); const notebook = await window.evaluate(id => globalThis.window.lume.readNotebook(id), copiedId); expect(notebook.bookmarks[0].label).toBe('Preservar na reimportação'); expect(await readdir(path.join(profile, 'books'))).toHaveLength(4); expect(errors).toEqual([]);
});
