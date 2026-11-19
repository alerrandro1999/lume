const fs = require('node:fs/promises');
const nativeFs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { audioResponse } = require('./audio-response.cjs');
function validExport(item) {
  return typeof item?.directory === 'string' && path.isAbsolute(item.directory) &&
    typeof item.bookId === 'string' && /^[a-f0-9]{64}$/.test(item.bookId) &&
    typeof item.title === 'string' && item.title.length <= 1000 &&
    Number.isFinite(item.createdAt) && Number.isInteger(item.index) && item.index >= 0 &&
    Array.isArray(item.chapters) && item.chapters.length <= 20000 && item.index < item.chapters.length &&
    item.chapters.every(chapter => typeof chapter?.title === 'string' && chapter.title.length <= 300 &&
      typeof chapter.file === 'string' && /^[^/\\:]+\.wav$/i.test(chapter.file) &&
      (chapter.position === undefined || Number.isFinite(chapter.position) && chapter.position >= 0) &&
      (chapter.rate === undefined || Number.isFinite(chapter.rate) && chapter.rate >= .5 && chapter.rate <= 3));
}
class AudioPlayer {
  constructor(directory) {
    this.directory = directory;
    this.file = path.join(directory, 'player.json');
    this.exportsFile = path.join(directory, 'audiobooks.json');
    this.tracks = [];
    this.timer = null;
    this.deadline = 0;
    this.reload();
    try {
      const saved = JSON.parse(nativeFs.readFileSync(this.exportsFile, 'utf8'));
      this.exports = Array.isArray(saved) ? saved.filter(validExport).slice(0, 1000) : [];
    } catch { this.exports = []; }
  }
  saveExports() {
    nativeFs.mkdirSync(this.directory, { recursive: true });
    nativeFs.writeFileSync(`${this.exportsFile}.tmp`, JSON.stringify(this.exports));
    nativeFs.renameSync(`${this.exportsFile}.tmp`, this.exportsFile);
  }
  linkExport(bookId, exported) {
    const previous = this.exports.find(item => item.directory === exported.directory);
    if (previous?.bookId === bookId) return;
    const item = { ...exported, bookId, createdAt: Date.now(), index: 0 };
    if (!validExport(item)) throw new Error('Audiobook gerado inválido.');
    const old = this.exports;
    this.exports = [item, ...old.filter(item => item.directory !== exported.directory)].slice(0, 1000);
    try { this.saveExports(); } catch (error) { this.exports = old; throw error; }
  }
  async linkDirectory(bookId, directory) {
    const canonical = await fs.realpath(directory);
    const file = path.join(canonical, 'Livro.json');
    const metadata = await fs.stat(file).catch(() => null);
    if (!metadata?.isFile() || metadata.size > 8 * 1024 * 1024) throw new Error('Escolha a pasta do audiobook que contém o arquivo Livro.json.');
    const { title, format, chapters } = JSON.parse(await fs.readFile(file, 'utf8'));
    if (format !== 'WAV' || !Array.isArray(chapters)) throw new Error('Escolha uma pasta de audiobook gerada pelo Lume.');
    this.linkExport(bookId, { directory: canonical, title, chapters: chapters.map(item => ({ title: item?.title, file: item?.file })) });
    return this.listExports(bookId);
  }
  listExports(bookId) {
    return this.exports.filter(item => item.bookId === bookId).map(({ directory, title, chapters, createdAt }) => ({
      directory, title, chapters: chapters.length, createdAt,
    }));
  }
  async openExport(directory, index) {
    const audiobook = this.exports.find(item => item.directory === directory);
    if (!audiobook) throw new Error('Audiobook vinculado não encontrado.');
    const chapters = audiobook.chapters;
    index ??= audiobook.index;
    if (!Number.isInteger(index) || !chapters[index]) throw new Error('Capítulo do audiobook não encontrado.');
    const file = path.join(audiobook.directory, chapters[index].file);
    if (!await fs.stat(file).then(info => info.isFile(), () => false)) throw new Error('O arquivo deste capítulo foi movido ou removido. Confira a pasta do audiobook.');
    const track = await this.add(file, { directory, index, position: chapters[index].position, rate: chapters[index].rate });
    return { directory, bookId: audiobook.bookId, title: audiobook.title, chapters: chapters.map(chapter => chapter.title), index, track };
  }
  reload() { try { const data = JSON.parse(nativeFs.readFileSync(this.file, 'utf8')); this.tracks = Array.isArray(data.tracks) ? data.tracks.filter(track => /^[a-f0-9]{64}$/.test(track.id) && typeof track.path === 'string').slice(0, 100) : []; } catch { this.tracks = []; } }
  save() { nativeFs.mkdirSync(this.directory, { recursive: true }); nativeFs.writeFileSync(`${this.file}.tmp`, JSON.stringify({ version: 1, tracks: this.tracks })); nativeFs.renameSync(`${this.file}.tmp`, this.file); }
  list() { return this.tracks.map(track => ({ ...track, url: `lume://app/audio/${track.id}` })); }
  async add(file, linked) {
    if (typeof file !== 'string' || !path.isAbsolute(file) || !['.mp3', '.m4b', '.m4a', '.wav'].includes(path.extname(file).toLowerCase())) throw new Error('Escolha MP3, M4B, M4A ou WAV.');
    const canonical = await fs.realpath(file), stat = await fs.stat(canonical); if (!stat.isFile() || stat.size > 8 * 1024 ** 3) throw new Error('Abra um arquivo de áudio de até 8 GB.');
    const { parseFile } = await import('music-metadata');
    let metadata; try { metadata = await parseFile(canonical, { duration: true, includeChapters: true, skipCovers: true, maxMemoryAllocation: 16 * 1024 ** 2, maxChapterCount: 1000 }); } catch { throw new Error('Não foi possível ler os metadados deste áudio. Verifique o arquivo.'); }
    const normalize = value => process.platform === 'win32' ? value.toLowerCase() : value;
    const byPath = this.tracks.find(track => normalize(track.path) === normalize(canonical));
    const id = byPath?.id || createHash('sha256').update(normalize(canonical)).digest('hex'), previous = this.tracks.find(track => track.id === id);
    const chapters = (metadata.format.chapters || []).map((chapter, index) => ({ title: String(chapter.title || `Capítulo ${index + 1}`).slice(0, 300), start: Number(chapter.start) / (chapter.timeScale || 1) })).filter(chapter => Number.isFinite(chapter.start) && chapter.start >= 0).sort((a, b) => a.start - b.start);
    const track = { ...previous, id, path: canonical, name: path.basename(canonical), title: String(metadata.common.title || path.basename(canonical, path.extname(canonical))).slice(0, 300), author: String(metadata.common.artist || '').slice(0, 300), size: stat.size, duration: metadata.format.duration || 0, chapters, position: previous?.position ?? linked?.position ?? 0, rate: previous?.rate ?? linked?.rate ?? 1, bookmarks: previous?.bookmarks || [], openedAt: new Date().toISOString() };
    if (linked) track.linked = { directory: linked.directory, index: linked.index };
    this.tracks = [track, ...this.tracks.filter(item => item.id !== id)].slice(0, 100); this.save(); return { ...track, url: `lume://app/audio/${id}` };
  }
  progress(id, position, rate) {
    const track = this.tracks.find(track => track.id === id);
    if (!track || !Number.isFinite(position) || position < 0 || position > (track.duration || 1e8) + 2 || !Number.isFinite(rate) || rate < .5 || rate > 3) throw new Error('Posição do áudio inválida.');
    track.position = Math.min(position, track.duration || position);
    track.rate = rate;
    this.save();
    const audiobook = track.linked && this.exports.find(item => item.directory === track.linked.directory);
    const chapter = audiobook?.chapters[track.linked.index];
    if (chapter) {
      audiobook.index = track.linked.index;
      chapter.position = track.position;
      chapter.rate = rate;
      this.saveExports();
    }
  }
  bookmark(id, value) { const track = this.tracks.find(track => track.id === id); if (!track || typeof value?.label !== 'string' || !value.label.trim() || value.label.length > 160 || !Number.isFinite(value.time) || value.time < 0 || value.time > (track.duration || 1e8)) throw new Error('Marcador de áudio inválido.'); track.bookmarks.unshift({ id: randomUUID(), label: value.label.trim(), time: value.time }); this.save(); return this.list(); }
  removeBookmark(id, mark) { const track = this.tracks.find(track => track.id === id); if (track) { track.bookmarks = track.bookmarks.filter(item => item.id !== mark); this.save(); } return this.list(); }
  sleep(minutes, notify) { if (this.timer) clearTimeout(this.timer); this.timer = null; this.deadline = 0; if (minutes === 0) return 0; if (!Number.isInteger(minutes) || minutes < 1 || minutes > 180) throw new Error('Temporizador inválido.'); this.deadline = Date.now() + minutes * 60000; this.timer = setTimeout(() => { this.timer = null; this.deadline = 0; notify(); }, minutes * 60000); return this.deadline; }
  response(id, request) { return audioResponse(this.tracks.find(track => track.id === id)?.path, request); }
}
module.exports = { AudioPlayer };
