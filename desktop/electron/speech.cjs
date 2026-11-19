const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { speechHelper } = require('./native-runtime.cjs');

class Speech {
  constructor() { this.children = new Set(); this.cachedVoices = null; }

  request(payload) {
    if (!['win32', 'darwin'].includes(process.platform)) return Promise.reject(new Error('A narração local está disponível para Windows e macOS.'));
    return new Promise((resolve, reject) => {
      const mac = process.platform === 'darwin';
      const script = mac ? '' : fs.readFileSync(path.join(__dirname, 'speech.ps1'), 'utf8');
      const executable = mac ? speechHelper('darwin', process.resourcesPath, require('electron').app?.isPackaged === true) : path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
      const args = mac ? [] : ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')];
      const child = spawn(executable, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      child.lumeAction = payload.action;
      this.children.add(child);
      const output = [];
      let bytes = 0;
      let failed = false;
      const timer = setTimeout(() => { failed = true; child.kill(); }, 45000);
      child.stdout.on('data', data => {
        bytes += data.length;
        if (bytes > 24 * 1024 * 1024) { failed = true; child.kill(); } else output.push(data);
      });
      child.stderr.resume();
      child.on('error', () => { clearTimeout(timer); this.children.delete(child); reject(new Error('Não foi possível iniciar a voz do sistema.')); });
      child.on('close', code => {
        clearTimeout(timer);
        this.children.delete(child);
        if (code !== 0 || failed) reject(new Error('A narração foi interrompida ou a voz não está disponível.'));
        else resolve(Buffer.concat(output).toString('utf8').trim());
      });
      child.stdin.on('error', () => {});
      child.stdin.end(JSON.stringify(payload));
    });
  }

  async voices() {
    if (!this.cachedVoices) this.cachedVoices = this.request({ action: 'voices' }).then(JSON.parse).catch(error => { this.cachedVoices = null; throw error; });
    return this.cachedVoices;
  }

  async synthesize(text, voice) {
    if (typeof text !== 'string' || !text.trim() || text.length > 2400 || typeof voice !== 'string' || voice.length > 200) throw new Error('Trecho de narração inválido.');
    if (this.children.size >= 3) throw new Error('Aguarde a preparação do áudio atual.');
    const encoded = await this.request({ action: 'synthesize', text, voice });
    const wav = Buffer.from(encoded, 'base64');
    if (wav.subarray(0, 4).toString() !== 'RIFF') throw new Error('Não foi possível preparar o áudio desta voz.');
    return new Uint8Array(wav);
  }

  cancel() { for (const child of this.children) if (child.lumeAction !== 'voices') child.kill(); }
}

module.exports = { Speech };
