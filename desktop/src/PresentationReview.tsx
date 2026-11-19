import { useState } from 'react';
import { CheckCircle2, Download, Headphones, LoaderCircle, Trash2 } from 'lucide-react';
import { assessmentLabels, presentationTime, type PresentationAssessment, type PresentationTake } from './presentation-types';

export function PresentationReview({ take, busy, assess, remove, exportFile }: {
  take: PresentationTake; busy: boolean;
  assess(value: PresentationAssessment): Promise<boolean>; remove(): void; exportFile(format: 'audio' | 'report'): void;
}) {
  const [draft, setDraft] = useState({ ...take.assessment });
  const [deleting, setDeleting] = useState(false);
  const [feedback, setFeedback] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  function change(patch: Partial<PresentationAssessment>) {
    setDraft(previous => ({ ...previous, ...patch }));
    setFeedback('idle');
  }
  async function saveAssessment() {
    if (busy || feedback === 'saving') return;
    setFeedback('saving');
    const saved = await assess(draft);
    setFeedback(saved ? 'saved' : 'error');
  }
  const planned = take.script.sections.reduce((sum, section) => sum + section.seconds * 1000, 0);
  const notesId = `presentation-assessment-notes-${take.id}`;
  return <div className="presentation-review">
    <div className="presentation-review-heading"><div><p>Ensaio de {new Date(take.createdAt).toLocaleString('pt-BR')}</p><h2>Reveja sua apresentação</h2></div><span className="presentation-badge">{take.status === 'interrupted' ? 'Interrompido' : 'Finalizado'}</span></div>
    <div className="presentation-summary"><div><span>Tempo realizado</span><strong>{presentationTime(take.durationMs)}</strong></div><div><span>Tempo previsto</span><strong>{presentationTime(planned)}</strong></div><div><span>Diferença</span><strong>{take.durationMs > planned ? '+' : '−'}{presentationTime(Math.abs(take.durationMs - planned))}</strong></div></div>
    {take.status === 'interrupted' && <p className="presentation-help">O aplicativo foi interrompido durante este ensaio. Os tempos e o áudio disponíveis foram recuperados até o último registro.</p>}
    {take.audioUrl ? <section className="presentation-recording"><h3><Headphones size={17} />Ouça seu ensaio</h3><audio controls preload="metadata" src={take.audioUrl} aria-label="Áudio do ensaio" /></section> : <p className="presentation-help">{take.audio ? 'Nenhum trecho de áudio foi recuperado neste ensaio.' : 'Este ensaio foi realizado sem gravação de áudio.'}</p>}
    <section className="presentation-timing"><h3>Tempo por tópico</h3><p className="presentation-help">Roteiro utilizado neste ensaio: {take.script.title}</p><table><thead><tr><th>Tópico</th><th>Previsto</th><th>Realizado</th></tr></thead><tbody>{take.script.sections.map((section, index) => <tr key={index}><td><strong>{section.title}</strong>{section.notes && <p>{section.notes}</p>}</td><td>{presentationTime(section.seconds * 1000)}</td><td className={take.sectionMs[index] > section.seconds * 1000 ? 'presentation-overtime' : ''}>{presentationTime(take.sectionMs[index])}</td></tr>)}</tbody></table></section>
    <form className="presentation-assessment" onSubmit={event => { event.preventDefault(); void saveAssessment(); }}><h3>Como você avalia este ensaio?</h3><p className="presentation-help">Dê notas de 1 (preciso praticar) a 5 (estou confiante). A avaliação é feita por você.</p><fieldset disabled={busy || feedback === 'saving'}><div className="presentation-rating-grid">{Object.entries(assessmentLabels).map(([key, label]) => <div key={key}><label htmlFor={`presentation-rating-${key}`}>{label}</label><select id={`presentation-rating-${key}`} value={draft[key as keyof typeof assessmentLabels]} onChange={event => change({ [key]: Number(event.target.value) })}><option value={0}>Sem avaliar</option>{[1, 2, 3, 4, 5].map(value => <option key={value} value={value}>{value} / 5</option>)}</select></div>)}</div><label htmlFor={notesId}>O que melhorar no próximo ensaio</label><textarea id={notesId} rows={3} maxLength={6000} value={draft.notes} onChange={event => change({ notes: event.target.value })} placeholder="Ex.: Reduzir a introdução e explicar melhor os resultados." /><button type="submit" className="presentation-button presentation-primary">{feedback === 'saving' && <LoaderCircle size={15} className="presentation-saving-icon" aria-hidden="true" />}{feedback === 'saving' ? 'Salvando…' : 'Salvar autoavaliação'}</button></fieldset><div className="presentation-assessment-feedback" aria-live="polite" aria-atomic="true">{feedback === 'saved' && <p className="presentation-assessment-success"><CheckCircle2 size={18} aria-hidden="true" />Autoavaliação salva com sucesso.</p>}{feedback === 'error' && <p className="presentation-error">Não foi possível salvar a autoavaliação. Tente novamente.</p>}</div></form>
    <div className="presentation-export"><button disabled={busy} className="presentation-button" onClick={() => exportFile('report')}><Download size={15} />Exportar relatório</button>{take.audioUrl && <button disabled={busy} className="presentation-button" onClick={() => exportFile('audio')}><Download size={15} />Exportar áudio</button>}<button disabled={busy} className="presentation-button presentation-danger" onClick={() => setDeleting(true)}><Trash2 size={14} />Excluir ensaio</button></div>
    {deleting && <div className="presentation-confirm"><p>Excluir este ensaio e seu áudio? O roteiro da apresentação será mantido.</p><div><button className="presentation-button" disabled={busy} onClick={() => setDeleting(false)}>Voltar</button><button className="presentation-button presentation-danger" disabled={busy} onClick={remove}>Confirmar exclusão do ensaio</button></div></div>}
  </div>;
}
