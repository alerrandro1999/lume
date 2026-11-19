import { _electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

test.describe.configure({ mode: 'serial' });

let directory: string;
let userData: string;
let pdfPath: string;
let invalidPath: string;
let brokenPath: string;
let app: ElectronApplication;
let page: Page;
const errors: string[] = [];

async function launch() {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) { if (value !== undefined) env[key] = value; }
  env.LUME_TEST_MODE = '1';
  env.LUME_USER_DATA = userData;
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.LUME_DEV_URL;
  app = await _electron.launch({ args: ['.'], env });
  page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await expect(page.getByRole('heading', { name: 'Aplicativos', exact: true })).toBeVisible();
  await expect(page.getByText('Em breve', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Importar livro', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Abrir Lume Leitor' }).click();
  await page.getByRole('heading', { name: /Sua próxima página/ }).waitFor();
}

async function choose(filePath: string | null) {
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showOpenDialog = (async () => ({ canceled: !filePath, filePaths: filePath ? [filePath] : [] })) as typeof dialog.showOpenDialog;
  }, filePath);
  await page.getByRole('button', { name: 'Importar livro', exact: true }).click();
}

test.beforeAll(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'lume-reader-test-'));
  userData = path.join(directory, 'profile');
  pdfPath = path.join(directory, 'Primeiros passos.pdf');
  invalidPath = path.join(directory, 'Arquivo inválido.pdf');
  brokenPath = path.join(directory, 'Arquivo danificado.pdf');
  const pdf = await PDFDocument.create();
  const serif = await pdf.embedFont(StandardFonts.TimesRoman);
  const italic = await pdf.embedFont(StandardFonts.TimesRomanItalic);
  const sans = await pdf.embedFont(StandardFonts.Helvetica);
  for (let index = 0; index < 3; index++) {
    const sheet = pdf.addPage([595, 842]);
    sheet.drawText('LUME / UM TEMPO PARA LER', { x: 64, y: 772, size: 9, font: sans, color: rgb(.6, .48, .25) });
    sheet.drawLine({ start: { x: 64, y: 752 }, end: { x: 531, y: 752 }, thickness: .5, color: rgb(.82, .82, .78) });
    sheet.drawText(['Uma página de cada vez.', 'Encontre seu ritmo.', 'Continue a história.'][index], { x: 64, y: 680, size: 33, font: serif, color: rgb(.2, .23, .18) });
    sheet.drawText('Boas ideias merecem uma leitura tranquila.', { x: 64, y: 639, size: 15, font: italic, color: rgb(.52, .48, .4) });
    const lines = [
      'Bem-vindo ao Lume, seu espaço para ler documentos PDF.',
      'Use as setas para navegar e ajuste o zoom ao seu ritmo.',
      'O texto pode ser selecionado, copiado e encontrado pela busca.',
      'Sua biblioteca e sua posição de leitura ficam neste computador.',
      '',
      'Para abrir outro documento, use Ctrl + O ou arraste um PDF.',
      'Para procurar uma palavra, use Ctrl + F e digite sua busca.',
      'Escolha entre ajustar à largura e visualizar a página inteira.',
      '',
      'O Lume guarda o lugar onde você parou. Na próxima leitura,',
      'basta escolher o documento na biblioteca para continuar.',
    ];
    lines.forEach((line, row) => sheet.drawText(line, { x: 64, y: 575 - row * 25, size: 12, font: sans, color: rgb(.32, .34, .3) }));
    sheet.drawLine({ start: { x: 64, y: 87 }, end: { x: 531, y: 87 }, thickness: .5, color: rgb(.82, .82, .78) });
    sheet.drawText('PRIMEIROS PASSOS', { x: 64, y: 62, size: 8, font: sans, color: rgb(.6, .6, .55) });
    sheet.drawText(String(index + 1).padStart(2, '0'), { x: 514, y: 62, size: 9, font: sans, color: rgb(.6, .6, .55) });
  }
  const bytes = await pdf.save();
  await writeFile(pdfPath, bytes);
  await writeFile(invalidPath, 'Este arquivo não é um PDF.');
  await writeFile(brokenPath, '%PDF-1.7\nEste PDF está danificado.');
  await launch();
});

test.afterAll(async () => { await app?.close(); });

