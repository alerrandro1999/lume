const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const defaults = () => ({ goal: 20, breakEvery: 25, breakDuration: 5, reminders: false, wpm: 200, autoPace: true });
const blankBook = () => ({ seconds: 0, paceWords: 0, paceSeconds: 0, samples: 0, cards: [], crop: { top: 0, bottom: 0, left: 0, right: 0 } });
const dayKey = () => { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; };
const sessionId = /^[a-f0-9-]{36}$/i;
const validPoint = value => Number.isInteger(value?.page) && value.page > 0 && (value.location == null || typeof value.location === 'string' && value.location.startsWith('epubcfi(') && value.location.length <= 4000);
const validNarration = value => validPoint(value) && Number.isInteger(value.index) && value.index >= 0 && value.index < 100000 && typeof value.paragraph === 'string' && value.paragraph.length <= 1000 && typeof value.voice === 'string' && value.voice.length <= 200 && Number.isFinite(value.time) && value.time >= 0 && value.time <= 3600;
const validGlossary = value => validPoint(value) && typeof value.term === 'string' && !!value.term.trim() && value.term.length <= 1000 && typeof value.meaning === 'string' && !!value.meaning.trim() && value.meaning.length <= 12000 && typeof value.quote === 'string' && value.quote.length <= 12000 && ['Wikcionário', 'MyMemory'].includes(value.source);
const validSession = value => typeof value?.id === 'string' && sessionId.test(value.id) && ['reading', 'listening'].includes(value.kind) && Number.isFinite(value.startedAt) && value.startedAt > 0 && Number.isInteger(value.seconds) && value.seconds >= 0 && value.seconds <= 604800;

function gradeFlashcard(card, grade) {
  if (!card || !['again', 'hard', 'good', 'easy'].includes(grade)) throw new Error('Revisão inválida.');
  let interval = grade === 'again' ? 0 : grade === 'hard' ? Math.max(1, Math.round(card.interval * 1.2)) : grade === 'good' ? Math.max(1, Math.round(card.interval * 2)) : Math.max(3, Math.round(card.interval * 3));
  interval = Math.min(365, interval);
  return { ...card, interval, due: Date.now() + (interval ? interval * 86400000 : 60000), reviews: card.reviews + 1 };
}

function validateStudyExtras(record) {
  if (record.narration != null && !validNarration(record.narration)) throw new Error('Posição de narração inválida no backup.');
  if (record.glossary != null && (!Array.isArray(record.glossary) || record.glossary.length > 500 || record.glossary.some(item => !validGlossary(item) || !sessionId.test(item.id) || !Number.isFinite(item.createdAt)))) throw new Error('Glossário inválido no backup.');
  if (record.sessions != null && (!Array.isArray(record.sessions) || record.sessions.length > 200 || record.sessions.some(item => !validSession(item)))) throw new Error('Sessões inválidas no backup.');
  if (record.listeningSeconds != null && (!Number.isSafeInteger(record.listeningSeconds) || record.listeningSeconds < 0)) throw new Error('Tempo de escuta inválido no backup.');
}

