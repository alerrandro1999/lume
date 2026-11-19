import { _electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
test.describe.configure({ mode: 'serial' });
let app: ElectronApplication, window: Page, directory: string, profile: string, first: string, second: string, epub: string, audio: string, archive: string, moved: string, firstHash: string;
const errors: string[] = [];
const dialog = () => window.getByRole('dialog', { name: 'Central da biblioteca', exact: true });
async function chooseFiles(files: string[]) { await app.evaluate(({ dialog }, files) => { dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: files })) as typeof dialog.showOpenDialog; }, files); }
async function openCentral(name: string) { await window.locator('.library-utilities').getByRole('button', { name, exact: true }).click(); await expect(dialog()).toBeVisible(); }
async function closeCentral() { await dialog().getByRole('button', { name: 'Fechar diálogo', exact: true }).click(); }
async function entries() { return window.evaluate(() => globalThis.window.lume.listRecent()); }
async function launch() { const env: Record<string, string> = {}; for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value; delete env.ELECTRON_RUN_AS_NODE; delete env.LUME_DEV_URL; env.LUME_TEST_MODE = '1'; env.LUME_USER_DATA = profile; app = await _electron.launch({ args: ['.'], env }); window = await app.firstWindow(); window.on('pageerror', error => errors.push(error.message)); await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false); });
  await window.getByRole('button', { name: 'Abrir Lume Leitor' }).click();
  await expect(window.getByRole('heading', { name: /Sua próxima página/ })).toBeVisible();
}
test.beforeAll(async () => { directory = await mkdtemp(path.join(os.tmpdir(), 'lume-workspace-ui-')); profile = path.join(directory, 'profile'); first = path.join(directory, 'Tartaruga.pdf'); second = path.join(directory, 'Segundo.pdf'); epub = path.join(directory, 'Entre páginas.epub'); audio = path.join(directory, 'Teste.wav'); archive = path.join(directory, 'Minha biblioteca.zip'); moved = path.join(directory, 'destino'); await mkdir(moved);
  for (const [file, title] of [[first, 'Tartaruga azul'], [second, 'Outro livro']]) { const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica); for (let page = 1; page <= 3; page++) pdf.addPage([595, 842]).drawText(`${title} na pagina ${page}`, { x: 55, y: 720, size: 22, font }); await writeFile(file, await pdf.save()); }
  await copyFile('examples/Entre páginas.epub', epub); firstHash = createHash('sha256').update(await readFile(first)).digest('hex'); const data = Buffer.alloc(44 + 16000 * 60); data.write('RIFF'); data.writeUInt32LE(data.length - 8, 4); data.write('WAVEfmt ', 8); data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22); data.writeUInt32LE(8000, 24); data.writeUInt32LE(16000, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34); data.write('data', 36); data.writeUInt32LE(data.length - 44, 40); await writeFile(audio, data); await launch();
});
test.afterAll(async () => { await app?.close(); });
test('importa vários livros, subpastas, informa duplicatas e arquivos inválidos', async () => {
  await openCentral('Importar em lote'); await chooseFiles([first, epub]); await dialog().getByRole('button', { name: 'Escolher vários livros', exact: true }).click(); await expect(dialog().locator('.batch-report')).toContainText('2 importados');
  const folder = path.join(directory, 'lote'), sub = path.join(folder, 'sub'); await mkdir(sub, { recursive: true }); await copyFile(first, path.join(folder, 'Duplicata.pdf')); await copyFile(second, path.join(sub, 'Segundo.pdf')); await writeFile(path.join(sub, 'Invalido.pdf'), 'invalido'); await writeFile(path.join(folder, 'ignorado.txt'), 'ignorar'); await chooseFiles([folder]); await dialog().getByRole('button', { name: 'Importar pasta', exact: true }).click(); await expect(dialog().locator('.batch-report')).toContainText('1 importados · 1 duplicatas · 1 erros · 1 itens ignorados'); expect(await entries()).toHaveLength(3); await closeCentral();
});
test('miniaturas navegam, abas alternam e comparação tem controles independentes', async () => {
  await window.locator('.document-card').filter({ hasText: 'Tartaruga' }).locator('.document-card-main').click(); await expect(window.locator('#pdf-container .textLayer')).toContainText('Tartaruga azul'); await window.getByRole('button', { name: 'Miniaturas', exact: true }).click(); await expect(window.getByAltText('Miniatura da página 1')).toBeVisible(); await window.getByRole('button', { name: 'Ir para página 2 pela miniatura', exact: true }).click(); await expect(window.getByLabel('Página atual', { exact: true })).toHaveValue('2'); await window.getByRole('button', { name: 'Fechar miniaturas', exact: true }).click();
  await window.getByRole('button', { name: 'Lume, ir para biblioteca', exact: true }).click(); await window.locator('.document-card').filter({ hasText: 'Segundo' }).locator('.document-card-main').click(); await expect(window.getByRole('tab', { name: 'Segundo', exact: true })).toBeVisible(); await window.getByRole('tab', { name: 'Tartaruga', exact: true }).click(); await expect(window.getByLabel('Página atual', { exact: true })).toHaveValue('2');
  await window.getByRole('button', { name: 'Comparar livros', exact: true }).click(); const secondEntry = (await entries()).find(entry => entry.name === 'Segundo.pdf')!; await window.getByLabel('Livro da comparação', { exact: true }).selectOption(secondEntry.id); await expect(window.locator('#compare-pdf-container .textLayer')).toContainText('Outro livro'); await window.getByRole('button', { name: 'Próxima página da comparação', exact: true }).click(); await expect(window.locator('.comparison-controls')).toContainText('Página 2 / 3'); await expect(window.getByLabel('Página atual', { exact: true })).toHaveValue('2'); await window.locator('.comparison-pane').press('ArrowRight'); await expect(window.locator('.comparison-controls')).toContainText('Página 3 / 3'); await expect(window.getByLabel('Página atual', { exact: true })).toHaveValue('2'); await window.getByRole('button', { name: 'Fechar comparação', exact: true }).click();
});
test('indexa PDF e EPUB, busca notas e abre o resultado na página correta', async () => {
  const book = (await entries()).find(entry => entry.name === 'Tartaruga.pdf')!; await window.evaluate(id => globalThis.window.lume.saveBookmark(id, { page: 3, label: 'Observação especial' }), book.id); await openCentral('Busca global'); await dialog().getByRole('button', { name: 'Atualizar índice de conteúdo', exact: true }).click(); await expect(dialog().getByRole('status').filter({ hasText: 'Indexação concluída' })).toBeVisible({ timeout: 45000 }); await expect(dialog().locator('details')).toHaveCount(0); await dialog().getByLabel('Buscar em toda a biblioteca', { exact: true }).fill('Tartaruga azul na pagina 3'); await expect(dialog().locator('.global-results button')).toHaveCount(1); await dialog().locator('.global-results button').click(); await expect(window.getByLabel('Página atual', { exact: true })).toHaveValue('3');
  await openCentral('Busca global'); await dialog().getByLabel('Onde pesquisar na biblioteca', { exact: true }).selectOption('notes'); await dialog().getByLabel('Buscar em toda a biblioteca', { exact: true }).fill('observacao especial'); await expect(dialog().locator('.global-results button')).toHaveCount(1); await closeCentral();
});
test('player reproduz áudio local, salva marcadores, velocidade, posição e temporizador', async () => {
  await window.locator('.library-utilities').getByRole('button', { name: /Player de audiobooks/ }).click(); const player = window.getByRole('dialog', { name: 'Player de audiobooks', exact: true }); await chooseFiles([audio]); await player.getByRole('button', { name: 'Abrir áudio', exact: true }).click(); await expect(player.getByRole('heading', { name: 'Teste', exact: true })).toBeVisible(); await player.getByRole('button', { name: 'Reproduzir audiobook', exact: true }).click(); await expect(player.getByRole('button', { name: 'Pausar audiobook', exact: true })).toBeVisible(); await player.getByRole('button', { name: 'Avançar 15 segundos', exact: true }).click(); await player.getByLabel('Velocidade do audiobook', { exact: true }).selectOption('1.5'); await player.getByLabel('Nome do marcador de áudio', { exact: true }).fill('Trecho salvo'); await player.getByRole('button', { name: 'Marcar posição do áudio', exact: true }).click(); await expect(player.locator('.audio-bookmarks')).toContainText('Trecho salvo'); await player.getByRole('button', { name: 'Ativar temporizador', exact: true }).click(); await expect(player.getByRole('button', { name: /Cancelar temporizador/ })).toBeVisible(); await player.getByRole('button', { name: /Cancelar temporizador/ }).click(); await player.getByRole('button', { name: 'Pausar audiobook', exact: true }).click(); expect(await window.evaluate(async () => (await globalThis.window.lume.playerList())[0].position)).toBeGreaterThanOrEqual(15); await player.getByRole('button', { name: 'Fechar diálogo', exact: true }).click();
});
test('player flutuante controla a mesma reprodução com a janela principal em segundo plano', async () => {
  const readerWindow = await app.browserWindow(window);
  await readerWindow.evaluate(reader => { reader.webContents.setBackgroundThrottling(true); reader.showInactive(); });
  await window.getByRole('button', { name: /Player de audiobooks/ }).click();
  const player = window.getByRole('dialog', { name: 'Player de audiobooks', exact: true });
  await player.getByLabel('Posição do audiobook').press('Home');
  await player.getByRole('button', { name: 'Reproduzir audiobook' }).click();
  await expect(player.getByRole('button', { name: 'Pausar audiobook' })).toBeVisible();

  const [floating] = await Promise.all([
    app.waitForEvent('window'),
    player.getByRole('button', { name: 'Player flutuante' }).click(),
  ]);
  const floatingWindow = await app.browserWindow(floating);
  expect(await floatingWindow.evaluate(native => native.isAlwaysOnTop())).toBe(true);
  await expect(floating.getByRole('heading', { name: 'Teste' })).toBeVisible();
  await expect(floating.getByRole('button', { name: 'Pausar audiobook' })).toBeVisible();
  await expect(player).toHaveCount(0);

  await readerWindow.evaluate(reader => reader.minimize());
  await expect.poll(() => readerWindow.evaluate(reader => reader.isMinimized())).toBe(true);
  const audioPosition = () => window.locator('audio.local-audio-element').evaluate((element: HTMLAudioElement) => element.currentTime);
  const minimizedPosition = await audioPosition();
  await expect.poll(audioPosition).toBeGreaterThan(minimizedPosition + 1);

  await readerWindow.evaluate(reader => { reader.restore(); reader.close(); });
  expect(await readerWindow.evaluate(reader => reader.isVisible())).toBe(false);
  const positionBeforeSkip = await audioPosition();
  await floating.getByRole('button', { name: 'Avançar 15 segundos' }).click();
  await expect.poll(audioPosition).toBeGreaterThanOrEqual(positionBeforeSkip + 15);
  await floating.getByRole('button', { name: 'Pausar audiobook' }).click();
  await expect(floating.getByRole('button', { name: 'Reproduzir audiobook' })).toBeVisible();
  expect(await window.locator('audio.local-audio-element').evaluate((element: HTMLAudioElement) => element.paused)).toBe(true);
  await floating.getByRole('button', { name: 'Reproduzir audiobook' }).click();
  await expect(floating.getByRole('button', { name: 'Pausar audiobook' })).toBeVisible();
  await floating.getByRole('button', { name: 'Abrir player completo' }).click();
  await expect.poll(() => floating.isClosed()).toBe(true);
  expect(await readerWindow.evaluate(reader => reader.isVisible())).toBe(true);
  await expect(player.getByRole('button', { name: 'Pausar audiobook' })).toBeVisible();
  await player.getByRole('button', { name: 'Pausar audiobook' }).click();
  await player.getByRole('button', { name: 'Fechar diálogo' }).click();
});
test('backup restaura livros e preferências após remoção e recarrega a biblioteca', async () => {
  await window.evaluate(() => localStorage.setItem('lume-theme', 'dark')); await openCentral('Backup'); await app.evaluate(({ dialog }, file) => { dialog.showSaveDialog = (async () => ({ canceled: false, filePath: file })) as typeof dialog.showSaveDialog; }, archive); await dialog().getByRole('button', { name: 'Criar backup ZIP', exact: true }).click(); await expect(dialog().getByRole('status')).toContainText('Backup completo salvo'); await closeCentral();
  const book = (await entries()).find(entry => entry.name === 'Segundo.pdf')!; await window.evaluate(id => globalThis.window.lume.removeRecent(id), book.id); await openCentral('Backup'); await chooseFiles([archive]); await dialog().getByRole('button', { name: 'Conferir pacote para restaurar', exact: true }).click(); await expect(dialog().locator('.restore-preview')).toContainText('3 livros ativos'); await dialog().getByRole('checkbox', { name: 'Restaurar este pacote no lugar da biblioteca atual', exact: true }).check(); await dialog().getByRole('button', { name: 'Restaurar biblioteca e reiniciar a tela', exact: true }).click(); await expect(window.getByRole('heading', { name: /Sua próxima página/ })).toBeVisible(); expect(await entries()).toHaveLength(3); expect(await window.evaluate(() => localStorage.getItem('lume-theme'))).toBe('dark'); expect((await window.evaluate(() => globalThis.window.lume.playerList()))[0].bookmarks[0].label).toBe('Trecho salvo');
});
test('muda armazenamento e exclui somente a cópia, preservando o original', async () => {
  await openCentral('Armazenamento'); await chooseFiles([moved]); await dialog().getByRole('button', { name: 'Mudar pasta da biblioteca', exact: true }).click(); await expect(dialog().getByRole('status')).toContainText('Pasta alterada'); await expect(dialog().locator('.storage-summary')).toContainText('Lume Livros'); const item = dialog().locator('.storage-list article').filter({ hasText: 'Tartaruga' }); await item.getByRole('button', { name: 'Excluir cópia…', exact: true }).click(); await dialog().getByRole('button', { name: 'Excluir somente a cópia local', exact: true }).click(); await expect(dialog().getByRole('status')).toContainText('Somente a cópia local foi excluída'); expect(await entries()).toHaveLength(2); expect(createHash('sha256').update(await readFile(first)).digest('hex')).toBe(firstHash); await closeCentral(); await app.close(); await launch(); expect(await entries()).toHaveLength(2); expect(errors).toEqual([]);
});

