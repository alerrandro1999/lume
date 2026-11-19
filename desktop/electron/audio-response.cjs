const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');

const types = { '.mp3': 'audio/mpeg', '.m4b': 'audio/mp4', '.m4a': 'audio/mp4', '.wav': 'audio/wav', '.flac': 'audio/flac', '.webm': 'audio/webm' };

async function audioResponse(file, request) {
  if (!file) return new Response('Áudio não encontrado', { status: 404 });
  let info;
  try { info = await fs.stat(file); }
  catch { return new Response('O arquivo foi movido ou excluído', { status: 404 }); }
  if (!info.isFile() || !info.size) return new Response('Áudio indisponível', { status: 404 });

  const { size } = info;
  const range = request.headers.get('range');
  let start = 0;
  let end = size - 1;
  if (range) {
    const invalid = () => new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match || (!match[1] && !match[2])) return invalid();
    if (match[1]) {
      start = Number(match[1]);
      if (match[2]) end = Math.min(end, Number(match[2]));
    } else {
      start = Math.max(0, size - Number(match[2]));
    }
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) return invalid();
  }
  const headers = {
    'Content-Type': types[path.extname(file).toLowerCase()] || 'application/octet-stream',
    'Accept-Ranges': 'bytes',
    'Content-Length': String(end - start + 1),
    ...(range && { 'Content-Range': `bytes ${start}-${end}/${size}` }),
  };
  const status = range ? 206 : 200;
  if (request.method === 'HEAD') return new Response(null, { status, headers });
  const stream = createReadStream(file, { start, end });
  request.signal?.addEventListener('abort', () => stream.destroy(), { once: true });
  return new Response(Readable.toWeb(stream), { status, headers });
}

module.exports = { audioResponse };
