import { useEffect, useState } from 'react';
import { audioTime } from './audio-time';
import { openLessonSource } from './lesson-navigation';
import { Modal } from './ReadingTools';
import type { LessonCard, LessonCardInput, LessonGrade, TranscriptionMark } from './types';

export const lessonError = (error: unknown) => error instanceof Error
  ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
  : 'Não foi possível concluir a operação.';

const grades: [LessonGrade, string][] = [['again', 'Repetir'], ['hard', 'Difícil'], ['good', 'Bom'], ['easy', 'Fácil']];

export function LessonCardEditor({ projectId, mark, close, saved }: { projectId: string; mark: TranscriptionMark; close(): void; saved(): void }) {
  const [value, setValue] = useState<LessonCardInput>({ front: '', back: mark.text || mark.note });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function save() {
    setBusy(true);
    setError('');
    try { await window.lume.transcriptionMakeCard(projectId, mark.id, value); saved(); }
    catch (error) { setError(lessonError(error)); }
    finally { setBusy(false); }
  }
  return <Modal title="Criar cartão de aula" close={() => { if (!busy) close(); }}>
    <form className="study-form" onSubmit={event => { event.preventDefault(); void save(); }}>
      <p>Fonte no áudio em {audioTime(mark.startMs / 1000)}.</p>
      <label>Pergunta<textarea value={value.front} onChange={event => setValue({ ...value, front: event.target.value })} maxLength={2000} rows={2} required disabled={busy} /></label>
      <label>Resposta<textarea value={value.back} onChange={event => setValue({ ...value, back: event.target.value })} maxLength={5000} rows={3} required disabled={busy} /></label>
      {error && <p className="study-error" role="alert">{error}</p>}
      <button type="submit" className="primary-button" disabled={busy || !value.front.trim() || !value.back.trim()}>Salvar cartão</button>
    </form>
  </Modal>;
}

export function LessonCards({ close }: { close(): void }) {
  const [cards, setCards] = useState<LessonCard[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  useEffect(() => {
    let active = true;
    window.lume.transcriptionCards().then(items => { if (active) setCards(items); }).catch(error => { if (active) setError(lessonError(error)); });
    return () => { active = false; };
  }, []);
  const due = cards?.filter(card => card.due <= Date.now()).sort((a, b) => a.due - b.due) ?? [];
  const current = cards?.find(card => card.id === selected) ?? due[0];

  async function perform(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError('');
    setStatus('');
    try { await action(); }
    catch (error) { setError(lessonError(error)); }
    finally { setBusy(false); }
  }

  return <Modal title="Cartões de aulas" close={() => { if (!busy) close(); }}>
    {error && <p className="study-error" role="alert">{error}</p>}
    {status && <p className="study-success" role="status">{status}</p>}
    {!cards && !error && <p role="status">Carregando cartões…</p>}
    {cards?.length === 0 && <p>Crie um cartão a partir de uma marcação no Estúdio de Transcrição.</p>}
    {!!cards?.length && <>
      <div className="study-actions">
        <button type="button" className="secondary-button" disabled={busy} onClick={() => void perform(async () => {
          if (await window.lume.transcriptionExportAnki()) setStatus('Cartões exportados para o Anki.');
        })}>Exportar para Anki</button>
      </div>
      <p className="study-help">{due.length ? `${due.length} ${due.length === 1 ? 'cartão para revisar' : 'cartões para revisar'}` : 'Revisões em dia.'}</p>
      {current && <article className="flashcard-review" key={current.id}>
        <small>{[current.course, current.lesson, audioTime(current.startMs / 1000)].filter(Boolean).join(' · ')}</small>
        <h4>{current.front}</h4>
        {revealed ? <>
          <p className="card-answer">{current.back}</p>
          <div className="review-grades">{grades.map(([id, label]) => <button key={id} type="button" disabled={busy} onClick={() => void perform(async () => {
            setCards(await window.lume.transcriptionReviewCard(current.id, id));
            setSelected(null);
            setRevealed(false);
            setStatus('Revisão salva.');
          })}>{label}</button>)}</div>
        </> : <button type="button" className="primary-button" onClick={() => setRevealed(true)}>Mostrar resposta</button>}
        <div className="study-actions">
          {current.available && <button type="button" className="inline-action" disabled={busy} onClick={() => { close(); openLessonSource(current); }}>Ouvir trecho de origem</button>}
          <button type="button" className="inline-action" disabled={busy} onClick={() => void perform(async () => {
            setCards(await window.lume.transcriptionRemoveCard(current.id));
            setSelected(null);
            setRevealed(false);
            setStatus('Cartão excluído.');
          })}>Excluir cartão</button>
        </div>
      </article>}
      <details className="lesson-card-list">
        <summary>Todos os cartões ({cards.length})</summary>
        <ul>{cards.map(card => <li key={card.id}><button type="button" className="inline-action" disabled={busy} onClick={() => { setSelected(card.id); setRevealed(false); }}>
          {card.front} <small>· {card.course || card.lesson}</small>
        </button></li>)}</ul>
      </details>
    </>}
  </Modal>;
}