test('abre, renderiza, busca, navega e salva o progresso de um PDF', async () => {
  await expect(page.getByText('Sua biblioteca está esperando a primeira história')).toBeVisible();
  await page.screenshot({ path: 'test-results/lume-biblioteca.png' });
  await choose(pdfPath);
  await expect(page.locator('.document-heading h1')).toHaveText('Primeiros passos');
  await expect(page.getByRole('textbox', { name: 'Página atual', exact: true })).toHaveValue('1');
  await expect(page.locator('#pdf-container .page[data-page-number="1"] canvas').first()).toBeVisible();
  await expect(page.locator('#pdf-container .textLayer').first()).toContainText('Uma página de cada vez.');
  await page.screenshot({ path: 'test-results/lume-leitura.png' });

  const initialWidth = await page.locator('#pdf-container .page').first().evaluate(element => element.getBoundingClientRect().width);
  await page.getByRole('button', { name: 'Aumentar texto', exact: true }).click();
  await expect.poll(() => page.locator('#pdf-container .page').first().evaluate(element => element.getBoundingClientRect().width)).toBeGreaterThan(initialWidth);
  await page.getByLabel('Ajuste de zoom', { exact: true }).selectOption('page-fit');
  const dimensions = await page.locator('#pdf-container .page').first().evaluate(element => ({ width: element.clientWidth, height: element.clientHeight }));
  expect(dimensions.height).toBeGreaterThan(dimensions.width);
  await page.getByRole('button', { name: 'Girar página', exact: true }).click();
  await expect.poll(() => page.locator('#pdf-container .page').first().evaluate(element => element.clientWidth > element.clientHeight)).toBe(true);
  await page.getByRole('button', { name: 'Girar página', exact: true }).click({ clickCount: 3 });

  await page.getByRole('button', { name: /^Buscar/ }).click();
  await page.getByRole('textbox', { name: 'Buscar no documento', exact: true }).fill('Lume');
  await expect(page.locator('.match-count')).toContainText(/de [1-9]/);
  await page.getByRole('button', { name: 'Fechar busca', exact: true }).click();
  await page.getByRole('button', { name: 'Próxima página', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Página atual', exact: true })).toHaveValue('2');
  await expect.poll(async () => {
    const stored = JSON.parse(await readFile(path.join(userData, 'library.json'), 'utf8'));
    return stored.documents[0]?.page;
  }).toBe(2);

  await page.getByRole('button', { name: 'Ativar tema escuro' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.screenshot({ path: 'test-results/lume-escuro.png' });
  await page.getByRole('button', { name: 'Ativar tema claro' }).click();
  await page.getByRole('button', { name: 'Ocultar barra lateral' }).click();
  await expect(page.locator('.app')).toHaveClass(/sidebar-hidden/);
  await page.getByRole('button', { name: 'Mostrar barra lateral' }).click();
  expect(errors).toEqual([]);
});

test('mantém a leitura ao cancelar ou abrir arquivos inválidos', async () => {
  await choose(null);
  await expect(page.locator('.document-heading h1')).toHaveText('Primeiros passos');
  await choose(invalidPath);
  await expect(page.getByRole('alert')).toContainText('não contém um PDF válido');
  await expect(page.locator('.document-heading h1')).toHaveText('Primeiros passos');
  await page.getByRole('button', { name: 'Fechar aviso' }).click();
  await choose(brokenPath);
  await expect(page.getByRole('alert')).toContainText(/Invalid PDF|inválido|PDF/i);
  await expect(page.locator('.document-heading h1')).toHaveText('Primeiros passos');
  await expect(page.locator('#pdf-container canvas').first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('volta ao hub e abre novamente o leitor na mesma página', async ({}, info) => {
  await page.getByRole('button', { name: 'Aplicativos', exact: true }).click();
  const appCard = page.getByRole('button', { name: 'Abrir Lume Leitor' });
  await expect(appCard).toBeFocused();
  await expect(page).toHaveTitle('Hub de aplicativos');
  const catalog = page.getByRole('list', { name: 'Catálogo de aplicativos' });
  await expect(catalog.getByRole('button')).toHaveCount(9);
  await expect(catalog.getByRole('button', { name: 'Abrir Bancada de Revisão Bibliográfica' })).toBeVisible();
  await expect(catalog.getByRole('button', { name: 'Abrir Estúdio de Transcrição' })).toBeVisible();
  await page.screenshot({ path: info.outputPath('hub.png') });
  await page.getByRole('button', { name: 'Ativar tema escuro' }).click();
  await appCard.press('Enter');
  await expect(page).toHaveTitle('Primeiros passos — Lume');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('textbox', { name: 'Página atual', exact: true })).toHaveValue('2');
  await expect(page.locator('#pdf-container .page[data-page-number="2"] canvas').first()).toBeVisible();
  await page.getByRole('button', { name: 'Ativar tema claro' }).click();
});

test('retoma a última página após fechar e reabrir o aplicativo', async () => {
  await app.close();
  await launch();
  await page.locator('.document-card').filter({ hasText: 'Primeiros passos' }).getByRole('button').first().click();
  await expect(page.getByRole('textbox', { name: 'Página atual', exact: true })).toHaveValue('2');
  await expect(page.locator('#pdf-container .page[data-page-number="2"] canvas').first()).toBeVisible();
  await page.getByRole('button', { name: 'Biblioteca', exact: false }).filter({ hasText: 'Biblioteca' }).last().click();
  await page.getByRole('button', { name: 'Remover Primeiros passos.pdf da lista', exact: true }).click();
  await expect(page.locator('.document-card').filter({ hasText: 'Primeiros passos' })).toHaveCount(0);
  expect((await readFile(pdfPath)).byteLength).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});
