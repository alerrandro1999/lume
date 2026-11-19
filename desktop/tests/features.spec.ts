import { _electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { PDFDocument, StandardFonts, PDFName, PDFDict, PDFHexString } from 'pdf-lib';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
test.describe.configure({ mode: 'serial' });
let app: ElectronApplication, window: Page, directory: string, profile: string, filePath: string, originalHash: string;
let audiobookPosition: number;
const errors: string[] = [];
async function launch() {
  const env: Record<string, string> = {}; for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value;
  delete env.ELECTRON_RUN_AS_NODE; delete env.LUME_DEV_URL; env.LUME_TEST_MODE = '1'; env.LUME_USER_DATA = profile;
  app = await _electron.launch({ args: ['.'], env }); window = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false));
  window.on('pageerror', error => errors.push(error.message));
  await window.getByRole('button', { name: 'Abrir Lume Leitor' }).click();
  await expect(window.getByRole('heading', { name: /Sua próxima página/ })).toBeVisible();
}
async function choose() {
  await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [file] })) as typeof dialog.showOpenDialog; }, filePath);
  await window.getByRole('button', { name: 'Importar livro', exact: true }).click();
  await expect(window.locator('.document-heading h1')).toHaveText('Leitura para estudar');
}
async function study(tab: string) {
  if (!await window.getByRole('dialog', { name: 'Estudo e leitura' }).isVisible()) await window.getByRole('button', { name: 'Estudo', exact: true }).click();
  await window.getByRole('tab', { name: tab, exact: true }).click();
}
async function closeStudy() { await window.getByRole('button', { name: 'Fechar diálogo', exact: true }).click(); }
async function currentId() { return window.evaluate(async () => (await globalThis.window.lume.listRecent())[0].id); }
async function jump(page: number) { await window.getByLabel('Página atual', { exact: true }).fill(String(page)); await window.getByLabel('Página atual', { exact: true }).press('Enter'); await expect(window.getByLabel('Página atual', { exact: true })).toHaveValue(String(page)); }
async function selectText() {
  await window.locator('#pdf-container .textLayer span').first().evaluate(element => { const range = document.createRange(); range.selectNodeContents(element); const selection = getSelection()!; selection.removeAllRanges(); selection.addRange(range); });
  await window.locator('.canvas-area').dispatchEvent('mouseup');
  await expect(window.getByRole('toolbar', { name: 'Ações do texto selecionado' })).toBeVisible();
}
test.beforeAll(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'lume-features-')); profile = path.join(directory, 'profile'); filePath = path.join(directory, 'Leitura para estudar.pdf');
  const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let index = 1; index <= 3; index++) { const page = pdf.addPage([595, 842]); page.drawText(`Leitura e descobertas ${index}`, { x: 80, y: 710, size: 23, font }); page.drawText('Aprender pede curiosidade, tempo e boas perguntas.', { x: 80, y: 650, size: 15, font }); page.drawText('Anote suas ideias e volte aos trechos mais importantes.', { x: 80, y: 620, size: 15, font }); }
  const context = pdf.context, outline = context.register(context.obj({ Type: PDFName.of('Outlines'), Count: 2 }));
  const first = context.register(context.obj({ Title: PDFHexString.fromText('Primeiro capítulo'), Parent: outline, Dest: [pdf.getPages()[0].ref, PDFName.of('Fit')] }));
  const second = context.register(context.obj({ Title: PDFHexString.fromText('Segundo capítulo'), Parent: outline, Prev: first, Dest: [pdf.getPages()[2].ref, PDFName.of('Fit')] }));
  context.lookup(first, PDFDict).set(PDFName.of('Next'), second); const root = context.lookup(outline, PDFDict); root.set(PDFName.of('First'), first); root.set(PDFName.of('Last'), second); pdf.catalog.set(PDFName.of('Outlines'), outline);
  const bytes = await pdf.save(); originalHash = createHash('sha256').update(bytes).digest('hex'); await writeFile(filePath, bytes); await launch(); await choose();
});
test.afterAll(async () => { await app?.close(); });

