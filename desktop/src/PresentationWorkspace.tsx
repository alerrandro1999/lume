import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Clock3, History, LayoutGrid, Mic, Moon, Pause, Pencil, Play, Plus, Presentation, Square, Sun } from 'lucide-react';
import type { Theme } from './Hub';
import { Modal } from './ReadingTools';
import { PresentationForm } from './PresentationForms';
import { PresentationReview } from './PresentationReview';
import { presentationError, usePresentationSession } from './usePresentationSession';
import { presentationTime, type PresentationDraft, type PresentationProject } from './presentation-types';
import './presentation.css';
import { researchSourceEvent, type ResearchSource } from './research-types';

export function PresentationMark() {
  return <span className="presentation-mark" aria-hidden="true"><Presentation size={27} strokeWidth={1.6} /></span>;
}

export function PresentationWorkspace({ visible, activate, onOpenHub, theme, toggleTheme }: { visible: boolean; activate(): void; onOpenHub(): void; theme: Theme; toggleTheme(): void }) {
  const api = window.lume.presentations;
  const [projects, setProjects] = useState<PresentationProject[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [selected, setSelected] = useState('');
  const [tab, setTab] = useState<'script' | 'history'>('script');
  const [selectedTake, setSelectedTake] = useState('');
  const [dialog, setDialog] = useState<{ project?: PresentationProject } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [audio, setAudio] = useState(false);
  const session = usePresentationSession(api, visible, (next, takeId) => {
    setProjects(next); setSelectedTake(takeId); setTab('history'); setStatus('Ensaio salvo. Ouça e registre sua autoavaliação.');
  });
  const project = projects.find(item => item.id === selected) ?? projects[0];
  const view = session.view;
  const locked = !!view || session.preparing || busy;
  const takes = project?.takes.filter(take => take.status === 'finished' || take.status === 'interrupted') ?? [];
  const take = takes.find(item => item.id === selectedTake) ?? takes[0];
  const script = view?.take.script ?? project;
  const planned = script?.sections.reduce((sum, section) => sum + section.seconds * 1000, 0) ?? 0;
  useEffect(() => {
    const receive = (event: Event) => {
      const source = (event as CustomEvent<ResearchSource>).detail;
      if (source.kind !== 'presentation') return;
      activate();
      if (view || session.preparing || dialog) { setError('Finalize o ensaio ou feche o diálogo aberto antes de trocar de apresentação.'); return; }
      void action(async () => { const next = await api.list(); if (!next.some(item => item.id === source.id)) throw new Error('Apresentação não encontrada.'); setProjects(next); setSelected(source.id); setSelectedTake(''); setTab('script'); setLoaded(true); });
    };
    window.addEventListener(researchSourceEvent, receive);
    return () => window.removeEventListener(researchSourceEvent, receive);
  });

  useEffect(() => {
    if (!visible) return;
    document.title = 'Treino de Apresentação';
    if (loaded) return;
    let live = true;
    void api.list().then(next => { if (live) { setProjects(next); setLoaded(true); setError(''); } }).catch(error => { if (live) setError(presentationError(error)); });
    return () => { live = false; };
  }, [visible, loaded, api]);

  async function action(work: () => Promise<void>) {
    if (busy) return false;
    setBusy(true); setError(''); setStatus('');
    try { await work(); return true; } catch (error) { setError(presentationError(error)); return false; }
    finally { setBusy(false); }
  }
  function openForm(value: { project?: PresentationProject }) { setError(''); setStatus(''); setDialog(value); }
  function save(draft: PresentationDraft) {
    void action(async () => {
      const next = await api.save(dialog?.project?.id ?? null, draft);
      const id = dialog?.project?.id ?? next.find(item => !projects.some(previous => previous.id === item.id))?.id;
      setProjects(next); setSelected(id ?? ''); setDialog(null); setTab('script'); setStatus('Roteiro salvo.');
    });
  }
  function exportFile(format: 'audio' | 'report') {
    if (!take) return;
    void action(async () => { const file = await api.export(take.id, format); if (file) setStatus(format === 'audio' ? 'Áudio exportado.' : 'Relatório exportado.'); });
  }

  return <div className="presentation-workspace">
    <div inert={dialog !== null} className="presentation-shell">
      <header className="presentation-header"><button className="hub-return" onClick={onOpenHub}><LayoutGrid size={15} />Aplicativos</button><span><Presentation size={18} />Treino de Apresentação</span><button className="icon-button" onClick={toggleTheme} aria-label={theme === 'light' ? 'Ativar tema escuro' : 'Ativar tema claro'}>{theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}</button></header>
      <div className="presentation-layout"><aside className="presentation-sidebar" aria-label="Suas apresentações"><button className="presentation-button presentation-primary" disabled={locked || !loaded} onClick={() => openForm({})}><Plus size={16} />Nova apresentação</button><h2>Seus roteiros <span>{projects.length}</span></h2><ul>{projects.map(item => <li key={item.id}><button className="presentation-project" aria-pressed={project?.id === item.id} disabled={locked} onClick={() => { setSelected(item.id); setTab('script'); setSelectedTake(''); setStatus(''); session.clearError(); }}><span>{item.title}</span><small>{item.course || 'Apresentação livre'} · {item.takes.filter(take => ['finished', 'interrupted'].includes(take.status)).length} ensaio(s)</small></button></li>)}</ul><div className="presentation-sidebar-tip"><Mic size={19} /><p>Pratique no seu ritmo.</p><span>Roteiro, tempos e gravações ficam salvos neste computador.</span></div></aside>
        <main className="presentation-main">
          {!dialog && (error || session.error) && <p className="presentation-error" role="alert">{error || session.error}</p>}
          <p className="presentation-status" role="status">{session.preparing ? 'Preparando seu ensaio…' : status}</p>
          {!project ? <div className="presentation-empty"><span><Presentation size={38} strokeWidth={1.4} /></span><p>Seminários, trabalhos e TCC</p><h1>Mais confiança para apresentar</h1><div>Prepare seu roteiro, ensaie com cronômetro e ouça sua apresentação para descobrir o que pode melhorar.</div><button className="presentation-button presentation-primary" disabled={!loaded} onClick={() => openForm({})}><Plus size={16} />Criar minha primeira apresentação</button><small>{loaded ? 'Comece pelo tema e pelo tempo de cada tópico.' : error ? 'Não foi possível carregar seus roteiros.' : 'Carregando seus roteiros…'}</small></div> : <>
            <div className="presentation-title"><div><p>{project.course || 'Seu espaço de prática'}</p><h1>{project.title}</h1>{project.audience && <span>{project.audience}</span>}</div><button className="presentation-button" disabled={locked} onClick={() => openForm({ project })}><Pencil size={14} />Editar roteiro</button></div>
            {!view && <nav className="presentation-tabs" aria-label="Área da apresentação"><button aria-pressed={tab === 'script'} disabled={session.preparing} onClick={() => { setTab('script'); setStatus(''); }}><Presentation size={16} />Roteiro e ensaio</button><button aria-pressed={tab === 'history'} disabled={session.preparing} onClick={() => { setTab('history'); setStatus(''); }}><History size={16} />Histórico <span>{takes.length}</span></button></nav>}
            {view && script ? <div className="presentation-rehearsal">
              <section className={`presentation-clock ${view.clock.durationMs > planned ? 'is-overtime' : ''}`} aria-label="Cronômetro do ensaio"><span className="presentation-live"><i className={view.phase === 'running' ? 'running' : ''} />{view.phase === 'running' ? view.take.audio ? 'Ensaio com áudio' : 'Ensaio em andamento' : view.phase === 'saving' ? 'Salvando ensaio…' : 'Ensaio pausado'}</span><strong data-testid="presentation-clock">{presentationTime(view.clock.durationMs)}</strong><p>de {presentationTime(planned)} previstos {view.clock.durationMs > planned && '· Tempo previsto ultrapassado'}</p><progress max={planned} value={Math.min(planned, view.clock.durationMs)} aria-label="Tempo total utilizado" /><div className="presentation-clock-actions"><button className="presentation-button" disabled={view.phase === 'saving' || (view.phase === 'paused' && !view.canResume)} onClick={() => void session.pause(view.phase === 'running')}>{view.phase === 'running' ? <Pause size={16} /> : <Play size={16} />}{view.phase === 'running' ? 'Pausar ensaio' : 'Retomar ensaio'}</button><button className="presentation-button presentation-primary" disabled={view.phase === 'saving'} onClick={() => void session.finish()}><Square size={13} />Finalizar e salvar</button></div><small>Ao voltar aos aplicativos, o ensaio será pausado.</small></section>
              <section className="presentation-current"><div className="presentation-eyebrow">Tópico {view.clock.section + 1} de {script.sections.length}<span>{presentationTime(view.clock.sectionMs[view.clock.section])} / {presentationTime(script.sections[view.clock.section].seconds * 1000)}</span></div><h2>{script.sections[view.clock.section].title}</h2><div className="presentation-speaker-notes">{script.sections[view.clock.section].notes || 'Use este momento para desenvolver as ideias deste tópico.'}</div><div className="presentation-section-navigation"><button className="presentation-button" disabled={view.clock.section === 0 || view.phase === 'saving'} onClick={() => void session.selectSection(view.clock.section - 1)}><ArrowLeft size={15} />Anterior</button><button className="presentation-button" disabled={view.clock.section === script.sections.length - 1 || view.phase === 'saving'} onClick={() => void session.selectSection(view.clock.section + 1)}>Próximo tópico<ArrowRight size={15} /></button></div></section>
              <ol className="presentation-section-list">{script.sections.map((section, index) => <li key={index}><button aria-current={view.clock.section === index ? 'step' : undefined} disabled={view.phase === 'saving'} onClick={() => void session.selectSection(index)}><span>{index + 1}</span><strong>{section.title}</strong><small>{presentationTime(view.clock.sectionMs[index])} / {presentationTime(section.seconds * 1000)}</small></button></li>)}</ol>
            </div> : tab === 'script' ? <div className="presentation-setup"><section className="presentation-script"><div className="presentation-outline-heading"><h2>Seu roteiro</h2><span><Clock3 size={14} />{presentationTime(planned)} previstos</span></div><ol>{project.sections.map((section, index) => <li key={index}><span className="presentation-step-number">{index + 1}</span><div><h3>{section.title}</h3>{section.notes && <p>{section.notes}</p>}</div><small>{presentationTime(section.seconds * 1000)}</small></li>)}</ol></section><section className="presentation-start"><span className="presentation-start-icon"><Mic size={24} strokeWidth={1.5} /></span><h2>Hora de praticar</h2><p>Acompanhe o roteiro e avance pelos tópicos enquanto apresenta.</p><label className="presentation-audio-option"><input type="checkbox" checked={audio} disabled={locked} onChange={event => setAudio(event.target.checked)} /><span>Gravar áudio do ensaio</span></label><small>{audio ? 'O microfone será ativado ao iniciar. A gravação fica salva com o ensaio.' : 'O ensaio registrará os tempos de cada tópico.'}</small><button className="presentation-button presentation-primary" disabled={locked} onClick={() => { setStatus(''); void session.start(project, audio); }}><Play size={16} />{session.preparing ? 'Preparando…' : 'Iniciar ensaio'}</button>{takes.length > 0 && <p className="presentation-start-count"><Check size={14} />{takes.length} ensaio(s) registrado(s)</p>}</section></div> : <div className="presentation-history">
              {!take ? <div className="presentation-empty-history"><History size={28} /><h2>Seu primeiro ensaio começa no roteiro</h2><p>Os tempos, gravações e autoavaliações aparecerão aqui.</p><button className="presentation-button" onClick={() => setTab('script')}>Ir para o roteiro</button></div> : <><div className="presentation-take-list" aria-label="Ensaios anteriores">{takes.map((item, index) => <button className="presentation-take" key={item.id} disabled={busy} aria-pressed={take.id === item.id} onClick={() => { setSelectedTake(item.id); setStatus(''); }}><strong>Ensaio {takes.length - index}</strong><span>{new Date(item.createdAt).toLocaleDateString('pt-BR')} · {new Date(item.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span><small>{presentationTime(item.durationMs)} · {item.audioUrl ? 'Com áudio' : 'Sem áudio'}</small></button>)}</div><PresentationReview key={take.id} take={take} busy={busy} assess={value => action(async () => { setProjects(await api.assess(take.id, value)); })} remove={() => void action(async () => { setProjects(await api.removeTake(take.id)); setSelectedTake(''); setStatus('Ensaio excluído.'); })} exportFile={exportFile} /></>}
            </div>}
          </>}
        </main>
      </div>
    </div>
    {dialog && <Modal title={dialog.project ? 'Editar apresentação' : 'Nova apresentação'} close={() => { if (!busy) { setDialog(null); setError(''); } }}><PresentationForm project={dialog.project} busy={busy} error={error} save={save} remove={dialog.project ? () => void action(async () => { setProjects(await api.remove(dialog.project!.id)); setSelected(''); setDialog(null); setTab('script'); setStatus('Apresentação excluída.'); }) : undefined} /></Modal>}
  </div>;
}
