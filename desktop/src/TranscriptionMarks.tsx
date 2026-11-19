import { BookOpen, Pencil, Play, Trash2 } from 'lucide-react';
import { audioTime } from './audio-time';
import type { TranscriptionMark, TranscriptionMarkCategory, TranscriptionMarkInput } from './types';

const labels: Record<TranscriptionMarkCategory, string> = { important: 'Importante', question: 'Dúvida', example: 'Exemplo' };

export function MarkEditor({ value, busy, change, save, cancel }: {
  value: TranscriptionMarkInput; busy: boolean;
  change(value: TranscriptionMarkInput): void; save(): void; cancel(): void;
}) {
  return <form className="studio-mark-editor" onSubmit={event => { event.preventDefault(); save(); }}>
    <label>Categoria
      <select autoFocus value={value.category} disabled={busy} onChange={event => change({ ...value, category: event.target.value as TranscriptionMarkCategory })}>
        {Object.entries(labels).map(([id, label]) => <option value={id} key={id}>{label}</option>)}
      </select>
    </label>
    <label>Nota (opcional)
      <textarea rows={2} maxLength={2000} value={value.note} disabled={busy} onChange={event => change({ ...value, note: event.target.value })} />
    </label>
    <div className="studio-mark-actions">
      <button type="button" className="studio-button" disabled={busy} onClick={cancel}>Cancelar</button>
      <button type="submit" className="studio-button studio-primary" disabled={busy}>Salvar marcação</button>
    </div>
  </form>;
}

export function ReviewMarks({ marks, draft, busy, change, save, cancel, edit, remove, play, card }: {
  marks: TranscriptionMark[]; draft: { id: string | null; value: TranscriptionMarkInput } | null; busy: boolean;
  change(value: TranscriptionMarkInput): void; save(): void; cancel(): void;
  edit(mark: TranscriptionMark): void; remove(id: string): void; play(startMs: number, endMs: number): void; card(mark: TranscriptionMark): void;
}) {
  if (!marks.length) return <p className="studio-review-empty">Nenhum trecho para revisar. Use o marcador ao lado de um trecho da transcrição para salvá-lo aqui.</p>;

  return <ul className="studio-review" aria-label="Marcações da aula">
    {marks.map((mark, index) => {
      const time = audioTime(mark.startMs / 1000);
      return <li className="studio-review-item" key={mark.id}>
        <button type="button" className="studio-time" aria-label={`Ouvir marcação ${index + 1} em ${time}`} onClick={() => play(mark.startMs, mark.endMs)}>
          <Play size={13} aria-hidden="true" />{time}
        </button>
        <div className="studio-review-body">
          <span className={`studio-mark-label studio-mark-label-${mark.category}`}>{labels[mark.category]}</span>
          <blockquote>{mark.text || 'Trecho sem texto'}</blockquote>
          {draft?.id === mark.id
            ? <MarkEditor value={draft.value} busy={busy} change={change} save={save} cancel={cancel} />
            : mark.note && <p className="studio-review-note">{mark.note}</p>}
        </div>
        {draft?.id !== mark.id && <div className="studio-row-actions">
          <button type="button" className="icon-button" aria-label={`Criar cartão da marcação ${index + 1}`} title="Criar cartão" disabled={busy || !!draft} onClick={() => card(mark)}><BookOpen size={16} /></button>
          <button type="button" className="icon-button" id={`studio-note-${mark.id}`} aria-label={`Editar marcação ${index + 1}`} title="Editar marcação" disabled={busy || !!draft} onClick={() => edit(mark)}><Pencil size={16} /></button>
          <button type="button" className="icon-button" aria-label={`Excluir marcação ${index + 1}`} title="Excluir marcação" disabled={busy || !!draft} onClick={() => remove(mark.id)}><Trash2 size={16} /></button>
        </div>}
      </li>;
    })}
  </ul>;
}
