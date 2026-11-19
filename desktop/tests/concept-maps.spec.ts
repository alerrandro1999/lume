import { _electron, expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);

async function launch(profile: string) {
  const env: Record<string, string> = { LUME_TEST_MODE: '1', LUME_USER_DATA: profile };
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined && !(key in env)) env[key] = value;
  delete env.ELECTRON_RUN_AS_NODE; delete env.LUME_DEV_URL;
  const executablePath = process.env.LUME_CONCEPT_TEST_EXECUTABLE;
  const app = await _electron.launch({ ...(executablePath ? { executablePath } : { args: ['.'] }), env });
  const page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false));
  await page.getByRole('button', { name: 'Abrir Mapas Conceituais', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Novo mapa conceitual', exact: true })).toBeEnabled();
  return { app, page };
}
async function create(page: Page, title: string) {
  await page.getByRole('button', { name: 'Novo mapa conceitual', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Novo mapa conceitual' });
  await dialog.getByLabel('Nome do mapa', { exact: true }).fill(title);
  await dialog.getByRole('button', { name: 'Criar mapa', exact: true }).click();
  await expect(dialog).toHaveCount(0);
}
async function saved(page: Page) { await expect(page.locator('.concept-save-state')).toHaveText('Salvo neste computador'); }
const current = (page: Page) => page.evaluate(async () => { const api = window.lume.conceptMaps; return api.open((await api.list())[0].id); });
async function drag(page: Page, from: Locator, to: Locator) {
  const a = await from.boundingBox(), b = await to.boundingBox();
  if (!a || !b) throw Error('Elementos do mapa não estão visíveis.');
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down(); await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 16 }); await page.mouse.up();
}

test('arrasta ideias, conecta com setas, edita relações, desfaz, exporta e reabre o mapa', async ({}, info) => {
  test.setTimeout(240_000);
  const profile = await mkdtemp(path.join(os.tmpdir(), 'lume-concept-ui-'));
  let app: ElectronApplication | undefined;
  try {
    const launched = await launch(profile); app = launched.app; const page = launched.page;
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await create(page, 'Como construímos conhecimento');
    const board = page.getByRole('region', { name: 'Quadro do mapa conceitual', exact: true });
    const paletteIdea = page.locator('.concept-palette').getByRole('button', { name: 'Ideia', exact: true });
    await paletteIdea.dragTo(board, { targetPosition: { x: 200, y: 220 } });
    await expect(page.locator('.concept-node')).toHaveCount(1);
    await page.getByLabel('Nome do bloco', { exact: true }).fill('Conhecimento prévio');
    await page.getByLabel('Notas e ideias', { exact: true }).fill('O que o estudante já sabe.');
    await paletteIdea.dragTo(board, { targetPosition: { x: 570, y: 420 } });
    await expect(page.locator('.concept-node')).toHaveCount(2);
    await page.getByLabel('Nome do bloco', { exact: true }).fill('Aprendizagem significativa');
    await page.getByLabel('Notas e ideias', { exact: true }).fill('Relacionar novas ideias ao conhecimento existente.');
    await saved(page);
    const initial = await current(page), first = initial.nodes[0], second = initial.nodes[1];
    const firstCard = page.locator(`[data-concept-node="${first.id}"]`), secondCard = page.locator(`[data-concept-node="${second.id}"]`);
    await firstCard.hover();
    await drag(page, firstCard.locator('.concept-port-right'), secondCard.locator('.concept-port-left'));
    await expect(page.locator('[data-concept-edge]')).toHaveCount(1);
    await page.getByLabel('Nome da relação', { exact: true }).fill('favorece');
    await page.getByLabel('Traço', { exact: true }).selectOption('dashed');
    await page.getByRole('button', { name: 'Cor Violeta', exact: true }).click();
    await saved(page);
    const edgePath = await page.locator('.concept-edge-line').getAttribute('d');
    const body = secondCard.locator('.concept-node-body'), box = await body.boundingBox();
    if (!box) throw Error('Bloco de destino ausente.');
    await page.mouse.move(box.x + 70, box.y + 55); await page.mouse.down(); await page.mouse.move(box.x + 126, box.y - 9, { steps: 12 }); await page.mouse.up();
    await saved(page);
    const moved = (await current(page)).nodes[1];
    expect(moved.x).not.toBe(second.x); expect(moved.y).not.toBe(second.y);
    expect(await page.locator('.concept-edge-line').getAttribute('d')).not.toBe(edgePath);
    await page.getByRole('button', { name: 'Desfazer alteração', exact: true }).click(); await saved(page);
    expect((await current(page)).nodes[1].x).toBe(second.x);
    await page.getByRole('button', { name: 'Refazer alteração', exact: true }).click(); await saved(page);
    expect((await current(page)).nodes[1].x).toBe(moved.x);
    await page.getByRole('button', { name: 'Excluir bloco selecionado', exact: true }).click();
    await expect(page.locator('[data-concept-edge]')).toHaveCount(0);
    await page.getByRole('button', { name: 'Desfazer alteração', exact: true }).click();
    await expect(page.locator('.concept-node')).toHaveCount(2); await expect(page.locator('[data-concept-edge]')).toHaveCount(1);
    await page.getByRole('button', { name: 'Enquadrar todo o mapa', exact: true }).click();
    await expect(firstCard).toBeInViewport(); await expect(secondCard).toBeInViewport();
    const beforeZoom = await page.getByLabel('Zoom do mapa', { exact: true }).innerText();
    await board.hover({ position: { x: 80, y: 150 } }); await page.mouse.wheel(0, -100);
    await expect(page.getByLabel('Zoom do mapa', { exact: true })).not.toHaveText(beforeZoom);
    await page.getByRole('button', { name: 'Enquadrar todo o mapa', exact: true }).click();
    await page.screenshot({ path: info.outputPath('mapa-claro.png'), animations: 'disabled' });
    const jsonFile = path.join(profile, 'Meu mapa.json'), svgFile = path.join(profile, 'Meu mapa.svg');
    async function exportTo(filePath: string, name: string) {
      await app!.evaluate(({ dialog }, file) => { dialog.showSaveDialog = (async () => ({ canceled: false, filePath: file })) as typeof dialog.showSaveDialog; }, filePath);
      await page.getByRole('button', { name: 'Exportar', exact: true }).click(); await page.getByRole('button', { name, exact: true }).click();
      await expect(page.locator('.concept-general-status')).toContainText('exportad');
    }
    await exportTo(jsonFile, 'Mapa editável (JSON)');
    expect(JSON.parse(await readFile(jsonFile, 'utf8')).edges[0]).toMatchObject({ label: 'favorece', style: 'dashed' });
    await exportTo(svgFile, 'Imagem SVG');
    const svg = await readFile(svgFile, 'utf8');
    expect(await page.evaluate(text => new DOMParser().parseFromString(text, 'image/svg+xml').querySelectorAll('parsererror').length, svg)).toBe(0);
    await page.getByRole('button', { name: 'Ativar tema escuro', exact: true }).click();
    await page.screenshot({ path: info.outputPath('mapa-escuro.png'), animations: 'disabled' });
    expect(errors).toEqual([]);
    await saved(page); await app.close(); app = undefined;
    const reopened = await launch(profile); app = reopened.app;
    await expect(reopened.page.locator('.concept-node')).toHaveCount(2);
    await expect(reopened.page.locator('[data-concept-edge]')).toHaveCount(1);
    await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [file] })) as typeof dialog.showOpenDialog; }, jsonFile);
    await reopened.page.getByRole('button', { name: 'Importar', exact: true }).click();
    await expect(reopened.page.locator('.concept-general-status')).toHaveText('Mapa importado.');
    expect(await reopened.page.evaluate(() => window.lume.conceptMaps.list())).toHaveLength(2);
    await reopened.page.getByRole('button', { name: 'Excluir mapa atual', exact: true }).click();
    await reopened.page.getByRole('button', { name: 'Confirmar exclusão do mapa', exact: true }).click();
    await expect(reopened.page.getByRole('dialog')).toHaveCount(0);
    expect(await reopened.page.evaluate(() => window.lume.conceptMaps.list())).toHaveLength(1);
  } finally { await app?.close(); }
});

