import { _electron, expect as baseExpect } from '@playwright/test';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
const expect = baseExpect.configure({ timeout: 20000 });
const root = path.resolve('.lume-test-data'); await mkdir(root, { recursive: true });
const profile = await mkdtemp(path.join(root, 'updates-preview-')), pkg = JSON.parse(await readFile('package.json', 'utf8'));
const env = { ...process.env, LUME_TEST_MODE: '1', LUME_USER_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE; delete env.LUME_DEV_URL;
const app = await _electron.launch({ executablePath: path.resolve('release/win-unpacked/Lume.exe'), args: [], env });
try {
  const page = await app.firstWindow(); await expect(page.getByRole('heading', { name: /Sua próxima página/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Atualizações do Lume', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Sobre o Lume', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Sobre o Lume', exact: true });
  await expect(panel).toContainText(`Versão ${pkg.version}`);
  if ((await page.evaluate(() => window.lume.checkUpdates())).stage !== 'unconfigured') throw new Error('Esta compilação sem repositório não deve consultar atualizações.');
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const png = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG().toString('base64'));
  await mkdir(path.join(root, 'previews'), { recursive: true }); await writeFile(path.join(root, 'previews', 'atualizacoes.png'), Buffer.from(png, 'base64'));
  console.log(`Executável ${pkg.version} com a tela Sobre e o canal desconectado validados.`);
} finally { await app.close(); }
