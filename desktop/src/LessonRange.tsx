import { useEffect, useState } from 'react';
import { audioTime } from './audio-time';
import { lessonError } from './LessonCards';
import { Modal } from './ReadingTools';
import type { TranscriptionLanguage, TranscriptionProgress, TranscriptionProject, TranscriptionQuality, TranscriptionSuggestion } from './types';

export function LessonRange({ project, first, language, quality, close, saved, play, pause }: {
  project: TranscriptionProject; first: number; language: TranscriptionLanguage; quality: TranscriptionQuality;
  close(): void; saved(next: TranscriptionProject): void; play(startMs: number, endMs: number, rate: number): void; pause(): void;
}) {
  const [last, setLast] = useState(first);
  const [suggestion, setSuggestion] = useState<TranscriptionSuggestion | null>(null);
  const [progress, setProgress] = useState<TranscriptionProgress | null>(null);
  const [busy, setBusy] = useState<'retry' | 'save' | null>(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const startMs = project.segments[first].startMs;
  const selected = project.segments.slice(first, last + 1);
  const endMs = Math.max(...selected.map(item => item.endMs));
  const remaining = project.segments.slice(first);
  const limit = remaining.findIndex(segment => segment.endMs - startMs > 180000);
  const choices = limit === -1 ? remaining : remaining.slice(0, limit);
  useEffect(() => window.lume.onTranscriptionProgress(value => { if (value.id === project.id) setProgress(value); }), [project.id]);

  async function run(operation: 'retry' | 'save', action: () => Promise<void>) {
    setBusy(operation);
    setError('');
    setStatus('');
    try { await action(); }
    catch (error) { setError(lessonError(error)); }
    finally { setBusy(null); setProgress(null); }
  }

  return <Modal title="Corrigir intervalo" close={() => { if (!busy) { pause(); close(); } }}>
    <div className="study-form">
      <p>Início em {audioTime(startMs / 1000)}. Escolha o último trecho do intervalo, com até 3 minutos.</p>
      <label>Último trecho do intervalo<select value={last} disabled={!!busy} onChange={event => {
        setLast(Number(event.target.value)); setSuggestion(null); setStatus(''); setError('');
      }}>
        {choices.map((item, index) => <option key={first + index} value={first + index}>{audioTime(item.endMs / 1000)} · {item.text.slice(0, 75) || 'Trecho sem texto'}</option>)}
      </select></label>
      <div className="study-actions">
        <button type="button" className="secondary-button" onClick={() => play(startMs, endMs, 0.75)}>Ouvir em 0,75×</button>
        <button type="button" className="secondary-button" onClick={pause}>Pausar</button>
      </div>
      <p className="lesson-original"><strong>Texto atual</strong> {selected.map(item => item.text).join(' ')}</p>
      <div className="study-actions">
        <button type="button" className="primary-button" disabled={!!busy || !choices.length} onClick={() => void run('retry', async () => {
          setSuggestion(null);
          const next = await window.lume.transcriptionRetryRange(project.id, language, quality, { first, last });
          setSuggestion(next);
          setStatus(next ? 'Sugestão pronta para revisão.' : 'Transcrição do intervalo cancelada.');
        })}>Retranscrever intervalo</button>
        {busy === 'retry' && <button type="button" className="secondary-button" onClick={() => void window.lume.transcriptionCancel(project.id).catch(error => setError(lessonError(error)))}>Cancelar transcrição</button>}
      </div>
      {busy === 'retry' && <p role="status">{progress?.phase === 'transcribing' ? `Transcrevendo intervalo… ${progress.percent}%` : 'Preparando o intervalo…'}</p>}
      {status && <p className="study-success" role="status">{status}</p>}
      {error && <p className="study-error" role="alert">{error}</p>}
      {suggestion && <>
        <h3>Sugestão para o intervalo</h3>
        {suggestion.segments.map((segment, index) => <label key={index}>Sugestão do trecho {index + 1} · {audioTime(segment.startMs / 1000)}
          <textarea autoFocus={index === 0} rows={2} value={segment.text} maxLength={5000} disabled={!!busy} onChange={event => {
            const text = event.target.value;
            setSuggestion({ ...suggestion, segments: suggestion.segments.map((item, position) => position === index ? { ...item, text } : item) });
          }} />
        </label>)}
        <button type="button" className="primary-button" disabled={!!busy || !suggestion.segments.some(segment => segment.text.trim())} onClick={() => void run('save', async () => {
          const next = await window.lume.transcriptionApplyRange(project.id, suggestion);
          pause();
          saved(next);
        })}>Aplicar correção</button>
      </>}
    </div>
  </Modal>;
}
