import { _electron, test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp, readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
const { version } = createRequire(import.meta.url)('../package.json');
test.describe.configure({ mode: 'serial' });
let app: ElectronApplication, page: Page, profile: string;
const errors: string[] = [];
test.beforeAll(async () => { profile = await mkdtemp(path.join(os.tmpdir(), 'lume-updates-')); const env: Record<string, string> = {}; for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value; env.LUME_TEST_MODE = '1'; env.LUME_USER_DATA = profile; delete env.ELECTRON_RUN_AS_NODE; delete env.LUME_DEV_URL; app = await _electron.launch({ args: ['.'], env }); page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
  await page.getByRole('button', { name: 'Abrir Lume Leitor' }).click();
  await expect(page.getByRole('heading', { name: /Sua próxima página/ })).toBeVisible();
});
test.afterAll(async () => { await app?.close(); });
const panel = () => page.getByRole('dialog', { name: 'Sobre e atualizações', exact: true });
test('mostra a versão na barra lateral quando o canal está desconectado', async () => {
  const about = page.getByRole('dialog', { name: 'Sobre o Lume', exact: true });
  await expect(page.getByRole('button', { name: 'Atualizações do Lume', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Sobre o Lume', exact: true }).click();
  await expect(about).toContainText(`Versão ${version}`);
  await expect(about.getByRole('status')).toHaveCount(0);
  await expect(about.getByRole('button', { name: 'Verificar atualizações', exact: true })).toHaveCount(0);
  expect((await page.evaluate(() => window.lume.checkUpdates())).stage).toBe('unconfigured');
  const reader = page.locator('#app-lume main');
  await expect(reader).toHaveAttribute('inert', '');
  await about.getByRole('button', { name: 'Fechar diálogo', exact: true }).click();
  await expect(reader).not.toHaveAttribute('inert');
});
test('consulta, baixa em segundo plano e instala só ao clicar depois de salvar a leitura', async () => {
  await app.evaluate(({ app }) => { const require = process.getBuiltinModule('node:module').createRequire(app.getAppPath() + '/package.json'); const { Updates } = require(require('node:path').join(app.getAppPath(), 'electron/updates.cjs')); const original = Updates.prototype.read; Updates.prototype.read = function () { (globalThis as any).__testUpdates = this; return original.call(this); }; });
  await page.evaluate(() => window.lume.updateStatus());
  await app.evaluate(() => { const require = process.getBuiltinModule('node:module').createRequire(process.cwd() + '/package.json'); const { EventEmitter } = require('node:events'), engine = new EventEmitter() as any, manager = (globalThis as any).__testUpdates; engine.checkForUpdates = async () => { engine.emit('checking-for-update'); engine.emit('update-available', { version: '0.9.0' }); }; engine.downloadUpdate = () => new Promise<void>(resolve => { engine.finish = () => { engine.emit('update-downloaded', { version: '0.9.0' }); resolve(); }; engine.emit('download-progress', { percent: 42, transferred: 420000, total: 1000000 }); }); engine.installs = 0; engine.quitAndInstall = () => { engine.installs++; }; manager.createUpdater = () => engine; manager.change({ stage: 'idle', message: 'Pronto para consultar', availableVersion: null }); (globalThis as any).__testEngine = engine; });
  await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [file] })) as typeof dialog.showOpenDialog; }, path.resolve('examples/Primeiros passos.pdf')); await page.getByRole('button', { name: 'Importar livro', exact: true }).click(); await expect(page.locator('.document-heading h1')).toHaveText('Primeiros passos'); await page.getByLabel('Página atual', { exact: true }).fill('2'); await page.getByLabel('Página atual', { exact: true }).press('Enter'); await expect(page.locator('.position-saved')).toContainText('página 2');
  await page.getByRole('button', { name: 'Atualizações do Lume', exact: true }).click(); await panel().getByRole('button', { name: 'Verificar atualizações', exact: true }).click(); await expect(panel()).toContainText('Nova versão 0.9.0'); await panel().getByRole('button', { name: 'Baixar atualização', exact: true }).click(); await expect(panel().getByRole('progressbar')).toHaveAttribute('value', '42'); await panel().getByRole('button', { name: 'Fechar diálogo', exact: true }).click(); await expect(page.locator('.document-heading h1')).toBeVisible(); await app.evaluate(() => (globalThis as any).__testEngine.finish()); await page.getByRole('button', { name: 'Atualizações do Lume', exact: true }).click(); await expect(panel().getByRole('status')).toContainText('baixada e conferida'); expect(await app.evaluate(() => (globalThis as any).__testEngine.installs)).toBe(0); await panel().getByRole('checkbox', { name: 'Verificar novas versões ao iniciar o Lume', exact: true }).check(); expect(await page.evaluate(() => localStorage.getItem('lume-update-check-on-start'))).toBe('true'); await panel().getByRole('button', { name: 'Salvar leitura e reiniciar para atualizar', exact: true }).click(); await expect.poll(() => app.evaluate(() => (globalThis as any).__testEngine.installs)).toBe(1); expect(JSON.parse(await readFile(path.join(profile, 'library.json'), 'utf8')).documents[0].page).toBe(2); await app.evaluate(() => (globalThis as any).__testUpdates.change({ stage: 'idle', message: 'Teste concluído' })); await panel().getByRole('button', { name: 'Fechar diálogo', exact: true }).click();
});
test('motor real baixa de servidor local, verifica SHA-512 e rejeita arquivo adulterado sem executar instalador', async () => {
  test.skip(process.platform!=='win32','Este teste usa o instalador NSIS e o manifesto de atualizações do Windows.');
  const payload = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(512 * 1024, 7)]), sha512 = createHash('sha512').update(payload).digest('base64'); let broken = false;
  const server: Server = createServer((request, response) => { if (request.url?.startsWith('/latest.yml')) { const version = broken ? '999.0.1' : '999.0.0', url = broken ? 'quebrado.exe' : 'teste.exe'; response.end(JSON.stringify({ version, files: [{ url, sha512, size: payload.length }], path: url, sha512, releaseDate: new Date().toISOString() })); } else { response.setHeader('Content-Length', payload.length); response.end(broken ? Buffer.alloc(payload.length, 8) : payload); } }); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); const address = server.address() as { port: number };
  try { for (const corrupt of [false, true]) { broken = corrupt; const result = await app.evaluate(async ({ app }, args) => { const require = process.getBuiltinModule('node:module').createRequire(app.getAppPath() + '/package.json'); const { NsisUpdater } = require('electron-updater'), fs = require('node:fs/promises'), path = require('node:path'); const updater = new NsisUpdater({ provider: 'generic', url: args.url }); updater.logger = null; updater.autoDownload = false; updater.autoInstallOnAppQuit = false; updater.forceDevUpdateConfig = true; updater.disableDifferentialDownload = true; updater.disableWebInstaller = true; updater.updateConfigPath = path.join(app.getPath('userData'), 'local-update-test.yml'); await fs.writeFile(updater.updateConfigPath || path.join(app.getPath('userData'), 'local-update-test.yml'), JSON.stringify({ provider: 'generic', url: args.url, updaterCacheDirName: `lume-test-${Date.now()}` })); let downloaded = false; updater.on('update-downloaded', () => { downloaded = true; }); const checked = await updater.checkForUpdates(); try { const files = await updater.downloadUpdate(); return { available: checked?.isUpdateAvailable, downloaded, hash: require('node:crypto').createHash('sha512').update(await fs.readFile(files[0])).digest('base64'), error: '' }; } catch (error: any) { return { available: checked?.isUpdateAvailable, downloaded, hash: '', error: error.code || error.message }; } }, { url: `http://127.0.0.1:${address.port}/` }); expect(result.available).toBe(true); if (corrupt) { expect(result.downloaded).toBe(false); expect(result.error).toMatch(/CHECKSUM|SHA/i); } else { expect(result.downloaded).toBe(true); expect(result.hash).toBe(sha512); } } }
  finally { await new Promise<void>(resolve => server.close(() => resolve())); }
  expect(errors).toEqual([]);
});



