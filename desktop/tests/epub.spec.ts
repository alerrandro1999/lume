import { _electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import JSZip from 'jszip';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test.describe.configure({ mode: 'serial' });
let app: ElectronApplication;
let window: Page;
let directory: string;
let profile: string;
let epubPath: string;
let pdfPath: string;
let badPath: string;
let drmPath: string;
let savedCfi = '';
const errors: string[] = [];

async function launch() {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value;
  delete env.ELECTRON_RUN_AS_NODE; delete env.LUME_DEV_URL;
  env.LUME_TEST_MODE = '1'; env.LUME_USER_DATA = profile;
  app = await _electron.launch({ args: ['.'], env });
  window = await app.firstWindow();
  await window.getByRole('button', { name: 'Abrir Lume Leitor' }).click();
  await app.evaluate(({ BrowserWindow }) => {const view=BrowserWindow.getAllWindows()[0];view.webContents.setBackgroundThrottling(false);if(process.platform==='darwin')view.show();});
  window.on('pageerror', error => errors.push(error.message));
  await expect(window.getByRole('heading', { name: /Sua próxima página/ })).toBeVisible();
}
async function choose(filePath: string) {
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [filePath] })) as typeof dialog.showOpenDialog;
  }, filePath);
  await window.getByRole('button', { name: 'Importar livro', exact: true }).click();
}
async function entry() {
  return JSON.parse(await readFile(path.join(profile, 'library.json'), 'utf8')).documents[0];
}
async function notebook() { const record = await entry(); return JSON.parse(await readFile(path.join(profile, 'documents', `${record.id}.json`), 'utf8')); }
const frame = () => window.frameLocator('#epub-container iframe').first();

test.beforeAll(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'lume-epub-')); profile = path.join(directory, 'profile');
  epubPath = path.join(directory, 'Livro de exemplo.epub'); pdfPath = path.join(directory, 'PDF de controle.pdf'); badPath = path.join(directory, 'Inválido.epub'); drmPath = path.join(directory, 'Protegido.epub');
  await launch();
  const cover = await window.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 400; canvas.height = 560;
    const context = canvas.getContext('2d')!; context.fillStyle = '#e9dfc5'; context.fillRect(0, 0, 400, 560);
    context.strokeStyle = '#a07c3d'; context.lineWidth = 2; context.strokeRect(25, 25, 350, 510);
    context.fillStyle = '#33372f'; context.font = '38px Georgia'; context.textAlign = 'center'; context.fillText('Entre páginas', 200, 230);
    context.font = '16px Arial'; context.fillText('Biblioteca Lume', 200, 310);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file('META-INF/container.xml', '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OPS/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
  zip.file('OPS/package.opf', `<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="uid">urn:lume:exemplo</dc:identifier><dc:title>Entre páginas</dc:title><dc:creator>Biblioteca Lume</dc:creator><dc:language>pt-BR</dc:language><meta property="dcterms:modified">2026-11-07T12:00:00Z</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="cover" href="images/cover.png" media-type="image/png" properties="cover-image"/><item id="css" href="styles/book.css" media-type="text/css"/>${[1, 2, 3].map(index => `<item id="chapter${index}" href="text/chapter${index}.xhtml" media-type="application/xhtml+xml"/>`).join('')}</manifest><spine>${[1, 2, 3].map(index => `<itemref idref="chapter${index}"/>`).join('')}</spine></package>`);
  zip.file('OPS/nav.xhtml', '<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Sumário</title></head><body><nav epub:type="toc"><ol>' + [1, 2, 3].map(index => `<li><a href="text/chapter${index}.xhtml">Capítulo ${index}</a></li>`).join('') + '</ol></nav></body></html>');
  zip.file('OPS/styles/book.css', 'body { font-family: Georgia, serif; margin: 0; padding: 20px; } h1 { font-size: 1.8em; } p { line-height: 1.8; margin: 0 0 1.1em; } img { max-width: 100%; }');
  zip.file('OPS/images/cover.png', cover, { base64: true });
  for (const index of [1, 2, 3]) {
    const paragraphs = Array.from({ length: 24 }, (_, paragraph) => `<p id="trecho-${paragraph}"${paragraph === 0 ? ' onclick="parent.document.title=\'SCRIPT EXECUTED\'"' : ''}>${paragraph === 8 ? 'Palavraexclusiva. ' : ''}Trecho ${paragraph + 1} do capítulo ${index}. Uma boa leitura pede tempo e atenção. As páginas guardam histórias, ideias e caminhos para descobrir. Ajuste a fonte, encontre seu ritmo e continue de onde parou.</p>`).join('');
    zip.file(`OPS/text/chapter${index}.xhtml`, `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Capítulo ${index}</title><link rel="stylesheet" type="text/css" href="../styles/book.css"/><script>parent.document.title='SCRIPT EXECUTED';</script></head><body><h1 id="inicio">Capítulo ${index}</h1>${index === 1 ? '<img src="../images/cover.png" style="height:100px;width:auto" alt="Capa de Entre páginas"/>' : ''}${paragraphs}</body></html>`);
  }
  const data = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  await writeFile(epubPath, data);
  const drm = await JSZip.loadAsync(data); drm.file('META-INF/rights.xml', '<rights/>'); await writeFile(drmPath, await drm.generateAsync({ type: 'nodebuffer' }));
  await writeFile(badPath, 'Este arquivo não é um EPUB.');
  const pdf = await PDFDocument.create(); const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage([595, 842]).drawText('PDF de controle continua funcionando.', { x: 55, y: 700, size: 20, font }); await writeFile(pdfPath, await pdf.save());
});
test.afterAll(async () => { await app?.close(); });

