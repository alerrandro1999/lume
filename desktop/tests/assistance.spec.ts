import { _electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test.describe.configure({ mode: 'serial' });
let app: ElectronApplication;
let window: Page;
let directory: string;
let profile: string;
let digital: string;
let scanned: string;
let originalHash: string;
const errors: string[] = [];

async function launch() {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value;
  delete env.ELECTRON_RUN_AS_NODE; delete env.LUME_DEV_URL;
  env.LUME_TEST_MODE = '1'; env.LUME_USER_DATA = profile;
  app = await _electron.launch({ args: ['.'], env });
  window = await app.firstWindow();
  window.on('pageerror', error => errors.push(error.message));
  await window.getByRole('button', { name: 'Abrir Lume Leitor' }).click();
  await expect(window.getByRole('heading', { name: /Sua próxima página/ })).toBeVisible();
}

async function choose(filePath: string) {
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [filePath] })) as typeof dialog.showOpenDialog;
  }, filePath);
  await window.getByRole('button', { name: 'Importar livro', exact: true }).click();
  await expect(window.locator('.loading-overlay')).toHaveCount(0);
}

async function select(locator: string) {
  await window.locator(locator).first().evaluate(element => {
    const range = document.createRange();
    range.selectNodeContents(element);
    globalThis.getSelection()!.removeAllRanges(); globalThis.getSelection()!.addRange(range);
    element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  await expect(window.getByRole('toolbar', { name: 'Ações do texto selecionado' })).toBeVisible();
}

async function notebook() {
  const library = JSON.parse(await readFile(path.join(profile, 'library.json'), 'utf8'));
  return JSON.parse(await readFile(path.join(profile, 'documents', `${library.documents[0].id}.json`), 'utf8'));
}

test.beforeAll(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'lume-assistance-'));
  profile = path.join(directory, 'profile');
  digital = path.join(directory, 'Guia de leitura.pdf');
  scanned = path.join(directory, 'Documento digitalizado.pdf');
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.TimesRoman);
  for (let index = 1; index <= 3; index++) {
    const sheet = pdf.addPage([595, 842]);
    sheet.drawText(`Leitura tranquila ${index}`, { x: 60, y: 745, size: 28, font });
    sheet.drawText('Ler com calma melhora a compreensão.', { x: 60, y: 680, size: 16, font });
    sheet.drawText('Uma pausa ajuda a guardar as ideias importantes.', { x: 60, y: 620, size: 16, font });
    sheet.drawText('Anote o que merece uma segunda leitura.', { x: 60, y: 560, size: 16, font });
  }
  const data = await pdf.save(); originalHash = createHash('sha256').update(data).digest('hex');
  await writeFile(digital, data);
  await launch();
  const png = await window.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 1400; canvas.height = 1800;
    const context = canvas.getContext('2d')!;
    context.fillStyle = 'white'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#111'; context.font = 'bold 66px Arial'; context.fillText('LEITURA CONFORTAVEL', 100, 230);
    context.font = '44px Arial';
    context.fillText('Este documento foi digitalizado.', 100, 400);
    context.fillText('O reconhecimento permite ouvir e buscar.', 100, 490);
    context.fillText('As palavras ficam salvas no computador.', 100, 580);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  const scan = await PDFDocument.create(); const image = await scan.embedPng(Buffer.from(png, 'base64'));
  for (let index = 0; index < 2; index++) scan.addPage([595, 842]).drawImage(image, { x: 0, y: 0, width: 595, height: 765 });
  const font2 = await scan.embedFont(StandardFonts.Helvetica);
  scan.addPage([595, 842]).drawText('Esta página já tem texto e deve ser preservada.', { x: 50, y: 700, size: 18, font: font2 });
  await writeFile(scanned, await scan.save());
  await choose(digital);
  await expect(window.locator('.document-heading h1')).toHaveText('Guia de leitura');
});

test.afterAll(async () => { await app?.close(); });

