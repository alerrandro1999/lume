const path = require('node:path');
function transcriptionTools(runtime, platform = process.platform) {
  if (!['win32', 'darwin'].includes(platform)) throw new Error('Os componentes locais de áudio estão disponíveis para Windows e macOS.');
  return { whisper: path.join(runtime, platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli'), ffmpeg: path.join(runtime, 'ffmpeg', platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg') };
}
function speechHelper(platform = process.platform, resources = process.resourcesPath, packaged = !!process.resourcesPath) {
  if (platform !== 'darwin') throw new Error('O auxiliar de voz nativo é exclusivo do macOS.');
  return packaged ? path.join(resources, 'transcription', 'runtime', 'lume-speech') : path.join(__dirname, '../resources/transcription/runtime/lume-speech');
}
module.exports = { transcriptionTools, speechHelper };
