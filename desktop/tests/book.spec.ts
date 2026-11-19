import { _electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test.describe.configure({ mode: 'serial' });
let app: ElectronApplication;
let window: Page;
let profile: string;
let filePath: string;
const errors: string[] = [];

async function launch() {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value;
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.LUME_DEV_URL;
  env.LUME_TEST_MODE = '1';
  env.LUME_USER_DATA = profile;
  app = await _electron.launch({ args: ['.'], env });
  window = await app.firstWindow();
  await window.getByRole('button', { name: 'Abrir Lume Leitor' }).click();
  window.on('pageerror', error => errors.push(error.message));
  await expect(window.getByRole('heading', { name: /Sua próxima página/ })).toBeVisible();
}

async function expectSaved(page: number, savedPage = page) {
  await expect(window.getByRole('textbox', { name: 'Página atual', exact: true })).toHaveValue(String(page));
  await expect(window.locator('.position-saved')).toContainText(`Você parou na página ${savedPage}.`);
  await expect.poll(async () => JSON.parse(await readFile(path.join(profile, 'library.json'), 'utf8')).documents[0].page).toBe(savedPage);
}

test.beforeAll(async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'lume-book-test-'));
  profile = path.join(directory, 'profile');
  filePath = path.join(directory, 'Livro de oito páginas.pdf');
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.TimesRoman);
  for (let index = 1; index <= 8; index++) {
    const page = pdf.addPage([595, 842]);
    page.drawText(`Capítulo ${index}`, { x: 65, y: 735, size: 32, font, color: rgb(.25, .28, .2) });
    for (let row = 0; row < 12; row++) page.drawText('Uma boa leitura começa com uma página de cada vez.', { x: 65, y: 660 - row * 25, size: 13, font });
    page.drawText(String(index), { x: 290, y: 50, size: 11, font });
  }
  await writeFile(filePath, await pdf.save());
  await launch();
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [filePath] })) as typeof dialog.showOpenDialog;
  }, filePath);
  await window.getByRole('button', { name: 'Importar livro', exact: true }).click();
  await expect(window.locator('.document-heading h1')).toHaveText('Livro de oito páginas');
});

test.afterAll(async () => { await app?.close(); });

test('vira páginas lateralmente, mostra porcentagem e confirma o marcador salvo', async () => {
  await expect(window.getByLabel('Modo de leitura')).toHaveValue('single');
  await expect(window.locator('#pdf-container .page')).toHaveCount(1);
  await expect(window.locator('.progress-percent')).toHaveText('13% do livro');
  await window.getByRole('button', { name: 'Virar para a próxima página', exact: true }).click();
  await expectSaved(2);
  await window.keyboard.press('ArrowRight');
  await expectSaved(3);
  await expect(window.locator('.progress-percent')).toHaveText('38% do livro');
  const bounds = await window.locator('#pdf-container').evaluate(container => {
    const page = container.querySelector('.page')!.getBoundingClientRect();
    const area = container.getBoundingClientRect();
    return { fits: page.height <= area.height + 2 && page.width <= area.width + 2 };
  });
  expect(bounds.fits).toBe(true);
  await window.screenshot({ path: 'test-results/lume-pagina-a-pagina.png' });
  expect(errors).toEqual([]);
});

test('abre duas páginas, vira duplas sem pular e mantém o último limite', async () => {
  await window.getByLabel('Modo de leitura').selectOption('book');
  await expect(window.locator('#pdf-container .spread .page')).toHaveCount(2);
  await expect(window.locator('#pdf-container .spread .page').first()).toHaveAttribute('data-page-number', '2');
  await expect(window.locator('#pdf-container .spread .page').last()).toHaveAttribute('data-page-number', '3');
  await expectSaved(2, 3);
  await expect(window.locator('.progress-percent')).toHaveText('38% do livro');
  await window.getByRole('button', { name: 'Virar para a próxima página', exact: true }).click();
  await expectSaved(4, 5);
  await expect(window.locator('.spread-range')).toHaveText('Páginas 4–5 em exibição');
  await window.screenshot({ path: 'test-results/lume-livro-aberto.png' });
  await window.getByRole('button', { name: 'Virar para a página anterior', exact: true }).click();
  await expectSaved(2, 3);
  const input = window.getByRole('textbox', { name: 'Página atual', exact: true });
  await input.fill('8');
  await input.press('Enter');
  await expectSaved(8);
  await expect(window.locator('.progress-percent')).toHaveText('100% do livro');
  await expect(window.getByRole('button', { name: 'Virar para a próxima página', exact: true })).toBeDisabled();
  await window.getByLabel('Modo de leitura').selectOption('single');
  await expectSaved(8);
  await expect(window.locator('#pdf-container .page')).toHaveCount(1);
});