test('destaca no PDF, edita a anotação e reaplica o destaque no texto ajustável', async () => {
  const span = window.locator('#pdf-container .textLayer span').filter({ hasText: 'Ler com calma melhora' }).first();
  await span.waitFor();
  await span.evaluate(element => {
    const range = document.createRange(); range.selectNodeContents(element);
    globalThis.getSelection()!.removeAllRanges(); globalThis.getSelection()!.addRange(range);
    element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  await expect(window.getByRole('toolbar', { name: 'Ações do texto selecionado' })).toBeVisible();
  await window.getByLabel('Cor do destaque').selectOption('green');
  await window.getByRole('button', { name: 'Destacar', exact: true }).click();
  await expect(window.locator('.annotation-card')).toHaveCount(1);
  await expect(window.locator('#pdf-container .pdf-mark.green').first()).toBeAttached();
  await window.locator('.annotation-card').getByRole('button', { name: 'Editar', exact: true }).click();
  await window.getByLabel('Sua anotação', { exact: true }).fill('Revisar este conceito antes dos exercícios.');
  await window.getByRole('button', { name: 'Salvar anotação' }).click();
  await expect(window.locator('.annotation-note')).toHaveText('Revisar este conceito antes dos exercícios.');
  await window.getByRole('button', { name: 'Fechar painel de leitura' }).click();
  await window.getByLabel('Modo de leitura').selectOption('text');
  await expect(window.locator('#text-reading-view .text-mark.green')).toContainText('Ler com calma melhora');
  const stored = await notebook();
  expect(stored.annotations[0].anchors[0].rects.length).toBeGreaterThan(0);
  expect(stored.annotations[0].note).toContain('Revisar este conceito');
  expect(errors).toEqual([]);
});

test('ajusta fonte sem ampliar o PDF, aplica sépia, régua e modo foco', async () => {
  const paragraph = window.locator('.reflow-article [data-paragraph]').first();
  const initialFont = await paragraph.evaluate(element => parseFloat(getComputedStyle(element).fontSize));
  const pdfWidth = await window.locator('#pdf-container .page').first().evaluate(element => element.getBoundingClientRect().width);
  await window.getByRole('button', { name: 'Aumentar texto', exact: true }).click();
  await expect.poll(() => paragraph.evaluate(element => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThan(initialFont);
  expect(await window.locator('#pdf-container .page').first().evaluate(element => element.getBoundingClientRect().width)).toBeCloseTo(pdfWidth, 0);
  await window.getByRole('button', { name: 'Conforto', exact: true }).click();
  await window.getByLabel('Fonte do texto', { exact: true }).selectOption('Segoe UI');
  await window.getByLabel('Espaçamento entre linhas', { exact: true }).selectOption('2.2');
  await window.getByRole('button', { name: 'Sépia', exact: true }).click();
  await window.getByRole('checkbox', { name: 'Régua de leitura' }).check();
  await expect(window.locator('.reading-workbench')).toHaveAttribute('data-paper', 'sepia');
  await expect(window.locator('.ruler-mask')).toBeVisible();
  await window.getByRole('button', { name: 'Fechar painel de leitura' }).click();
  await window.keyboard.press('F8');
  await expect(window.locator('.app')).toHaveClass(/focus-mode/);
  await expect(window.locator('.reader-toolbar')).toBeHidden();
  await expect(window.locator('.exit-focus')).toBeVisible();
  await window.screenshot({ path: 'test-results/lume-foco-sepia.png' });
  await window.getByRole('button', { name: /Sair do foco/ }).click();
  await expect(window.locator('.reader-toolbar')).toBeVisible();
  expect(errors).toEqual([]);
});

test('seleciona texto refluído, salva nota e cria marcadores com nomes', async () => {
  await select('.reflow-article [data-paragraph]');
  await window.getByRole('button', { name: 'Anotar', exact: true }).click();
  await window.getByLabel('Sua anotação', { exact: true }).fill('Título útil para revisar.');
  await window.getByRole('button', { name: 'Salvar anotação' }).click();
  await expect(window.locator('.annotation-card')).toHaveCount(2);
  await window.getByRole('button', { name: 'Marcadores', exact: false }).filter({ hasText: 'Marcadores' }).first().click();
  await window.getByRole('button', { name: 'Marcar página 1', exact: true }).click();
  await window.getByLabel('Nome do marcador').fill('Resumo importante');
  await window.getByRole('button', { name: 'Salvar marcador' }).click();
  await expect(window.locator('.bookmark-card')).toContainText('Resumo importante');
  await window.getByRole('button', { name: 'Próxima página', exact: true }).click();
  await window.getByRole('button', { name: 'Marcar página 2', exact: true }).click();
  await window.getByLabel('Nome do marcador').fill('Exercícios');
  await window.getByRole('button', { name: 'Salvar marcador' }).click();
  await expect(window.locator('.bookmark-card')).toHaveCount(2);
  await window.getByRole('button', { name: 'Resumo importante Página 1', exact: true }).click();
  await expect(window.getByRole('textbox', { name: 'Página atual' })).toHaveValue('1');
  expect(createHash('sha256').update(await readFile(digital)).digest('hex')).toBe(originalHash);
});

test('narra com voz real do Windows, destaca o trecho e permite pausar e mudar velocidade', async () => {
  await window.getByRole('button', { name: 'Fechar painel de leitura' }).click();
  await expect.poll(() => window.locator('.voice-select option').evaluateAll(options => options.filter(option => option.getAttribute('value')).length)).toBeGreaterThan(0);
  await window.getByRole('button', { name: 'Ouvir', exact: true }).click();
  await expect(window.getByRole('button', { name: 'Pausar narração', exact: true })).toBeVisible();
  await expect(window.locator('.speaking-paragraph')).toHaveCount(1);
  await expect.poll(() => window.locator('.speech-bar audio').evaluate(audio => (audio as HTMLAudioElement).currentTime)).toBeGreaterThan(0);
  await window.getByRole('button', { name: 'Pausar narração', exact: true }).click();
  await expect(window.locator('.speech-progress')).toContainText('Narração pausada');
  await window.getByLabel('Velocidade da narração').selectOption('1.5');
  expect(await window.locator('.speech-bar audio').evaluate(audio => (audio as HTMLAudioElement).playbackRate)).toBe(1.5);
  await window.getByRole('button', { name: 'Reproduzir narração', exact: true }).click();
  await expect(window.locator('.speech-progress')).toContainText('Página 1');
  const [floating] = await Promise.all([
    app.waitForEvent('window'),
    window.getByRole('button', { name: 'Player flutuante da narração' }).click(),
  ]);
  await expect(floating.getByRole('button', { name: 'Próximo trecho' })).toBeEnabled();
  const reader = await app.browserWindow(window);
  await reader.evaluate(native => { native.showInactive(); native.close(); });
  expect(await reader.evaluate(native => native.isVisible())).toBe(false);
  await floating.getByRole('button', { name: 'Pausar narração' }).click();
  await expect(window.locator('.speech-progress')).toContainText('Narração pausada');
  await floating.getByRole('button', { name: 'Reproduzir narração' }).click();
  await expect(floating.getByRole('button', { name: 'Pausar narração' })).toBeVisible();
  await floating.getByRole('button', { name: 'Voltar ao livro' }).click();
  await expect.poll(() => floating.isClosed()).toBe(true);
  expect(await reader.evaluate(native => native.isVisible())).toBe(true);
  await window.getByRole('button', { name: 'Parar narração', exact: true }).click();
  await expect(window.locator('.speaking-paragraph')).toHaveCount(0);
  await window.getByRole('button', { name: 'Fechar narração' }).click();
  expect(errors).toEqual([]);
});

test('notas, marcadores e preferências sobrevivem ao reiniciar', async () => {
  await app.close(); await launch();
  await window.locator('.resume-reading').click();
  await expect(window.getByLabel('Modo de leitura')).toHaveValue('text');
  await expect(window.locator('.reading-workbench')).toHaveAttribute('data-paper', 'sepia');
  await expect(window.locator('.ruler-mask')).toBeVisible();
  await window.getByRole('button', { name: /^Anotações/ }).click();
  await expect(window.locator('.annotation-card')).toHaveCount(2);
  await expect(window.locator('.annotation-note').filter({ hasText: 'Revisar este conceito' })).toBeVisible();
  await window.getByRole('button', { name: /^Marcadores/ }).first().click();
  await expect(window.locator('.bookmark-card')).toHaveCount(2);
  await window.screenshot({ path: 'test-results/lume-notas-marcadores.png' });
  const stored = await notebook(); expect(stored.annotations).toHaveLength(2); expect(stored.bookmarks).toHaveLength(2);
});

test('retoma a narração após reiniciar e pausa no final da página', async () => {
  await window.getByRole('button', { name: 'Ouvir', exact: true }).click();
  const audio = () => window.locator('.speech-bar audio');
  await expect.poll(() => audio().evaluate((element: HTMLAudioElement) => element.duration)).toBeGreaterThan(1);
  await window.getByRole('button', { name: 'Pausar narração' }).click();
  await window.getByLabel('Posição do áudio', { exact: true }).focus();
  await window.getByLabel('Posição do áudio', { exact: true }).press('ArrowRight');
  const previous = await audio().evaluate((element: HTMLAudioElement) => element.currentTime);
  await expect.poll(() => window.evaluate(async () => {
    const { id } = (await globalThis.window.lume.listRecent())[0];
    return (await globalThis.window.lume.narrationPosition(id))?.time || 0;
  })).toBeGreaterThanOrEqual(previous - .1);
  const finalPosition = await audio().evaluate((element: HTMLAudioElement) => {
    element.currentTime = Math.min(element.currentTime + .5, element.duration - .25);
    return element.currentTime;
  });
  await app.close();
  await launch();
  await window.locator('.document-card-main').first().click();
  await window.getByRole('button', { name: /Continuar ouvindo/ }).click();
  await expect.poll(() => audio().evaluate((element: HTMLAudioElement) => element.currentTime)).toBeGreaterThanOrEqual(finalPosition);
  await expect(window.locator('.speech-progress')).toContainText(/Página \d+ · trecho/);
  const position = (await window.locator('.speech-progress [role=status]').textContent())!.match(/Página (\d+) · trecho (\d+) de (\d+)/)!;
  await window.getByLabel('Temporizador da narração').selectOption('page');
  for (let index = Number(position[2]); index <= Number(position[3]); index++) {
    await audio().evaluate((element: HTMLAudioElement) => { element.currentTime = Math.max(0, element.duration - .05); });
    if (index < Number(position[3])) {
      await expect(window.locator('.speech-progress')).toContainText(`Página ${position[1]} · trecho ${index + 1}`);
      await expect.poll(() => audio().evaluate((element: HTMLAudioElement) => element.currentTime)).toBeGreaterThan(0);
    }
  }
  await expect(window.locator('.speech-progress')).toContainText('Temporizador concluído');
  await expect(window.getByLabel('Página atual', { exact: true })).toHaveValue(position[1]);
  await window.getByRole('button', { name: 'Fechar narração' }).click();
});

test('reconhece uma página digitalizada offline, permite buscar e mantém o texto salvo', async () => {
  test.setTimeout(120000);
  await choose(scanned);
  await expect(window.locator('.document-heading h1')).toHaveText('Documento digitalizado');
  await expect(window.locator('#text-reading-view')).toContainText('ainda não tem texto selecionável');
  await window.getByRole('button', { name: 'Reconhecer esta página', exact: true }).click();
  await expect(window.locator('.ocr-status')).toContainText('Reconhecimento concluído', { timeout: 90000 });
  await expect(window.locator('.reflow-article')).toContainText(/LEITURA CONFORT[ÁA]VEL/i);
  await expect(window.locator('#pdf-container .lume-ocr-layer span').first()).toBeAttached();
  await window.getByRole('button', { name: 'Fechar painel de leitura' }).click();
  await window.getByRole('button', { name: /^Buscar/ }).click();
  await window.getByRole('textbox', { name: 'Buscar no documento' }).fill('digitalizado');
  await expect(window.locator('.match-count')).toContainText('de 1');
  await expect(window.locator('.text-mark.find-match')).toContainText('digitalizado');
  await window.getByRole('button', { name: 'Fechar busca' }).click();
  expect((await notebook()).ocrPages['1'].words.length).toBeGreaterThan(5);
  await window.getByRole('button', { name: 'Revisar a página', exact: true }).click();
  const review = window.getByRole('dialog', { name: 'Revisar página 1' });
  await expect(review.getByRole('img', { name: /Prévia da página 1/ })).toBeVisible();
  const body = review.locator('.review-block-select').filter({ hasText: /digitalizado/i });
  await body.click();
  const editor = review.getByRole('textbox', { name: 'Texto do bloco' });
  await editor.fill((await editor.inputValue()).replace(/digitalizado/i, 'digitalização revisada'));
  await review.getByRole('button', { name: 'Selecionar área para OCR' }).click();
  await review.getByLabel('Esquerda (%)').fill('5');
  await review.getByLabel('Topo (%)').fill('15');
  await review.getByLabel('Largura (%)').fill('88');
  await review.getByLabel('Altura (%)').fill('11');
  await review.getByRole('button', { name: 'Refazer OCR da área' }).click();
  await expect(review.getByRole('status')).toContainText('Área reconhecida', { timeout: 45000 });
  await expect(review.locator('.review-block-select').filter({ hasText: /LEITURA CONFORT[ÁA]VEL/ })).toHaveCount(1);
  await expect(review.locator('.review-block-select').filter({ hasText: 'digitalização revisada' })).toHaveCount(1);
  await window.screenshot({ path: test.info().outputPath('revisao-ocr.png') });
  await review.getByRole('button', { name: 'Salvar revisão' }).click();
  await expect(review).toHaveCount(0);
  await expect(window.locator('.reflow-article')).toContainText('digitalização revisada');
  expect((await notebook()).ocrPages['1'].reviewedAt).toEqual(expect.any(String));
  await window.getByRole('button', { name: /^Buscar/ }).click();
  await window.getByRole('textbox', { name: 'Buscar no documento' }).fill('digitalização revisada');
  await expect(window.locator('.text-mark.find-match')).toHaveText('digitalização revisada');
  await window.getByRole('button', { name: 'Fechar busca' }).click();
  const correctedBlock = window.locator('.reflow-block').filter({ hasText: 'digitalização revisada' });
  await correctedBlock.getByRole('button', { name: /Ouvir trecho/ }).click();
  await expect(correctedBlock).toHaveClass(/speaking-paragraph/, { timeout: 30000 });
  await window.getByRole('button', { name: 'Fechar narração' }).click();
  const copy = path.join(directory, 'Copia pesquisavel.pdf');
  await window.getByRole('button', { name: 'Reconhecer texto', exact: true }).click();
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath })) as typeof dialog.showSaveDialog;
  }, copy);
  await window.getByRole('button', { name: 'Salvar cópia pesquisável' }).click();
  await expect(window.getByRole('status').filter({ hasText: 'PDF pesquisável salvo' })).toBeVisible();
  const execute = promisify(execFile);
  const poppler = process.env.LUME_TEST_POPPLER;
  if (poppler) {
    const render = (file: string, output: string) => execute(path.join(poppler, 'pdftoppm.exe'), ['-r', '50', '-png', '-f', '1', '-l', '1', '-singlefile', file, output]);
    await render(scanned, path.join(directory, 'original'));
    await render(copy, path.join(directory, 'exportado'));
    expect(await readFile(path.join(directory, 'exportado.png'))).toEqual(await readFile(path.join(directory, 'original.png')));
  }
  const pdf = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const loading = pdf.getDocument({ data: new Uint8Array(await readFile(copy)), useSystemFonts: true });
  try {
    const exported = await loading.promise;
    const text = await (await exported.getPage(1)).getTextContent();
    const exportedText = text.items.map(item => 'str' in item ? item.str : '').join(' ').replace(/\s+/g, ' ');
    expect(exportedText).toContain('digitalização revisada');
    expect(exportedText).not.toMatch(/digitalizado/i);
    expect(exported.numPages).toBe(3);
  } finally { await loading.destroy(); }
  await window.getByRole('button', { name: 'Fechar painel de leitura' }).click();
  await window.screenshot({ path: 'test-results/lume-ocr-texto.png' });
  expect(errors).toEqual([]);
});

