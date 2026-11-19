const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const { transcriptionTools } = require('./native-runtime.cjs');

const directFormats = ['wav', 'mp3', 'flac'];
const containerFormats = ['mp4', 'm4a'];
const importFormats = [...directFormats, ...containerFormats];
const maxDuration = 7200;

async function audioDuration(file) {
  const { parseFile } = await import('music-metadata');
  const metadata = await parseFile(file, { duration: true, skipCovers: true, maxMemoryAllocation: 16 * 1024 ** 2 }).catch(() => null);
  const duration = metadata?.format.duration;
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('Não foi possível ler o áudio. Confira a gravação.');
  if (duration > maxDuration) throw new Error('Importe gravações de até 2 horas.');
  return duration;
}

async function convertAudio(runtime, file, destination, job, range) {
  const engine = transcriptionTools(runtime).ffmpeg;
  if (!await fs.access(engine).then(() => true, () => false)) throw new Error('O conversor de áudio não está disponível nesta cópia do Lume.');
  if (job.cancelled) return;
  await new Promise((resolve, reject) => {
    const args = [
      '-nostdin', '-hide_banner', '-loglevel', 'error', '-n', '-protocol_whitelist', 'file',
      ...(range ? ['-ss', String(range.startMs / 1000)] : ['-f', 'mov']), '-i', file,
      '-map', '0:a:0', '-map_metadata', '-1', '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'flac', '-compression_level', '3',
      '-t', String(range ? (range.endMs - range.startMs) / 1000 : maxDuration + 1), destination,
    ];
    const child = spawn(engine, args, { cwd: path.dirname(engine), windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    job.child = child;
    let diagnostics = '';
    child.stderr.setEncoding('utf8').on('data', data => { diagnostics = `${diagnostics}${data}`.slice(-4000); });
    child.once('error', () => reject(new Error('Não foi possível iniciar o conversor de áudio.')));
    child.once('close', code => {
      if (job.cancelled || code === 0) return resolve();
      const message = /matches no streams/i.test(diagnostics)
        ? 'Este arquivo não tem uma faixa de áudio.'
        : range ? 'Não foi possível separar este trecho do áudio.' : 'Não foi possível extrair o áudio. Abra outro MP4 ou M4A.';
      reject(new Error(message));
    });
  });
}

module.exports = { directFormats, containerFormats, importFormats, audioDuration, convertAudio };
