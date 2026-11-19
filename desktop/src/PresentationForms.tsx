import { useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import type { PresentationDraft, PresentationProject, PresentationSection } from './presentation-types';

const initialSections: PresentationSection[] = [
  { title: 'Abertura', notes: '', seconds: 60 },
  { title: 'Desenvolvimento', notes: '', seconds: 420 },
  { title: 'Encerramento', notes: '', seconds: 120 },
];

export function PresentationForm({ project, busy, error, save, remove }: {
  project?: PresentationProject; busy: boolean; error: string;
  save(value: PresentationDraft): void; remove?(): void;
}) {
  const [draft, setDraft] = useState<PresentationDraft>(() => project ? { ...project, sections: project.sections.map(section => ({ ...section })) } : { title: '', course: '', audience: '', sections: initialSections.map(section => ({ ...section })) });
  const [deleting, setDeleting] = useState(false);
  function section(index: number, patch: Partial<PresentationSection>) {
    setDraft(previous => ({ ...previous, sections: previous.sections.map((section, position) => position === index ? { ...section, ...patch } : section) }));
  }
  function move(index: number, delta: number) {
    const sections = [...draft.sections];
    [sections[index], sections[index + delta]] = [sections[index + delta], sections[index]];
    setDraft({ ...draft, sections });
  }
  const target = draft.sections.reduce((sum, section) => sum + section.seconds, 0) / 60;

  return <form className="presentation-form" onSubmit={event => { event.preventDefault(); save(draft); }}>
    <fieldset disabled={busy}>
      <label>Título da apresentação<input required maxLength={200} value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} placeholder="Ex.: Seminário de metodologia" /></label>
      <div className="presentation-form-pair">
        <label>Disciplina (opcional)<input maxLength={150} value={draft.course} onChange={event => setDraft({ ...draft, course: event.target.value })} /></label>
        <label>Público (opcional)<input maxLength={300} value={draft.audience} onChange={event => setDraft({ ...draft, audience: event.target.value })} placeholder="Ex.: Turma do 3º semestre" /></label>
      </div>
      <div className="presentation-outline-heading"><h3>Roteiro</h3><span>{target.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} min previstos</span></div>
      <div className="presentation-outline-form">
        {draft.sections.map((item, index) => <section key={index} aria-label={`Tópico ${index + 1}`}>
          <div className="presentation-section-inputs">
            <label>Título do tópico {index + 1}<input required maxLength={150} value={item.title} onChange={event => section(index, { title: event.target.value })} /></label>
            <label>Minutos do tópico {index + 1}<input type="number" min={0.5} max={1440} step={0.5} required value={item.seconds / 60 || ''} onChange={event => section(index, { seconds: Math.round(Number(event.target.value) * 60) })} /></label>
          </div>
          <div className="presentation-notes-input"><label htmlFor={`presentation-section-notes-${index}`}>Notas do tópico {index + 1}</label><textarea id={`presentation-section-notes-${index}`} rows={2} maxLength={20000} value={item.notes} onChange={event => section(index, { notes: event.target.value })} placeholder="Ideias principais e pontos que precisa lembrar." /></div>
          <div className="presentation-outline-controls">
            <button className="icon-button" type="button" aria-label={`Subir tópico ${index + 1}`} disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp size={14} /></button>
            <button className="icon-button" type="button" aria-label={`Descer tópico ${index + 1}`} disabled={index === draft.sections.length - 1} onClick={() => move(index, 1)}><ArrowDown size={14} /></button>
            <button className="icon-button" type="button" aria-label={`Remover tópico ${index + 1}`} disabled={draft.sections.length === 1} onClick={() => setDraft({ ...draft, sections: draft.sections.filter((_, position) => position !== index) })}><Trash2 size={14} /></button>
          </div>
        </section>)}
      </div>
      <button className="presentation-button" type="button" disabled={draft.sections.length >= 100} onClick={() => setDraft({ ...draft, sections: [...draft.sections, { title: '', notes: '', seconds: 60 }] })}><Plus size={15} aria-hidden="true" />Adicionar tópico</button>
    </fieldset>
    {error && <p className="presentation-error" role="alert">{error}</p>}
    <div className="presentation-form-actions">
      {remove && !deleting && <button className="presentation-button presentation-danger" type="button" disabled={busy} onClick={() => setDeleting(true)}>Excluir apresentação</button>}
      <button className="presentation-button presentation-primary" type="submit" disabled={busy || !draft.title.trim()}>Salvar roteiro</button>
    </div>
    {deleting && <div className="presentation-confirm"><p>Excluir esta apresentação, seus ensaios e os áudios gravados?</p><div><button className="presentation-button" type="button" disabled={busy} onClick={() => setDeleting(false)}>Voltar</button><button className="presentation-button presentation-danger" type="button" disabled={busy} onClick={remove}>Confirmar exclusão</button></div></div>}
  </form>;
}
