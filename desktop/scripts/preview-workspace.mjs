import { _electron, expect } from '@playwright/test';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const profile = await mkdtemp(path.join(os.tmpdir(), 'lume-preview-'));
const env = { ...process.env, LUME_TEST_MODE: '1', LUME_USER_DATA: profile };
delete env.ELECTRON_RUN_AS_NODE; delete env.LUME_DEV_URL;
const app = await _electron.launch({ args: ['.'], env });
try {
  const page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; win.setSize(1440, 1000); win.webContents.setBackgroundThrottling(false); });
  for (const file of ['examples/Primeiros passos.pdf', 'examples/Entre páginas.epub']) {
    await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, path.resolve(file));
    await page.getByRole('button', { name: 'Importar livro', exact: true }).click();
    await expect(page.locator('.loading-overlay')).toHaveCount(0, { timeout: 30000 });
  }
  await page.getByRole('tab', { name: 'Primeiros passos', exact: true }).click();
  await expect(page.locator('#pdf-container .textLayer')).toContainText('Uma página de cada vez.');
  await page.getByRole('button', { name: 'Comparar livros', exact: true }).click();
  await expect(page.locator('#compare-epub-container iframe')).toBeVisible({ timeout: 30000 });
  await expect(page.locator('.comparison-loading')).toHaveCount(0, { timeout: 30000 });
  await page.getByRole('button', { name: 'Miniaturas', exact: true }).click();
  await expect(page.getByAltText('Miniatura da página 1')).toBeVisible();
  await mkdir('.lume-test-data/previews', { recursive: true });
  const capture = async name => { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); const png = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG().toString('base64')); await writeFile(path.resolve('.lume-test-data/previews', name), Buffer.from(png, 'base64')); };
  await capture('comparacao.png');
  await page.locator('.library-utilities').getByRole('button', { name: 'Backup', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Central da biblioteca' })).toBeVisible();
  await capture('backup.png');
  console.log('Prévias em .lume-test-data/previews.');
} finally { await app.close(); }
