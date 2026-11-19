const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { gradeFlashcard } = require('./study.cjs');

const normalize = value => value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('pt-BR');
const tidy = value => value.trim().replace(/\s+/g, ' ');
const time = ms => {
  const seconds = Math.floor(ms / 1000);
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map(part => String(part).padStart(2, '0')).join(':');
};

class TranscriptionStudy {
  constructor(directory) {
    this.file = path.join(directory, 'study.json');
    this.data = { glossaries: [], cards: [] };
    try {
      const stored = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (Array.isArray(stored.glossaries) && Array.isArray(stored.cards)) this.data = stored;
    } catch (error) { if (error.code !== 'ENOENT') console.warn('Não foi possível ler os dados de estudo do Estúdio.'); }
  }

  save(update) {
    const next = { ...this.data, ...update };
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(`${this.file}.tmp`, JSON.stringify(next), 'utf8');
    fs.renameSync(`${this.file}.tmp`, this.file);
    this.data = next;
  }

  terms(course) {
    if (typeof course !== 'string' || !course.trim()) return [];
    return this.data.glossaries.find(item => normalize(item.course) === normalize(course))?.terms ?? [];
  }

  glossary(course, text) {
    if (typeof course !== 'string' || !course.trim() || course.length > 80 || typeof text !== 'string' || text.length > 4000) throw new Error('Glossário inválido.');
    const terms = [...new Set(text.split(/[,;\r\n]/).map(tidy).filter(Boolean))];
    if (terms.length > 80 || terms.some(term => term.length > 100)) throw new Error('Use até 80 termos de no máximo 100 caracteres cada.');
    const glossaries = this.data.glossaries.filter(item => normalize(item.course) !== normalize(course));
    if (terms.length) glossaries.push({ course, terms });
    this.save({ glossaries });
    return terms;
  }

  cards() { return this.data.cards; }

  card(project, mark, value) {
    if (typeof value?.front !== 'string' || !value.front.trim() || value.front.length > 2000 || typeof value.back !== 'string' || !value.back.trim() || value.back.length > 5000) throw new Error('Preencha a pergunta e a resposta do cartão.');
    if (this.data.cards.length >= 5000) throw new Error('Limite de cartões de aula atingido.');
    const card = { id: randomUUID(), projectId: project.id, lesson: project.name, course: project.course || '', startMs: mark.startMs,
      front: value.front.trim(), back: value.back.trim(), interval: 0, reviews: 0, due: Date.now() };
    this.save({ cards: [card, ...this.data.cards] });
    return card;
  }

  revise(id, grade) {
    const revised = gradeFlashcard(this.data.cards.find(card => card.id === id), grade);
    this.save({ cards: this.data.cards.map(card => card.id === id ? revised : card) });
    return this.cards();
  }

  remove(id) {
    this.save({ cards: this.data.cards.filter(card => card.id !== id) });
    return this.cards();
  }

  anki() {
    if (!this.data.cards.length) throw new Error('Crie um cartão de aula para exportar.');
    const encode = value => `"${value.replace(/"/g, '""')}"`;
    return ['#separator:Tab', '#html:false', '#columns:Frente\tVerso', ...this.data.cards.map(card =>
      [encode(card.front), encode(`${card.back}\n\nFonte: ${card.lesson} · ${time(card.startMs)}`)].join('\t'))].join('\r\n') + '\r\n';
  }
}

module.exports = { TranscriptionStudy, normalize, tidy };
