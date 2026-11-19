const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { Speech } = require('./speech.cjs');
const { safeName } = require('./export-notes.cjs');

function waveParts(bytes) {
  const data = Buffer.from(bytes); let format, pcm;
  if (data.toString('ascii', 0, 4) !== 'RIFF' || data.toString('ascii', 8, 12) !== 'WAVE') throw new Error('Áudio inválido.');
  for (let offset = 12; offset + 8 <= data.length;) {
    const size = data.readUInt32LE(offset + 4); if (offset + 8 + size > data.length) throw new Error('Áudio incompleto.');
    const name = data.toString('ascii', offset, offset + 4);
    if (name === 'fmt ') format = data.subarray(offset + 8, offset + 8 + size);
    if (name === 'data') pcm = data.subarray(offset + 8, offset + 8 + size);
    offset += 8 + size + (size % 2);
  }
  if (!format || format.length < 16 || !pcm || ![1, 3].includes(format.readUInt16LE(0))) throw new Error('Formato de voz incompatível com a exportação WAV.');
  return { format, pcm };
}
function splitText(text) {
  const chunks = [];
  while (text.length) { let end = Math.min(1800, text.length); if (end < text.length) { const space = text.lastIndexOf(' ', end); if (space > 600) end = space; } chunks.push(text.slice(0, end)); text = text.slice(end).trimStart(); }
  return chunks;
}
async function writeAll(file, bytes) { let offset = 0; while (offset < bytes.length) { const result = await file.write(bytes, offset, bytes.length - offset); if (!result.bytesWritten) throw new Error('Não foi possível gravar o áudio.'); offset += result.bytesWritten; } }
class Audiobooks {
  constructor(notify) { this.notify = notify; this.job = null; this.speech = new Speech(); }
  cancel() { if (this.job) { this.job.canceled = true; this.speech.cancel(); } }
  async export(entry, chapters, voice, directory) {
    if (this.job) throw new Error('Já existe uma exportação de audiobook em andamento.');
    if (!Array.isArray(chapters) || !chapters.length || chapters.length > 20000 || chapters.some(chapter => typeof chapter?.title !== 'string' || chapter.title.length > 300 || typeof chapter.text !== 'string' || chapter.text.length > 2000000) || chapters.reduce((sum, chapter) => sum + chapter.text.length, 0) > 20000000) throw new Error('Texto do audiobook inválido ou muito extenso.');
    const job = { id: randomUUID(), canceled: false }; this.job = job;
    let root;
    try { if (!(await this.speech.voices()).some(item => item.name === voice)) throw new Error('Escolha uma voz instalada no sistema.'); root = await fs.realpath(directory); if (job.canceled) throw new Error('Exportação cancelada.'); }
    catch (error) { this.job = null; throw error; }
    const staging = path.join(root, `.lume-audio-${job.id}`);
    const destination = path.join(root, `${safeName(entry.title || entry.name)} - áudio ${job.id.slice(0, 8)}`);
    const readable = chapters.filter(chapter => chapter.text.trim()); const files = [];
    let done = 0; const total = readable.reduce((sum, chapter) => sum + splitText(chapter.text).length, 0);
    if (!total) { this.job = null; throw new Error('Não há texto para narrar. Para um PDF digitalizado, reconheça o texto antes de exportar.'); }
    try {
      await fs.mkdir(staging);
      for (let index = 0; index < readable.length; index++) {
        const chapter = readable[index], name = `${String(index + 1).padStart(3, '0')} - ${safeName(chapter.title)}.wav`;
        const file = await fs.open(path.join(staging, name), 'wx'); let format, length = 0, headerLength = 0;
        try {
          for (const chunk of splitText(chapter.text)) {
            if (job.canceled) throw new Error('Exportação cancelada.');
            this.notify({ running: true, done, total, chapter: chapter.title });
            const parts = waveParts(await this.speech.synthesize(chunk, voice));
            if (job.canceled) throw new Error('Exportação cancelada.');
            if (!format) {
              format = parts.format; headerLength = 12 + 8 + format.length + format.length % 2 + 8;
              const header = Buffer.alloc(headerLength); header.write('RIFF'); header.write('WAVE', 8); header.write('fmt ', 12); header.writeUInt32LE(format.length, 16); format.copy(header, 20); header.write('data', headerLength - 8); await writeAll(file, header);
            } else if (!format.equals(parts.format)) throw new Error('A voz alterou o formato de áudio durante a exportação.');
            if (length + parts.pcm.length > 0xffff0000) throw new Error('Este capítulo excede o tamanho máximo do formato WAV. Exporte partes menores.');
            await writeAll(file, parts.pcm); length += parts.pcm.length; done++; this.notify({ running: true, done, total, chapter: chapter.title });
          }
          const size = Buffer.alloc(4); size.writeUInt32LE(headerLength - 8 + length); await file.write(size, 0, 4, 4); size.writeUInt32LE(length); await file.write(size, 0, 4, headerLength - 4);
        } finally { await file.close(); }
        files.push({ title: chapter.title, file: name });
      }
      if (job.canceled) throw new Error('Exportação cancelada.');
      await fs.writeFile(path.join(staging, 'Playlist.m3u'), '#EXTM3U\n' + files.map(file => `#EXTINF:-1,${file.title.replace(/[\r\n]/g, ' ')}\n${file.file}`).join('\n') + '\n', 'utf8');
      await fs.writeFile(path.join(staging, 'Livro.json'), JSON.stringify({ title: entry.title || entry.name, voice, format: 'WAV', chapters: files }, null, 2));
      await fs.rename(staging, destination);
      this.notify({ running: false, done, total, chapter: '', path: destination });
      return { directory: destination, title: entry.title || entry.name, chapters: files };
    } catch (error) { this.notify({ running: false, done, total, chapter: '', error: job.canceled ? 'Exportação cancelada.' : error.message }); throw new Error(job.canceled ? 'Exportação cancelada.' : error.message); }
    finally { try { if (path.dirname(staging) === root && path.basename(staging) === `.lume-audio-${job.id}`) await fs.rm(staging, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); } finally { this.job = null; } }
  }
}
module.exports = { Audiobooks, waveParts, splitText };