test('abre EPUB com metadados, imagens, fonte ajustável e conteúdo sem scripts', async () => {
  await choose(epubPath);
  await expect(window.locator('.document-heading h1')).toHaveText('Entre páginas', { timeout: 45000 });
  await expect(frame().getByRole('heading', { name: 'Capítulo 1', exact: true })).toBeAttached();
  await expect(frame().getByAltText('Capa de Entre páginas')).toBeVisible();
  expect(await frame().locator('script').count()).toBe(0);
  expect(await frame().locator('p').first().getAttribute('onclick')).toBeNull();
  expect(await window.title()).toBe('Entre páginas — Lume');
  await expect(window.getByRole('button', { name: 'Reconhecer texto', exact: true })).toHaveCount(0);
  await expect(window.getByLabel('Seção atual', { exact: true })).toHaveValue('1');
  const size = await frame().locator('p').first().evaluate(element => parseFloat(getComputedStyle(element).fontSize));
  await window.getByRole('button', { name: 'Aumentar texto', exact: true }).click();
  await expect.poll(() => frame().locator('p').first().evaluate(element => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThan(size);
  await expect(window.locator('.epub-progress')).toContainText('Trecho salvo');
  const record = await entry(); expect(record.format).toBe('epub'); expect(record.title).toBe('Entre páginas'); expect(record.hasCover).toBe(true);
  await window.screenshot({ path: 'test-results/lume-epub.png' });
  expect(errors).toEqual([]);
});

test('vira páginas dentro do capítulo e salva a posição exata', async () => {
  const initial = (await entry()).epubLocation.cfi;
  await window.getByRole('button', { name: 'Virar para a próxima página', exact: true }).click();
  await expect.poll(async () => (await entry()).epubLocation.cfi).not.toBe(initial);
  await expect(window.getByLabel('Seção atual', { exact: true })).toHaveValue('1');
  expect((await entry()).epubLocation.displayedPage).toBeGreaterThan(1);
  savedCfi = (await entry()).epubLocation.cfi;
  await window.getByRole('button', { name: /^Marcadores/ }).first().click();
  await window.getByRole('button', { name: 'Marcar trecho da seção 1', exact: true }).click();
  await window.getByLabel('Nome do marcador').fill('Continuar deste trecho');
  await window.getByRole('button', { name: 'Salvar marcador' }).click();
  expect((await notebook()).bookmarks[0].location).toBe(savedCfi);
  await window.getByRole('button', { name: 'Fechar painel de leitura' }).click();
  await window.getByRole('button', { name: 'Virar para a próxima página', exact: true }).click();
  await expect.poll(async () => (await entry()).epubLocation.cfi).not.toBe(savedCfi);
});

test('sumário, busca e marcadores navegam no EPUB', async () => {
  await window.getByRole('button', { name: 'Sumário', exact: true }).click();
  await window.locator('.outline-item').filter({ hasText: 'Capítulo 3' }).click();
  await expect(window.getByLabel('Seção atual', { exact: true })).toHaveValue('3');
  await window.getByRole('button', { name: /^Buscar/ }).click();
  await window.getByRole('textbox', { name: 'Buscar no documento', exact: true }).fill('Palavraexclusiva');
  await expect(window.locator('.match-count')).toContainText('de 3');
  await expect(window.locator('#epub-container .epub-find-match')).toBeAttached();
  await window.getByRole('button', { name: 'Fechar busca' }).click();
  await window.getByRole('button', { name: /^Marcadores/ }).first().click();
  await window.locator('.bookmark-jump').filter({ hasText: 'Continuar deste trecho' }).click();
  await expect(window.getByLabel('Seção atual', { exact: true })).toHaveValue('1');
  await window.getByRole('button', { name: 'Fechar painel de leitura' }).click();
  expect(errors).toEqual([]);
});

test('seleciona e destaca texto no EPUB com âncora estável', async () => {
  await expect(async () => { await frame().locator('p').first().evaluate(element => {
    const range = element.ownerDocument.createRange(); range.setStart(element.firstChild!, 0); range.setEnd(element.lastChild!, element.lastChild!.textContent!.length);
    const selection = element.ownerDocument.defaultView!.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
    element.ownerDocument.dispatchEvent(new Event('selectionchange'));
  }); await expect(window.getByRole('toolbar', { name: 'Ações do texto selecionado' })).toBeVisible(); }).toPass({timeout:15000});
  await window.getByRole('button', { name: 'Anotar', exact: true }).click();
  await window.getByLabel('Sua anotação', { exact: true }).fill('Esta passagem merece uma nova leitura.');
  await window.getByRole('button', { name: 'Salvar anotação' }).click();
  await expect(window.locator('.annotation-card')).toHaveCount(1);
  const stored = await notebook(); expect(stored.annotations[0].location).toMatch(/^epubcfi\(/);
  expect(stored.annotations[0].quote).toContain('Uma boa leitura pede tempo');
  await expect(window.locator('#epub-container .epub-highlight').first()).toBeAttached();
  await window.getByRole('button', { name: 'Fechar painel de leitura' }).click();
  await window.getByRole('button', { name: 'Aumentar texto', exact: true }).click();
  await expect(window.locator('#epub-container .epub-highlight').first()).toBeAttached();
  expect(errors).toEqual([]);
});

test('narra texto do EPUB e mantém os recursos de conforto', async () => {
  await window.getByRole('button', { name: 'Ouvir', exact: true }).click();
  await expect.poll(() => window.locator('.speech-bar audio').evaluate(audio => (audio as HTMLAudioElement).currentTime)).toBeGreaterThan(0);
  await expect(frame().locator('.lume-speaking').first()).toBeAttached();
  await window.getByRole('button', { name: 'Parar narração', exact: true }).click();
  await window.getByRole('button', { name: 'Fechar narração' }).click();
  await window.getByRole('button', { name: 'Conforto', exact: true }).click();
  await window.getByRole('button', { name: 'Sépia', exact: true }).click();
  await window.getByRole('button', { name: 'Fechar painel de leitura' }).click();
  await window.keyboard.press('F8');
  await expect(window.locator('.app')).toHaveClass(/focus-mode/);
  await window.keyboard.press('F8');
  expect(errors).toEqual([]);
});

test('alterna duas páginas e rolagem, percorre o progresso e aceita atalhos no texto', async () => {
  test.setTimeout(90000);
  if (!await window.locator('.document-heading').isVisible()) { await choose(epubPath); await expect(window.locator('.document-heading h1')).toHaveText('Entre páginas', { timeout: 45000 }); }
  await window.getByLabel('Modo de leitura').selectOption('book');
  await expect.poll(() => frame().locator('body').evaluate(element => parseFloat(getComputedStyle(element).columnWidth))).toBeLessThan(600);
  await window.getByLabel('Modo de leitura').selectOption('scroll');
  await expect.poll(() => frame().locator('body').evaluate(element => getComputedStyle(element).columnWidth)).toBe('auto');
  await window.getByLabel('Modo de leitura').selectOption('single');
  await expect.poll(() => frame().locator('body').evaluate(element => parseFloat(getComputedStyle(element).columnWidth))).toBeGreaterThan(600);
  await window.getByRole('slider', { name: 'Posição no EPUB', exact: true }).press('End');
  await expect(window.locator('.progress-percent')).toHaveText('100% do livro', { timeout: 30000 });
  await expect(window.getByRole('button', { name: 'Virar para a próxima página', exact: true })).toBeDisabled();
  await frame().locator('body').press('Control+Home');
  await expect(window.getByLabel('Seção atual', { exact: true })).toHaveValue('1');
  await expect(window.locator('.progress-percent')).toHaveText('0% do livro');
  const initial = (await entry()).epubLocation.cfi;
  await frame().locator('body').press('ArrowRight');
  await expect.poll(async () => (await entry()).epubLocation.cfi).not.toBe(initial);
});

test('recupera EPUB, capa, notas e marcadores ao reiniciar, com PDF na mesma biblioteca', async () => {
  await expect(window.locator('.position-saved')).toContainText('Trecho salvo');
  const previous = await entry();
  await app.close(); await launch();
  await expect(window.locator('.document-card h3')).toHaveText('Entre páginas');
  await expect(window.locator('.actual-cover')).toBeVisible();
  expect(await window.locator('.actual-cover').evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await window.locator('.resume-reading').click();
  await expect(window.locator('.document-heading h1')).toHaveText('Entre páginas');
  await expect.poll(async () => (await entry()).epubLocation.chapter).toBe(previous.epubLocation.chapter);
  await expect.poll(async () => (await entry()).epubLocation.cfi).toBe(previous.epubLocation.cfi);
  await window.getByRole('button', { name: /^Anotações/ }).click();
  await expect(window.locator('.annotation-card')).toContainText('Esta passagem merece');
  await choose(pdfPath);
  await expect(window.locator('.document-heading h1')).toHaveText('PDF de controle');
  await expect(window.locator('#pdf-container .textLayer')).toContainText('continua funcionando');
  await choose(epubPath);
  await expect(window.locator('.document-heading h1')).toHaveText('Entre páginas');
  await window.getByRole('button', { name: 'Biblioteca', exact: false }).filter({ hasText: 'Biblioteca' }).last().click();
  await expect(window.locator('.document-card')).toHaveCount(2);
  await window.screenshot({ path: 'test-results/lume-biblioteca-epub-pdf.png' });
});

test('rejeita EPUB inválido e DRM preservando a leitura atual', async () => {
  await window.locator('.document-card').filter({ hasText: 'Entre páginas' }).getByRole('button').first().click();
  await choose(badPath);
  await expect(window.getByRole('alert')).toContainText(/EPUB válido|estrutura/);
  await expect(window.locator('.document-heading h1')).toHaveText('Entre páginas');
  await window.getByRole('button', { name: 'Fechar aviso' }).click();
  await choose(drmPath);
  await expect(window.getByRole('alert')).toContainText('DRM');
  await expect(window.locator('.document-heading h1')).toHaveText('Entre páginas');
  expect(errors).toEqual([]);
});

test('usa cartões, histórico, exportação com CFI e audiobook no EPUB', async () => {
  test.setTimeout(90000);
  await window.getByRole('button', { name: 'Fechar aviso' }).click();
  await window.getByRole('button', { name: 'Estudo', exact: true }).click(); await window.getByRole('tab', { name: 'Cartões', exact: true }).click();
  await window.getByRole('button', { name: 'Novo cartão', exact: true }).click(); await window.getByLabel('Pergunta do cartão').fill('Qual é o ritmo da leitura?'); await window.getByLabel('Resposta do cartão').fill('Ler com tempo e atenção.'); await window.getByRole('button', { name: 'Salvar cartão', exact: true }).click(); await expect(window.locator('.flashcard-card')).toHaveCount(1);
  const stored = await window.evaluate(async () => globalThis.window.lume.readStudy((await globalThis.window.lume.listRecent())[0].id)); expect(stored.book.cards[0].location).toMatch(/^epubcfi\(/);
  await window.getByRole('button', { name: 'Fechar diálogo', exact: true }).click(); await window.getByRole('button', { name: 'Sumário', exact: true }).click(); await window.locator('.outline-item').filter({ hasText: 'Capítulo 3' }).click(); await expect(window.getByLabel('Seção atual', { exact: true })).toHaveValue('3');
  await window.getByRole('button', { name: 'Estudo', exact: true }).click(); await window.getByRole('tab', { name: 'Cartões', exact: true }).click(); await window.getByRole('button', { name: 'Ir ao trecho', exact: true }).click(); await expect(window.getByLabel('Seção atual', { exact: true })).toHaveValue(String(stored.book.cards[0].page));
  await window.getByRole('button', { name: 'Estudo', exact: true }).click(); await window.getByRole('tab', { name: 'Anotações', exact: true }).click();
  const output = path.join(directory, 'Anotações EPUB.md'); await app.evaluate(({ dialog }, filePath) => { dialog.showSaveDialog = (async () => ({ canceled: false, filePath })) as typeof dialog.showSaveDialog; }, output); await window.getByRole('button', { name: 'Exportar Markdown', exact: true }).click(); await expect(window.locator('.export-result')).toContainText(output); expect(await readFile(output, 'utf8')).toContain('epubcfi(');
  await window.getByRole('tab', { name: 'Audiobook', exact: true }).click(); await app.evaluate(({ dialog }, directory) => { dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [directory] })) as typeof dialog.showOpenDialog; }, directory); await window.getByRole('button', { name: 'Gerar audiobook WAV', exact: true }).click(); await expect(window.locator('.study-success')).toContainText('Audiobook salvo', { timeout: 60000 }); expect((await readdir(directory)).some(name => name.includes('áudio'))).toBe(true);
  expect(errors).toEqual([]);
});
