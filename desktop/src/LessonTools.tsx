import { useEffect, useMemo, useState } from 'react';
import { Play } from 'lucide-react';
import { audioTime } from './audio-time';
import { lessonError } from './LessonCards';
import { Modal } from './ReadingTools';
import type { LessonSearchHit, LessonSource, TranscriptionProject, TranscriptionSegment } from './types';

const words = /\p{L}[\p{L}\p{M}\p{N}-]*/gu;
const normalize = (text: string) => text.toLocaleLowerCase('pt-BR').normalize('NFD').replace(/\p{M}/gu, '');
const common = new Set('ainda agora aqui assim aquela aquele aqueles aquilo antes aula baixo bastante bem cada coisa como consigo depois dessa desse desta deste dois elas eles entao essa esse esta estas este estes estava foram gente isso mais mesmo muita muito nessa neste onde outra outro para pelas pelos pode porque quando quanto quem quero saber sendo segue seja seria sobre temos tenha tenho tinha toda todo todos vamos voce voces that this from have will about what which then into were they when with where their there those these your them make went'.split(' '));

const topicWords = (text: string) => [...text.matchAll(words)].filter(match => match[0].length >= 4 && !common.has(normalize(match[0])));

function materialFor(project: TranscriptionProject) {
  const segments = project.segments.filter(segment => segment.text.trim());
  const tokens = segments.map(segment => topicWords(segment.text));
  const frequency = new Map<string, number>();
  for (const terms of tokens) for (const key of new Set(terms.map(match => normalize(match[0])))) frequency.set(key, (frequency.get(key) ?? 0) + 1);
  const score = (text: string) => 1 + Math.log(frequency.get(normalize(text)) ?? 1);
  const important = new Set(project.marks.filter(mark => mark.category === 'important').map(mark => mark.startMs));
  const choices = segments.map((segment, index) => {
    const terms = tokens[index];
    const unique = new Set(terms.map(match => normalize(match[0])));
    const weight = [...unique].reduce((sum, term) => sum + score(term), 0) / Math.sqrt(Math.max(1, unique.size));
    return { segment, terms, weight: weight + (important.has(segment.startMs) ? 3 : 0) };
  });
  const groupSize = Math.max(1, Math.ceil(choices.length / Math.min(5, Math.max(1, Math.ceil(choices.length / 4)))));
  const used = new Set<string>();
  const topics: { title: string; source: TranscriptionSegment }[] = [];
  const questions: { prompt: string; answer: string; source: TranscriptionSegment }[] = [];
  const asked = new Set<string>();
  for (let index = 0; index < choices.length; index += groupSize) {
    const group = choices.slice(index, index + groupSize).sort((a, b) => b.weight - a.weight);
    const best = group[0];
    const ranked = [...best.terms].sort((a, b) => score(b[0]) - score(a[0]) || b[0].length - a[0].length);
    const topic = ranked.find(match => !used.has(normalize(match[0])));
    const title = topic ? topic[0][0].toLocaleUpperCase('pt-BR') + topic[0].slice(1) : `Trecho ${topics.length + 1}`;
    if (topic) used.add(normalize(topic[0]));
    topics.push({ title, source: best.segment });
    for (const choice of group) {
      if (questions.length >= 8 || choice.segment.text.length > 650 || choice.segment.text.split(/\s+/).length < 4) continue;
      const keywords = [...choice.terms].sort((a, b) => score(b[0]) - score(a[0]) || b[0].length - a[0].length);
      const keyword = keywords.find(match => !asked.has(normalize(match[0])) && choice.terms.filter(term => normalize(term[0]) === normalize(match[0])).length === 1);
      if (!keyword) continue;
      asked.add(normalize(keyword[0]));
      const position = keyword.index ?? 0;
      questions.push({ source: choice.segment, answer: keyword[0], prompt: `${choice.segment.text.slice(0, position)}____${choice.segment.text.slice(position + keyword[0].length)}` });
      if (questions.length >= topics.length * 2) break;
    }
  }
  return { topics, questions: questions.sort((a, b) => a.source.startMs - b.source.startMs) };
}

function LessonQuestion({ question, number, play }: { question: ReturnType<typeof materialFor>['questions'][number]; number: number; play(startMs: number, endMs: number): void }) {
  const [guess, setGuess] = useState('');
  const [revealed, setRevealed] = useState(false);
  const { source } = question;
  const correct = normalize(guess.trim()) === normalize(question.answer);
  return <li className="lesson-topic">
    <strong>Complete o trecho {number}</strong>
    <p>{question.prompt}</p>
    <form className="lesson-inline-form" onSubmit={event => { event.preventDefault(); setRevealed(true); }}>
      <label>Sua resposta <input value={guess} maxLength={120} onChange={event => { setGuess(event.target.value); setRevealed(false); }} /></label>
      <button type="submit" className="studio-button">{guess.trim() ? 'Conferir resposta' : 'Mostrar resposta'}</button>
    </form>
    {revealed && <p role="status">{correct ? 'Correto.' : 'Resposta:'} <strong>{question.answer}</strong></p>}
    <button type="button" className="studio-time" onClick={() => play(source.startMs, source.endMs)}><Play size={13} aria-hidden="true" />Ouvir fonte em {audioTime(source.startMs / 1000)}</button>
  </li>;
}

