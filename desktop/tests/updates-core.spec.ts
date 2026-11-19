import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
const require = createRequire(import.meta.url);
const { Updates } = require('../electron/updates.cjs'), { validateReleaseConfig, assertStore } = require('../scripts/release-config.cjs');
class Engine extends EventEmitter {
  checks = 0; downloads = 0; installs = 0; autoDownload = true; autoInstallOnAppQuit = true; allowDowngrade = true; allowPrerelease = true; disableWebInstaller = false;
  async checkForUpdates() { this.checks++; this.emit('checking-for-update'); this.emit('update-available', { version: '0.9.0' }); }
  async downloadUpdate() { this.downloads++; this.emit('download-progress', { percent: 50, transferred: 50, total: 100 }); this.emit('update-downloaded', { version: '0.9.0' }); return ['test.exe']; }
  quitAndInstall() { this.installs++; }
}
function setup(overrides: Record<string, unknown> = {}) { const engine = new Engine(), states: any[] = []; const manager = new Updates({ version: '0.8.0', packaged: true, windowsStore: false, release: { channel: 'direct', github: { owner: 'lume-tests', repo: 'releases' } }, createUpdater: () => engine, notify: (value: any) => states.push(value), ...overrides }); return { engine, manager, states }; }
test('edições sem repositório, desenvolvimento e Store não consultam nenhum servidor', async () => {
  for (const [options, stage] of [[{ release: undefined }, 'unconfigured'], [{ packaged: false }, 'development'], [{ windowsStore: true }, 'store'], [{ release: { channel: 'store' } }, 'store'], [{ release: { channel: 'direct', github: { owner: 'https://intruso', repo: 'teste' } } }, 'unconfigured']] as const) { const { manager, engine } = setup(options); expect((await manager.check()).stage).toBe(stage); await manager.download(); expect(engine.checks).toBe(0); expect(engine.downloads).toBe(0); await expect(manager.install()).rejects.toThrow('Baixe e confira'); }
});
test('consulta e download não instalam automaticamente; instalação aguarda salvar a leitura', async () => {
  let release!: () => void; const barrier = new Promise<void>(resolve => { release = resolve; }); const { manager, engine, states } = setup({ beforeInstall: () => barrier }); await manager.check(); expect(engine.autoDownload).toBe(false); expect(engine.autoInstallOnAppQuit).toBe(false); expect(engine.allowDowngrade).toBe(false); expect(engine.downloads).toBe(0); await manager.download(); expect(manager.read().stage).toBe('downloaded'); expect(states.some(state => state.percent === 50)).toBe(true); expect(engine.installs).toBe(0); const pending = manager.install(); expect(manager.read().stage).toBe('installing'); expect(engine.installs).toBe(0); release(); await pending; expect(engine.installs).toBe(1);
});
test('consultas concorrentes são reunidas e uma versão já baixada não é sobrescrita', async () => {
  const { manager, engine } = setup(); await Promise.all([manager.check(), manager.check()]); expect(engine.checks).toBe(1); await manager.download(); await manager.check(); expect(engine.checks).toBe(1); expect(manager.read().stage).toBe('downloaded');
});
test('falhas de rede, integridade e inicialização permitem tentar novamente sem instalar', async () => {
  const { manager, engine } = setup(); engine.checkForUpdates = async () => { throw new Error('net::ERR_INTERNET_DISCONNECTED'); }; expect((await manager.check()).stage).toBe('error'); engine.checkForUpdates = async () => { engine.emit('update-available', { version: '0.9.0' }); }; await manager.check(); engine.downloadUpdate = async () => { throw Object.assign(new Error('checksum mismatch'), { code: 'ERR_CHECKSUM_MISMATCH' }); }; const failed = await manager.download(); expect(failed.stage).toBe('error'); expect(failed.message).toContain('integridade'); expect(engine.installs).toBe(0); await expect(manager.install()).rejects.toThrow('Baixe e confira');
  const broken = setup({ createUpdater: () => { throw new Error('inicialização'); } }).manager; await broken.check(); expect(broken.pending).toBe(null); await broken.check(); expect(broken.pending).toBe(null);
});
test('operações pendentes impedem reinício e preservam a atualização pronta', async () => {
  const { manager, engine } = setup({ beforeInstall: async () => { throw new Error('Conclua a exportação'); } }); await manager.check(); await manager.download(); const result = await manager.install(); expect(result.stage).toBe('downloaded'); expect(result.message).toBe('Conclua a exportação'); expect(engine.installs).toBe(0);
});
test('uma consulta sem novidades informa a versão atual e não oferece download', async () => {
  const { manager, engine } = setup(); engine.checkForUpdates = async () => { engine.emit('update-not-available', { version: '0.8.0' }); }; await manager.check(); expect(manager.read().stage).toBe('idle'); expect(manager.read().message).toContain('mais recente'); await manager.download(); expect(engine.downloads).toBe(0);
});
test('configuração de publicação não aceita URLs, comandos ou uma identidade de Store incompleta', async () => {
  expect(validateReleaseConfig({}, 'pessoa/lume').github).toEqual({ owner: 'pessoa', repo: 'lume' }); for (const value of ['https://github.com/pessoa/lume', 'pessoa/../lume', 'pessoa/lume;comando', 'pessoa/..']) expect(() => validateReleaseConfig({}, value)).toThrow(); expect(() => assertStore({ identityName: '', publisher: '', publisherDisplayName: '' })).toThrow('Partner Center'); expect(() => assertStore({ identityName: 'Empresa.Lume', publisher: 'CN=12345', publisherDisplayName: 'Empresa' })).not.toThrow();
  const script = '../scripts/package-release.mjs'; const { buildConfig } = await import(script); const pkg = require('../package.json'), config = buildConfig(pkg, validateReleaseConfig({}), 'installer'); expect(config.publish).toBe(null); expect(config.nsis.deleteAppDataOnUninstall).toBe(false); expect(config.nsis.runAfterFinish).toBe(false); expect(config.extraMetadata.lumeRelease.github).toBe(null); expect(() => buildConfig(pkg, validateReleaseConfig({}), 'release')).toThrow('repositório público');
});