test('busca chega a páginas fora da tela e a barra navega até a posição escolhida', async () => {
  await window.getByRole('button', { name: /^Buscar/ }).click();
  await window.getByRole('textbox', { name: 'Buscar no documento' }).fill('Capítulo 7');
  await expect(window.locator('.match-count')).toHaveText('1 de 1');
  await expectSaved(7);
  await expect(window.locator('#pdf-container .page')).toHaveAttribute('data-page-number', '7');
  await window.getByRole('button', { name: 'Fechar busca' }).click();
  const slider = window.getByRole('slider', { name: 'Ir para uma página' });
  await slider.press('Home');
  await slider.press('ArrowRight');
  await slider.press('ArrowRight');
  await expectSaved(3);
  await expect(window.locator('.progress-percent')).toHaveText('38% do livro');
  await window.getByLabel('Modo de leitura').selectOption('scroll');
  await expect(window.locator('#pdf-container .page')).toHaveCount(8);
  await window.getByLabel('Modo de leitura').selectOption('single');
  await expectSaved(3);
  expect(errors).toEqual([]);
});

test('aumenta o texto e conserva a ampliação ao virar páginas e reiniciar', async () => {
  const width = () => window.locator('#pdf-container .page').first().evaluate(element => element.getBoundingClientRect().width);
  const initial = await width();
  await window.getByRole('button', { name: 'Aumentar texto', exact: true }).click();
  await expect.poll(width).toBeGreaterThan(initial * 1.1);
  const larger = await width();
  const selected = await window.getByLabel('Ajuste de zoom', { exact: true }).inputValue();
  expect(Number(selected)).toBeGreaterThan(0);
  await window.getByRole('button', { name: 'Virar para a próxima página', exact: true }).click();
  await expectSaved(4);
  expect(await width()).toBeCloseTo(larger, 0);
  await app.close();
  await launch();
  await window.locator('.resume-reading').click();
  await expectSaved(4);
  await expect(window.getByLabel('Ajuste de zoom', { exact: true })).toHaveValue(selected);
  expect(await width()).toBeCloseTo(larger, 0);
  await window.getByRole('button', { name: 'Diminuir texto', exact: true }).click();
  await expect.poll(width).toBeLessThan(larger);
  await window.getByLabel('Ajuste de zoom', { exact: true }).selectOption('page-fit');
  const input = window.getByRole('textbox', { name: 'Página atual', exact: true });
  await input.fill('3');
  await input.press('Enter');
  await expectSaved(3);
  expect(errors).toEqual([]);
});

test('lembra o marcador, a porcentagem e o modo ao reiniciar e cabe em janela menor', async () => {
  await window.getByLabel('Modo de leitura').selectOption('book');
  await expectSaved(2, 3);
  await app.close();
  await launch();
  await expect(window.locator('.resume-reading')).toContainText('Você parou na página 3 de 8 · 38% do livro');
  await expect(window.locator('.document-card .card-percent')).toHaveText('38% do livro');
  await window.locator('.resume-reading').click();
  await expect(window.getByLabel('Modo de leitura')).toHaveValue('book');
  await expectSaved(2, 3);
  await expect(window.locator('#pdf-container .spread .page')).toHaveCount(2);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(940, 700));
  await expect.poll(() => window.locator('.reader-toolbar').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await expect(window.locator('.progress-percent')).toBeVisible();
  await window.screenshot({ path: 'test-results/lume-livro-janela-menor.png' });
  expect(errors).toEqual([]);
});