export function LessonMaterial({ project, play }: { project: TranscriptionProject; play(startMs: number, endMs: number): void }) {
  const material = useMemo(() => materialFor(project), [project]);
  return <div className="lesson-material">
    <section aria-label="Resumo por tópicos">
      <h3>Resumo por tópicos</h3>
      <p className="study-help">Trechos selecionados da transcrição, com o ponto de origem no áudio.</p>
      {!material.topics.length && <p>Adicione texto à transcrição para ver o resumo.</p>}
      <ul className="lesson-topics">{material.topics.map(({ title, source }) => <li className="lesson-topic" key={source.startMs + title}>
        <strong>{title}</strong><p>{source.text}</p>
        <button type="button" className="studio-time" onClick={() => play(source.startMs, source.endMs)}><Play size={13} aria-hidden="true" />Ouvir fonte em {audioTime(source.startMs / 1000)}</button>
      </li>)}</ul>
    </section>
    <section aria-label="Perguntas de revisão">
      <h3>Perguntas de revisão</h3>
      {!material.questions.length && <p>A transcrição ainda tem poucos trechos para gerar perguntas.</p>}
      <ol className="lesson-topics">{material.questions.map((question, index) => <LessonQuestion key={`${question.source.startMs}-${question.answer}`} question={question} number={index + 1} play={play} />)}</ol>
    </section>
  </div>;
}

export function LessonSearch({ courses, defaultCourse, close, open }: { courses: string[]; defaultCourse: string; close(): void; open(source: LessonSource): void }) {
  const [query, setQuery] = useState('');
  const [course, setCourse] = useState(defaultCourse);
  const [results, setResults] = useState<LessonSearchHit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function search() {
    setBusy(true);
    setError('');
    try { setResults(await window.lume.transcriptionSearch(query, course)); }
    catch (error) { setError(lessonError(error)); }
    finally { setBusy(false); }
  }
  return <Modal title="Buscar nas aulas" close={() => { if (!busy) close(); }}>
    <form className="study-form" onSubmit={event => { event.preventDefault(); void search(); }}>
      <label>Buscar nas transcrições<input type="search" value={query} onChange={event => { setQuery(event.target.value); setResults(null); }} maxLength={200} disabled={busy} required /></label>
      <label>Disciplina da busca<select value={course} onChange={event => { setCourse(event.target.value); setResults(null); }} disabled={busy}>
        <option value="">Todas as disciplinas</option>{courses.map(name => <option key={name}>{name}</option>)}
      </select></label>
      <button type="submit" className="primary-button" disabled={busy || !query.trim()}>Buscar</button>
    </form>
    {error && <p role="alert" className="study-error">{error}</p>}
    {results && <p role="status" className="study-help">{results.length ? `${results.length === 150 ? 'Primeiros ' : ''}${results.length} ${results.length === 1 ? 'trecho encontrado' : 'trechos encontrados'}` : 'Nenhum trecho encontrado.'}</p>}
    {!!results?.length && <ul className="lesson-topics">{results.map((hit, index) => <li className="lesson-topic" key={`${hit.projectId}-${hit.startMs}-${index}`}>
      <strong>{hit.lesson}</strong>{hit.course && <small> · {hit.course}</small>}<p>{hit.text}</p>
      <button type="button" className="secondary-button" onClick={() => { close(); open(hit); }}>Abrir trecho em {audioTime(hit.startMs / 1000)}</button>
    </li>)}</ul>}
  </Modal>;
}

export function LessonCourse({ project, courses, close, update }: { project: TranscriptionProject; courses: string[]; close(): void; update(next: TranscriptionProject): void }) {
  const [course, setCourse] = useState(project.course);
  const [terms, setTerms] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setTerms(null);
    window.lume.transcriptionGlossary(project.id).then(items => { if (active) setTerms(items.join('\n')); }).catch(error => { if (active) setError(lessonError(error)); });
    return () => { active = false; };
  }, [project.id, project.course]);
  async function perform(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    setStatus('');
    try { await action(); }
    catch (error) { setError(lessonError(error)); }
    finally { setBusy(false); }
  }
  return <Modal title="Disciplina e glossário" close={() => { if (!busy) close(); }}>
    <form className="study-form" onSubmit={event => { event.preventDefault(); void perform(async () => {
      const next = await window.lume.transcriptionOrganize(project.id, course);
      setCourse(next.course);
      update(next);
      setStatus('Disciplina salva.');
    }); }}>
      <label>Disciplina da aula<input value={course} onChange={event => setCourse(event.target.value)} list="lume-lesson-courses" maxLength={80} disabled={busy} /></label>
      <datalist id="lume-lesson-courses">{courses.map(name => <option value={name} key={name} />)}</datalist>
      <button type="submit" className="primary-button" disabled={busy || course === project.course}>Salvar disciplina</button>
    </form>
    {project.course && <form className="study-form" onSubmit={event => { event.preventDefault(); void perform(async () => {
      const next = await window.lume.transcriptionSaveGlossary(project.id, terms ?? '');
      setTerms(next.join('\n'));
      setStatus('Glossário salvo.');
    }); }}>
      <h3>Glossário de {project.course}</h3>
      <p className="study-help">Um termo por linha. O Estúdio usa o glossário nas próximas transcrições desta disciplina.</p>
      <label>Termos técnicos<textarea value={terms ?? ''} rows={5} maxLength={4000} disabled={busy || terms === null} onChange={event => setTerms(event.target.value)} /></label>
      <button type="submit" className="secondary-button" disabled={busy || terms === null}>Salvar glossário</button>
    </form>}
    {status && <p role="status" className="study-success">{status}</p>}
    {error && <p role="alert" className="study-error">{error}</p>}
  </Modal>;
}