test('estima a leitura, registra tempo ativo e salva metas e pausas', async () => {
  await expect(window.locator('.reading-estimate')).toContainText('para terminar');
  await window.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); document.hasFocus = () => true; });
  await expect.poll(async () => window.evaluate(async () => (await globalThis.window.lume.readStudy((await globalThis.window.lume.listRecent())[0].id)).book.seconds), { timeout: 18000 }).toBeGreaterThanOrEqual(10);
  await study('Ritmo'); await window.getByLabel('Meta diária em minutos').fill('35'); await window.getByLabel('Ritmo inicial', { exact: true }).fill('180'); await window.getByText('Lembrar de fazer pausas', { exact: true }).check(); await window.getByRole('button', { name: 'Salvar preferências de leitura' }).click();
  await expect(window.locator('.reading-metrics').filter({ hasText: 'para terminar o livro' })).toContainText('Primeiro capítulo');
  await expect(window.locator('.book-sessions')).toContainText('Leitura');
  await expect(window.locator('.study-success')).toContainText('Preferências salvas');
  const id = await currentId(); expect(await window.evaluate(id => globalThis.window.lume.readStudy(id), id)).toMatchObject({ settings: { goal: 35, wpm: 180, reminders: true } });
  await window.screenshot({ path: 'test-results/lume-estudo.png' }); await closeStudy();
});
test('volta de saltos por página e busca, com histórico de avanço', async () => {
  await jump(3); await window.getByRole('button', { name: 'Voltar ao trecho anterior', exact: true }).click(); await expect(window.getByLabel('Página atual', { exact: true })).toHaveValue('1');
  await window.getByRole('button', { name: 'Avançar no histórico', exact: true }).click(); await expect(window.getByLabel('Página atual', { exact: true })).toHaveValue('3');
  await window.keyboard.press('Alt+ArrowLeft'); await expect(window.getByLabel('Página atual', { exact: true })).toHaveValue('1');
});
test('organiza, filtra e mantém favoritos, coleção e etiquetas', async () => {
  await window.getByRole('button', { name: 'Lume, ir para biblioteca', exact: true }).click();
  await window.getByRole('button', { name: 'Organizar Leitura para estudar', exact: true }).click();
  await window.getByLabel('Situação do livro').selectOption('wishlist'); await window.getByLabel('Coleção do livro').fill('Faculdade'); await window.getByLabel('Etiquetas do livro').fill('estudo, português'); await window.getByText('Adicionar aos favoritos', { exact: true }).check(); await window.getByRole('button', { name: 'Salvar organização', exact: true }).click();
  await expect(window.getByRole('dialog', { name: 'Organizar livro' })).toHaveCount(0);
  await window.getByLabel('Filtrar por coleção').selectOption('Faculdade'); await window.getByLabel('Filtrar por etiqueta').selectOption('estudo'); await window.getByLabel('Filtrar por situação').selectOption('wishlist'); await expect(window.locator('.document-card')).toHaveCount(1);
  await window.getByLabel('Buscar na biblioteca', { exact: true }).fill('inexistente'); await expect(window.locator('.document-card')).toHaveCount(0); await window.getByRole('button', { name: 'Limpar filtros', exact: true }).click();
  await window.locator('.document-card-main').click(); await expect(window.locator('.document-heading h1')).toBeVisible();
});
test('consulta só após clicar e sanitiza o dicionário, com falha de rede recuperável', async () => {
  await app.evaluate(({ session }) => {
    const client = session.fromPartition('lume-lookup');
    const state = globalThis as unknown as { lumeQueries: string[] }; state.lumeQueries = [];
    client.fetch = (async (input: string | URL | Request) => { const url = String(input); state.lumeQueries.push(url); return new Response(JSON.stringify(url.includes('wiktionary') ? { parse: { title: 'leitura', text: '<p>Definição de leitura.</p><img src="https://invalid.example/track"><script>throw 1</script>' } } : { responseStatus: 200, responseData: { translatedText: 'Olá, mundo!' } }), { headers: { 'Content-Type': 'application/json' } }); }) as typeof client.fetch;
  });
  await selectText(); await window.getByRole('toolbar', { name: 'Ações do texto selecionado' }).getByRole('button', { name: 'Consultar', exact: true }).click(); await window.getByLabel('Texto para consulta').fill('leitura');
  expect(await app.evaluate(() => (globalThis as unknown as { lumeQueries: string[] }).lumeQueries.length)).toBe(0);
  await window.getByRole('dialog', { name: 'Estudo e leitura' }).getByRole('button', { name: 'Consultar', exact: true }).click(); await expect(window.locator('.dictionary-definition')).toContainText('Definição de leitura'); await expect(window.locator('.dictionary-definition img, .dictionary-definition script')).toHaveCount(0);
  await window.getByLabel('Tipo de consulta').selectOption('translate'); await window.getByLabel('Texto para consulta').fill('Hello, world!'); await window.getByRole('dialog', { name: 'Estudo e leitura' }).getByRole('button', { name: 'Consultar', exact: true }).click(); await expect(window.locator('.lookup-result')).toContainText('Olá, mundo!');
  const urls = await app.evaluate(() => (globalThis as unknown as { lumeQueries: string[] }).lumeQueries); expect(urls).toHaveLength(2); expect(new URL(urls[1]).searchParams.get('q')).toBe('Hello, world!');
  await window.getByRole('button', { name: 'Salvar no glossário' }).click();
  await expect(window.getByRole('status').filter({ hasText: 'Consulta salva no glossário' })).toBeVisible();
  await study('Glossário');
  const item = window.locator('.flashcard-card').filter({ hasText: 'Hello, world!' });
  await expect(item).toContainText('Olá, mundo!');
  await item.getByRole('button', { name: 'Criar cartão' }).click();
  await expect(window.getByLabel('Pergunta do cartão')).toHaveValue('Hello, world!');
  await expect(window.getByLabel('Resposta do cartão')).toHaveValue('Olá, mundo!');
  await window.getByRole('button', { name: 'Cancelar cartão' }).click();
  await study('Consultar');
  await app.evaluate(({ session }) => { const client = session.fromPartition('lume-lookup'); client.fetch = (async () => { throw new Error('offline'); }) as typeof client.fetch; });
  await window.getByRole('dialog', { name: 'Estudo e leitura' }).getByRole('button', { name: 'Consultar', exact: true }).click(); await expect(window.locator('.study-error')).toContainText('conexão'); await closeStudy();
});
test('cria cartão do trecho selecionado e agenda revisão espaçada', async () => {
  await selectText(); await window.getByRole('button', { name: 'Criar cartão', exact: true }).click(); await expect(window.getByLabel('Resposta do cartão')).toContainText('Leitura'); await window.getByLabel('Pergunta do cartão').fill('O que a leitura permite descobrir?'); await window.getByRole('button', { name: 'Salvar cartão', exact: true }).click(); await expect(window.locator('.flashcard-card')).toHaveCount(1);
  await window.getByRole('button', { name: 'Revisar 1 pendente', exact: true }).click(); await window.getByRole('button', { name: 'Mostrar resposta', exact: true }).click(); await expect(window.locator('.card-answer')).toContainText('Leitura'); await window.getByRole('button', { name: 'Bom', exact: true }).click(); await expect(window.locator('.study-body')).toContainText('Revisões em dia');
  const id = await currentId(), stored = await window.evaluate(id => globalThis.window.lume.readStudy(id), id); expect(stored.book.cards[0]).toMatchObject({ page: 1, reviews: 1, interval: 1 }); await closeStudy();
});
test('exporta anotações e marcadores como Markdown e PDF reais', async () => {
  await selectText(); await window.getByRole('button', { name: 'Anotar', exact: true }).click(); await window.getByLabel('Sua anotação', { exact: true }).fill('Conceito importante para estudar.'); await window.getByRole('button', { name: 'Salvar anotação', exact: true }).click(); await window.getByRole('button', { name: 'Fechar painel de leitura' }).click();
  await study('Anotações');
  for (const format of ['md', 'pdf']) {
    const output = path.join(directory, `Anotações.${format}`);
    await app.evaluate(({ dialog }, filePath) => { dialog.showSaveDialog = (async () => ({ canceled: false, filePath })) as typeof dialog.showSaveDialog; }, output);
    await window.getByRole('button', { name: format === 'md' ? 'Exportar Markdown' : 'Exportar PDF', exact: true }).click(); await expect(window.locator('.export-result')).toContainText(output);
    const bytes = await readFile(output); if (format === 'md') { expect(bytes.toString()).toContain('Conceito importante para estudar.'); expect(bytes.toString()).toContain('Página 1'); } else expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(0);
  }
  await closeStudy();
});
test('detecta e recorta margens preservando arquivo, texto e anotações', async () => {
  await study('Margens'); await window.getByRole('button', { name: 'Detectar margens da página atual', exact: true }).click();
  await expect.poll(async () => (await window.evaluate(async () => globalThis.window.lume.readStudy((await globalThis.window.lume.listRecent())[0].id))).book.crop.left).toBeGreaterThan(0);
  await closeStudy(); await expect.poll(() => window.locator('#pdf-container .page').first().evaluate(element => element.style.clipPath)).toContain('inset(');
  await expect(window.locator('#pdf-container .textLayer').first()).toContainText('Leitura');
  expect(createHash('sha256').update(await readFile(filePath)).digest('hex')).toBe(originalHash);
  await window.screenshot({ path: 'test-results/lume-recorte-pdf.png' });
});
test('gera WAV com voz local, playlist e cancela sem deixar arquivos parciais', async () => {
  test.setTimeout(90000); await study('Audiobook');
  await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [folder] })) as typeof dialog.showOpenDialog; }, directory);
  await window.getByLabel('Conteúdo do audiobook').selectOption('book');
  await window.getByRole('button', { name: 'Gerar audiobook WAV', exact: true }).click(); await expect(window.locator('.study-success')).toContainText('Audiobook salvo', { timeout: 60000 });
  const folder = (await readdir(directory, { withFileTypes: true })).find(item => item.isDirectory() && item.name.includes('áudio'))!;
  const files = await readdir(path.join(directory, folder.name)); const wav = await readFile(path.join(directory, folder.name, files.find(file => file.endsWith('.wav'))!)); expect(wav.toString('ascii', 0, 4)).toBe('RIFF'); expect(wav.readUInt32LE(4)).toBe(wav.length - 8); expect(wav.length).toBeGreaterThan(1000); expect(files).toContain('Playlist.m3u');
  expect(files.filter(file => file.endsWith('.wav'))).toHaveLength(2); expect(JSON.parse(await readFile(path.join(directory, folder.name, 'Livro.json'), 'utf8')).chapters.map((chapter: { title: string }) => chapter.title)).toEqual(['Primeiro capítulo', 'Segundo capítulo']);
  const canceled = await window.evaluate(async () => {
    const id = (await globalThis.window.lume.listRecent())[0].id, voice = (await globalThis.window.lume.speechVoices())[0].name;
    const unsubscribe = globalThis.window.lume.onAudiobookProgress(progress => { if (progress.running) void globalThis.window.lume.cancelAudiobook(); });
    try { await globalThis.window.lume.exportAudiobook(id, [{ title: 'Teste de cancelamento', text: 'A leitura merece tempo e atenção. '.repeat(800) }], voice); return false; } catch (error) { return /cancelad/i.test(String(error)); } finally { unsubscribe(); }
  });
  expect(canceled).toBe(true); expect((await readdir(directory)).some(file => file.startsWith('.lume-audio-'))).toBe(false);
  await window.getByRole('button', { name: 'Abrir audiobook no player' }).click();
  const player = window.getByRole('dialog', { name: 'Player de audiobooks' });
  await expect(player.getByRole('heading', { name: 'Leitura para estudar' })).toBeVisible();
  await expect(player.getByLabel('Capítulo do audiobook')).toHaveValue('0');
  await player.getByRole('button', { name: 'Reproduzir audiobook' }).click();
  await expect(player.getByRole('button', { name: 'Pausar audiobook' })).toBeVisible();
  const [floating] = await Promise.all([
    app.waitForEvent('window'),
    player.getByRole('button', { name: 'Player flutuante' }).click(),
  ]);
  await expect(floating.getByRole('heading', { name: 'Leitura para estudar' })).toBeVisible();
  await expect(floating.getByText('Primeiro capítulo', { exact: true })).toBeVisible();
  await window.locator('audio.local-audio-element').evaluate((element: HTMLAudioElement) => { element.currentTime = element.duration - 0.1; });
  await expect(floating.getByText('Segundo capítulo', { exact: true })).toBeVisible();
  await expect(floating.getByRole('button', { name: 'Pausar audiobook' })).toBeVisible();
  await floating.getByRole('button', { name: 'Pausar audiobook' }).click();
  await expect(floating.getByRole('button', { name: 'Reproduzir audiobook' })).toBeVisible();
  await floating.getByRole('button', { name: 'Fechar player flutuante' }).click().catch(error => {
    if (!floating.isClosed()) throw error;
  });
  await expect.poll(() => floating.isClosed()).toBe(true);
  const audio = window.locator('audio.local-audio-element');
  audiobookPosition = await audio.evaluate((element: HTMLAudioElement) => {
    element.currentTime = Math.min(2, element.duration / 2);
    return element.currentTime;
  });
  expect(audiobookPosition).toBeGreaterThan(0);
});
test('recupera organização, cartões, metas e recorte depois de reiniciar', async () => {
  await app.close(); await launch(); await expect(window.locator('.document-card')).toHaveCount(1); await window.getByLabel('Filtrar por coleção').selectOption('Faculdade'); await expect(window.locator('.document-card')).toHaveCount(1); await window.locator('.document-card-main').click(); await expect(window.locator('.document-heading h1')).toHaveText('Leitura para estudar');
  await study('Ritmo'); await expect(window.getByLabel('Meta diária em minutos')).toHaveValue('35'); await study('Cartões'); await expect(window.locator('.flashcard-card')).toContainText('O que a leitura permite descobrir?'); await closeStudy(); await expect.poll(() => window.locator('#pdf-container .page').first().evaluate(element => element.style.clipPath)).toContain('inset('); expect(errors).toEqual([]);
  await study('Glossário');
  await expect(window.locator('.flashcard-card')).toContainText('Olá, mundo!');
  await study('Audiobook');
  await window.getByRole('button', { name: 'Abrir audiobook no player' }).click();
  await expect(window.getByLabel('Capítulo do audiobook')).toHaveValue('1');
  await expect.poll(() => window.locator('audio.local-audio-element').evaluate((element: HTMLAudioElement) => element.currentTime)).toBeCloseTo(audiobookPosition, 2);
  await expect(window.getByRole('dialog', { name: 'Player de audiobooks' }).getByRole('heading', { name: 'Leitura para estudar' })).toBeVisible();
});