test('vincula uma ideia a um livro, arrasta fontes e abre a referência exata na Bancada', async ({}, info) => {
  test.setTimeout(180_000);
  const root = await mkdtemp(path.join(os.tmpdir(), 'lume-concept-sources-')), profile = path.join(root, 'profile');
  const bookFile = path.join(root, 'Aprendizagem.pdf');
  const pdf = await PDFDocument.create(); pdf.addPage().drawText('Material de teste para o mapa conceitual.');
  const bytes = await pdf.save(); await writeFile(bookFile, bytes);
  const { Library } = require('../electron/library.cjs'), { BibliographicReviews } = require('../electron/bibliography.cjs');
  const library = new Library(profile), entry = library.opened(bookFile, bytes.length, 'pdf');
  entry.title = 'Aprendizagem e conhecimento'; entry.author = 'Silva, Ana'; library.save();
  const csv = path.join(root, 'referencias.csv'); await writeFile(csv, 'Título;Autores;Ano\nPráticas de estudo e aprendizagem;Silva, Ana;2025');
  const reviews = new BibliographicReviews(profile), review = reviews.create('Minha revisão');
  await reviews.import(review.id, [csv], { kind: 'database', source: 'Referências de teste' });
  const record = reviews.get(review.id).records[0];
  let app: ElectronApplication | undefined;
  try {
    const launched = await launch(profile); app = launched.app; const page = launched.page;
    await create(page, 'Conexões da pesquisa');
    await page.getByRole('button', { name: 'Criar primeira ideia', exact: true }).click();
    await page.getByLabel('Nome do bloco', { exact: true }).fill('Meu argumento principal');
    await page.getByRole('button', { name: 'Vincular material', exact: true }).click();
    await page.getByRole('button', { name: 'Vincular Livro Aprendizagem e conhecimento', exact: true }).click();
    await expect(page.locator('.concept-source-link')).toContainText('Aprendizagem e conhecimento'); await saved(page);
    expect((await current(page)).nodes[0]).toMatchObject({ kind: 'idea', source: { kind: 'book', id: entry.id } });
    await page.getByRole('button', { name: 'Abrir no hub', exact: true }).click();
    await expect(page.locator('.document-heading h1')).toContainText('Aprendizagem');
    await page.locator('#app-lume .hub-return').click(); await page.getByRole('button', { name: 'Abrir Mapas Conceituais', exact: true }).click();
    const board = page.getByRole('region', { name: 'Quadro do mapa conceitual', exact: true });
    await page.getByRole('button', { name: 'Adicionar Livro Aprendizagem e conhecimento', exact: true }).dragTo(board, { targetPosition: { x: 600, y: 180 } });
    await expect(page.locator('.concept-node')).toHaveCount(2);
    await page.getByRole('searchbox', { name: 'Buscar livros, autores e referências', exact: true }).fill('silva');
    await page.getByRole('button', { name: 'Adicionar Autor Silva, Ana', exact: true }).click();
    await expect(page.locator('.concept-node')).toHaveCount(3);
    await page.getByRole('searchbox', { name: 'Buscar livros, autores e referências', exact: true }).fill('Práticas de estudo');
    await page.getByRole('button', { name: 'Adicionar Referência Práticas de estudo e aprendizagem', exact: true }).dragTo(board, { targetPosition: { x: 610, y: 480 } });
    await expect(page.locator('.concept-node')).toHaveCount(4); await saved(page);
    const state = await current(page);
    expect(state.nodes.find(node => node.kind === 'reference')?.source).toMatchObject({ id: review.id, recordId: record.id });
    await page.getByRole('button', { name: 'Abrir no hub', exact: true }).click();
    await expect(page.getByRole('article', { name: 'Referência selecionada' })).toContainText('Práticas de estudo e aprendizagem');
    await page.locator('#app-bibliography .hub-return').click(); await page.getByRole('button', { name: 'Abrir Mapas Conceituais', exact: true }).click();
    await page.getByRole('button', { name: 'Enquadrar todo o mapa', exact: true }).click();
    const author = state.nodes.find(node => node.kind === 'author')!, book = state.nodes.find(node => node.kind === 'book')!;
    const authorPort = page.locator(`[data-concept-node="${author.id}"] .concept-port-right`), bookPort = page.locator(`[data-concept-node="${book.id}"] .concept-port-left`);
    await authorPort.focus(); await authorPort.press('Enter'); await bookPort.focus(); await bookPort.press('Enter');
    await expect(page.locator('[data-concept-edge]')).toHaveCount(1);
    await page.getByLabel('Nome da relação', { exact: true }).fill('escreveu'); await saved(page);
    await page.screenshot({ path: info.outputPath('mapa-fontes.png'), animations: 'disabled' });
  } finally { await app?.close(); }
});