test('OCR do documento preserva páginas com texto e a leitura reconhecida reaparece ao reabrir', async () => {
  test.setTimeout(120000);
  await window.getByRole('button', { name: 'Reconhecer texto', exact: true }).click();
  await window.getByRole('button', { name: 'Reconhecer documento inteiro', exact: true }).click();
  await expect(window.locator('.ocr-status')).toContainText('Reconhecimento concluído', { timeout: 90000 });
  await expect.poll(async () => Object.keys((await notebook()).ocrPages).length).toBe(2);
  const stored = await notebook(); expect(stored.ocrPages['3']).toBeUndefined();
  await app.close(); await launch(); await window.locator('.resume-reading').click();
  await expect(window.locator('.reflow-article')).toContainText(/LEITURA CONFORT[ÁA]VEL/i);
  await expect(window.locator('.reflow-article')).toContainText('digitalização revisada');
  await expect(window.locator('#pdf-container .lume-ocr-layer span').first()).toBeAttached();
  expect(errors).toEqual([]);
});

test('ordena colunas, ignora marcas recorrentes e preserva a ordem revisada', async () => {
  const booklet = await PDFDocument.create(), font = await booklet.embedFont(StandardFonts.Helvetica);
  for (let page = 1; page <= 3; page++) {
    const sheet = booklet.addPage([600, 800]);
    const line = (text: string, x: number, y: number, size = 12) => sheet.drawText(text, { x, y, font, size });
    line('Curso de Metodologia', 40, 775);
    line(`Artigo acadêmico ${page}`, 40, 705, 22);
    for (let index = 0; index < 4; index++) {
      line(`Esquerda ${index + 1} organiza os conceitos.`, 38, 650 - index * 22);
      line(`Direita ${index + 1} apresenta os resultados.`, 326, 650 - index * 22);
    }
    line(`Apostila de pesquisa | ${page}`, 40, 24);
  }
  const file = path.join(directory, 'Artigo em colunas.pdf');
  await writeFile(file, await booklet.save());
  await choose(file);
  await window.getByLabel('Modo de leitura').selectOption('text');
  const article = window.locator('.reflow-article');
  await expect(article).toContainText(/Esquerda 1.*Esquerda 4.*Direita 1.*Direita 4/);
  await expect(article).not.toContainText('Curso de Metodologia');
  await expect(article).not.toContainText('Apostila de pesquisa');
  await window.getByRole('button', { name: 'Revisar a página', exact: true }).click();
  const review = window.getByRole('dialog', { name: 'Revisar página 1' });
  await expect(review.getByLabel('Incluir cabeçalhos e rodapés repetidos')).toBeVisible();
  await review.getByLabel('Incluir cabeçalhos e rodapés repetidos').check();
  const footer = review.locator('li').filter({ hasText: 'Apostila de pesquisa' });
  await footer.getByRole('button', { name: /Ignorar bloco/ }).click();
  const right = review.locator('li').filter({ hasText: 'Direita 1' });
  for (let index = 0; index < 4; index++) {
    const up = right.getByRole('button', { name: /Subir bloco/ });
    if (await up.isDisabled()) break;
    await up.click();
  }
  await review.getByRole('button', { name: 'Salvar revisão' }).click();
  await expect(article).toContainText(/Direita 1.*Esquerda 1/);
  await expect(article).toContainText('Curso de Metodologia');
  await expect(article).not.toContainText('Apostila de pesquisa');
  await app.close(); await launch(); await window.locator('.resume-reading').click();
  await expect(window.locator('.document-heading h1')).toHaveText('Artigo em colunas');
  await expect(window.locator('.reflow-article')).toContainText(/Direita 1.*Esquerda 1/);
  expect(errors).toEqual([]);
});