class Study {
  constructor(directory, library) {
    this.file = path.join(directory, 'study.json'); this.library = library;
    this.data = { settings: defaults(), days: {}, books: {} };
    try { const data = JSON.parse(fs.readFileSync(this.file, 'utf8')); this.data = { settings: { ...defaults(), ...data.settings }, days: data.days || {}, books: data.books || {} }; }
    catch (error) { if (error.code !== 'ENOENT') console.warn('Não foi possível recuperar os dados de estudo:', error.message); }
  }
  book(id) { if (!this.library.find(id)) throw new Error('Livro não encontrado.'); return this.data.books[id] ||= blankBook(); }
  save() { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(`${this.file}.tmp`, JSON.stringify(this.data), 'utf8'); fs.renameSync(`${this.file}.tmp`, this.file); }
  read(id) {
    const book = this.book(id);
    return { settings: this.data.settings, day: dayKey(), todaySeconds: this.data.days[dayKey()] || 0, book: { listeningSeconds: 0, glossary: [], sessions: [], ...book } };
  }
  narration(id, value) {
    const book = this.book(id);
    if (value === undefined) return book.narration || null;
    if (value !== null && (!validNarration(value) || value.page > (this.library.find(id).totalPages || 100000))) throw new Error('Posição de narração inválida.');
    if (value === null) book.narration = null;
    else {
      const { page, index, paragraph, time, voice } = value;
      book.narration = { page, index, paragraph, time, voice };
    }
    this.save();
    return book.narration;
  }
  glossary(id, value) {
    const book = this.book(id);
    const entries = book.glossary || [];
    if (typeof value === 'string') book.glossary = entries.filter(item => item.id !== value);
    else {
      if (!validGlossary(value) || value.page > (this.library.find(id).totalPages || 100000)) throw new Error('Entrada do glossário inválida.');
      const existing = entries.find(item => item.term === value.term.trim() && item.page === value.page && item.location === value.location && item.source === value.source);
      const { term, meaning, quote, page, location, source } = value;
      book.glossary = [{ id: existing?.id || randomUUID(), term: term.trim(), meaning: meaning.trim(), quote, page, location, source, createdAt: existing?.createdAt || Date.now() }, ...entries.filter(item => item !== existing)].slice(0, 500);
    }
    this.save();
    return this.read(id);
  }
  session(book, value) {
    const sessions = book.sessions ||= [];
    const previous = sessions.find(item => item.id === value.id && item.kind === value.kind);
    const added = Math.max(0, value.seconds - (previous?.seconds || 0));
    if (!added) return 0;
    if (previous) previous.seconds = value.seconds;
    else sessions.unshift({ id: value.id, kind: value.kind, startedAt: value.startedAt, seconds: value.seconds });
    if (sessions.length > 200) sessions.length = 200;
    return added;
  }
  listen(id, value) {
    const book = this.book(id);
    if (!validSession(value) || value.kind !== 'listening') throw new Error('Sessão de escuta inválida.');
    const added = this.session(book, value);
    if (added) { book.listeningSeconds = (book.listeningSeconds || 0) + added; this.save(); }
  }
  settings(value) {
    const result = { ...this.data.settings };
    for (const [key, min, max] of [['goal', 1, 480], ['breakEvery', 5, 180], ['breakDuration', 1, 30], ['wpm', 50, 1000]]) {
      if (!Number.isInteger(value?.[key]) || value[key] < min || value[key] > max) throw new Error('Configuração de leitura inválida.'); result[key] = value[key];
    }
    if (typeof value.reminders !== 'boolean' || typeof value.autoPace !== 'boolean') throw new Error('Configuração inválida.');
    this.data.settings = { ...result, reminders: value.reminders, autoPace: value.autoPace }; this.save(); return this.data.settings;
  }
  tick(id, seconds, sample, session) {
    const book = this.book(id);
    if (!Number.isInteger(seconds) || seconds < 0 || seconds > 30 || seconds === 0 && !sample) throw new Error('Tempo de leitura inválido.');
    if (session && (!validSession(session) || session.kind !== 'reading')) throw new Error('Sessão de leitura inválida.');
    if (session) seconds = this.session(book, session);
    book.seconds += seconds; this.data.days[dayKey()] = (this.data.days[dayKey()] || 0) + seconds;
    if (sample && Number.isFinite(sample.words) && sample.words >= 10 && sample.words <= 10000 && Number.isFinite(sample.seconds) && sample.seconds >= 10 && sample.seconds <= 600 && sample.words / sample.seconds * 60 >= 50 && sample.words / sample.seconds * 60 <= 1000) { book.paceWords += Math.round(sample.words); book.paceSeconds += Math.round(sample.seconds); book.samples++; }
    this.save(); return this.read(id);
  }
  crop(id, value) {
    const book = this.book(id);
    if (this.library.find(id).format === 'epub' || !value || !['top', 'bottom', 'left', 'right'].every(key => Number.isFinite(value[key]) && value[key] >= 0 && value[key] <= .3)) throw new Error('Recorte inválido.');
    book.crop = Object.fromEntries(['top', 'bottom', 'left', 'right'].map(key => [key, value[key]])); this.save(); return this.read(id);
  }
  card(id, value) {
    const book = this.book(id);
    if (typeof value?.front !== 'string' || !value.front.trim() || value.front.length > 2000 || typeof value.back !== 'string' || !value.back.trim() || value.back.length > 12000 || !Number.isInteger(value.page) || value.page < 1 || value.page > this.library.find(id).totalPages || value.location && (typeof value.location !== 'string' || !value.location.startsWith('epubcfi(') || value.location.length > 4000)) throw new Error('Preencha a pergunta e a resposta do cartão.');
    const previous = book.cards.find(card => card.id === value.id);
    if (value.id && !previous) throw new Error('Cartão não encontrado.');
    const card = { id: previous?.id || randomUUID(), front: value.front.trim(), back: value.back.trim(), page: value.page, location: value.location, interval: previous?.interval || 0, reviews: previous?.reviews || 0, due: previous?.due || Date.now(), createdAt: previous?.createdAt || new Date().toISOString() };
    book.cards = [card, ...book.cards.filter(item => item.id !== card.id)]; this.save(); return this.read(id);
  }
  removeCard(id, cardId) { const book = this.book(id); book.cards = book.cards.filter(card => card.id !== cardId); this.save(); return this.read(id); }
  review(id, cardId, grade) {
    const card = this.book(id).cards.find(card => card.id === cardId);
    Object.assign(card, gradeFlashcard(card, grade)); this.save(); return this.read(id);
  }
}
module.exports = { Study, validateStudyExtras, gradeFlashcard };
