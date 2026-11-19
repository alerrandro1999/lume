function validRepository(github) { return github && typeof github.owner === 'string' && /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/.test(github.owner) && typeof github.repo === 'string' && /^[a-zA-Z0-9_.-]{1,100}$/.test(github.repo) && !['.', '..'].includes(github.repo); }
function explain(error) {
  const code = String(error?.code || ''), message = String(error?.message || '');
  if (/SHA|CHECKSUM|SIGNATURE/i.test(code + message)) return 'A atualização não passou pela verificação de integridade ou assinatura. Nenhuma instalação foi iniciada. Tente novamente mais tarde.';
  if (/ENOSPC|no space/i.test(code + message)) return 'Não há espaço suficiente para baixar a atualização. Libere espaço e tente novamente.';
  if (/404|LATEST_VERSION_NOT_FOUND|NO_PUBLISHED_VERSIONS|CHANNEL_FILE_NOT_FOUND/.test(code + message)) return 'Ainda não há uma versão pública disponível neste canal.';
  return 'Não foi possível consultar ou baixar a atualização. Verifique sua conexão e tente novamente mais tarde.';
}
class Updates {
  constructor({ version, packaged, windowsStore, release, createUpdater, notify, beforeInstall = async () => {} }) {
    Object.assign(this, { createUpdater, notify, beforeInstall }); this.engine = null; this.pending = null;
    const channel = windowsStore || release?.channel === 'store' ? 'store' : 'direct';
    const stage = channel === 'store' ? 'store' : !validRepository(release?.github) ? 'unconfigured' : !packaged ? 'development' : release?.channel !== 'direct' ? 'unconfigured' : 'idle';
    const messages = { store: 'Esta versão recebe atualizações pela Microsoft Store.', unconfigured: 'As atualizações on-line ainda não estão disponíveis nesta edição. Por enquanto, utilize o instalador oficial para atualizar.', development: 'A consulta de atualizações fica disponível na versão instalada.', idle: 'Você pode verificar se há uma nova versão. O download e a instalação só começam quando você escolher.' };
    this.state = { revision: 0, version, channel, stage, message: messages[stage], availableVersion: null, checkedAt: null, percent: 0, transferred: 0, total: 0 };
  }
  read() { return { ...this.state }; }
  change(value) { Object.assign(this.state, value, { revision: this.state.revision + 1 }); this.notify(this.read()); }
  getEngine() {
    if (this.engine) return this.engine;
    const engine = this.createUpdater(); this.engine = engine;
    engine.autoDownload = false; engine.autoInstallOnAppQuit = false; engine.allowDowngrade = false; engine.allowPrerelease = false; engine.disableWebInstaller = true;
    engine.on('checking-for-update', () => this.change({ stage: 'checking', message: 'Verificando novas versões…' }));
    engine.on('update-available', info => this.change({ stage: 'available', availableVersion: String(info.version).slice(0, 80), message: 'Uma nova versão está disponível. Você pode baixá-la e continuar lendo.' }));
    engine.on('update-not-available', () => this.change({ stage: 'idle', availableVersion: null, message: 'Você está usando a versão mais recente disponível neste canal.' }));
    engine.on('download-progress', progress => this.change({ stage: 'downloading', percent: Math.max(0, Math.min(100, Number(progress.percent) || 0)), transferred: Math.max(0, Number(progress.transferred) || 0), total: Math.max(0, Number(progress.total) || 0), message: 'Baixando atualização. Você pode continuar lendo; o aplicativo não será reiniciado sozinho.' }));
    engine.on('update-downloaded', info => this.change({ stage: 'downloaded', availableVersion: String(info.version).slice(0, 80), percent: 100, message: 'Atualização baixada e conferida. Escolha quando reiniciar para instalar.' }));
    engine.on('error', error => this.change({ stage: 'error', message: explain(error) }));
    return engine;
  }
  async check() {
    if (['unconfigured', 'development', 'store', 'downloading', 'downloaded', 'installing'].includes(this.state.stage)) return this.read();
    if (this.pending) { await this.pending; return this.read(); }
    this.change({ stage: 'checking', message: 'Verificando novas versões…' });
    this.pending = Promise.resolve().then(async () => { try { await this.getEngine().checkForUpdates(); this.change({ checkedAt: new Date().toISOString() }); } catch (error) { this.change({ stage: 'error', message: explain(error), checkedAt: new Date().toISOString() }); } finally { this.pending = null; } });
    await this.pending; return this.read();
  }
  async download() {
    if (this.pending || !['available', 'error'].includes(this.state.stage) || !this.state.availableVersion) return this.read();
    this.change({ stage: 'downloading', percent: 0, transferred: 0, total: 0, message: 'Preparando o download…' });
    this.pending = Promise.resolve().then(async () => { try { await this.getEngine().downloadUpdate(); } catch (error) { this.change({ stage: 'error', message: explain(error) }); } finally { this.pending = null; } });
    await this.pending; return this.read();
  }
  async install() {
    if (this.state.stage !== 'downloaded' || this.pending) throw new Error('Baixe e confira a atualização antes de instalar.');
    this.change({ stage: 'installing', message: 'Salvando a leitura e preparando a instalação…' });
    try { await this.beforeInstall(); this.getEngine().quitAndInstall(false, true); }
    catch (error) { this.change({ stage: 'downloaded', message: error.message || 'Conclua a operação atual antes de atualizar.' }); }
    return this.read();
  }
}
module.exports = { Updates, validRepository };
