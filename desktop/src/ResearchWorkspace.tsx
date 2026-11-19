import { useEffect, useRef, useState } from 'react';
import { BookOpen, CalendarDays, CheckCircle2, ChevronDown, Download, Flag, FolderKanban, GraduationCap, LayoutDashboard, LayoutGrid, ListChecks, MessageSquareText, Moon, NotebookPen, Paperclip, Plus, Settings2, Sun, X } from 'lucide-react';
import type { Theme } from './Hub';
import { Modal } from './ReadingTools';
import { plannerMaterialEvent } from './planner-types';
import { openLessonSource } from './lesson-navigation';
import { dateKey } from './planner-dates';
import { ResearchMaterialForm, ResearchMeetingForm, ResearchPlanForm, ResearchProjectForm, ResearchStageForm, ResearchTaskForm } from './ResearchForms';
import { ResearchBoard } from './ResearchBoard';
import { ResearchMaterials, ResearchMeetings, ResearchOverview, ResearchStages } from './ResearchViews';
import { researchSourceEvent, researchStates, researchTypes, type ResearchMaterial, type ResearchMeeting, type ResearchPlan, type ResearchProject, type ResearchSourceOption, type ResearchStage, type ResearchSummary, type ResearchTask } from './research-types';
import './research.css';
import { portfolioProjectEvent } from './portfolio-types';

type Tab = 'overview' | 'tasks' | 'stages' | 'meetings' | 'materials' | 'plan';
type Dialog = { kind: 'create' | 'settings' | 'stage' | 'task' | 'meeting' | 'hub' | 'link'; stage?: ResearchStage; task?: ResearchTask; meeting?: ResearchMeeting } | { kind: 'remove-material'; material: ResearchMaterial };
const tabs = [{ id: 'overview', label: 'Visão geral', Icon: LayoutDashboard }, { id: 'tasks', label: 'Tarefas', Icon: ListChecks }, { id: 'stages', label: 'Etapas', Icon: Flag }, { id: 'meetings', label: 'Orientações', Icon: MessageSquareText }, { id: 'materials', label: 'Materiais', Icon: Paperclip }, { id: 'plan', label: 'Plano do projeto', Icon: NotebookPen }] as const;
const explain = (error: unknown) => error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : 'Não foi possível concluir esta ação.';
const summary = (project: ResearchProject): ResearchSummary => ({ id: project.id, title: project.title, type: project.type, status: project.status, deadline: project.deadline, updatedAt: project.updatedAt, tasks: project.tasks.length, done: project.tasks.filter(task => task.status === 'done').length });
export function ResearchMark() { return <span className="research-mark" aria-hidden="true"><GraduationCap size={28} strokeWidth={1.6} /></span>; }

export function ResearchWorkspace({ visible, activate, onOpenHub, theme, toggleTheme }: { visible: boolean; activate(): void; onOpenHub(): void; theme: Theme; toggleTheme(): void }) {
  const api = window.lume.research;
  const [projects, setProjects] = useState<ResearchSummary[]>([]);
  const [project, setProject] = useState<ResearchProject | null>(null);
  const selected = useRef('');
  const [tab, setTab] = useState<Tab>('overview');
  const [loaded, setLoaded] = useState(false), [loading, setLoading] = useState(false), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [status, setStatus] = useState('');
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [sources, setSources] = useState<ResearchSourceOption[]>([]), [sourceError, setSourceError] = useState('');
  const [exportsOpen, setExportsOpen] = useState(false);
  const operation = useRef(false), scroll = useRef<HTMLElement>(null);
  const planDrafts = useRef(new Map<string, ResearchPlan>());
  const [today, setToday] = useState(dateKey);
  useEffect(() => { if (!visible) return; setToday(dateKey()); const timer = window.setInterval(() => setToday(dateKey()), 60000); return () => window.clearInterval(timer); }, [visible]);
  function apply(next: ResearchProject) { setProject(next); selected.current = next.id; const item = summary(next); setProjects(previous => [item, ...previous.filter(item => item.id !== next.id)]); }
  useEffect(() => {
    const receive = (event: Event) => { const id = (event as CustomEvent<string>).detail; if (!dialog) selected.current = id; activate(); if (dialog) { setError('Feche o diálogo aberto antes de trocar de projeto.'); return; } void perform(async () => { apply(await api.open(id)); setTab('overview'); setLoaded(true); }); };
    window.addEventListener(portfolioProjectEvent, receive); return () => window.removeEventListener(portfolioProjectEvent, receive);
  });
  useEffect(() => {
    if (!visible) return;
    document.title = 'Organizador de TCC e Projetos';
    let live = true; setLoading(true);
    void api.list().then(async items => { const id = items.some(item => item.id === selected.current) ? selected.current : items[0]?.id; const next = id ? await api.open(id) : null; if (live) { setProjects(items); setProject(next); selected.current = next?.id ?? ''; setLoaded(true); setError(''); } }).catch(error => { if (live) setError(explain(error)); }).finally(() => { if (live) setLoading(false); });
    void api.sources().then(items => { if (live) { setSources(items); setSourceError(''); } }).catch(error => { if (live) setSourceError(explain(error)); });
    return () => { live = false; };
  }, [visible, api]);
  function changeTab(next: Tab) { setTab(next); setStatus(''); setExportsOpen(false); scroll.current?.scrollTo(0, 0); }
  function show(next: Dialog) { setError(''); setStatus(''); setDialog(next); setExportsOpen(false); }
  async function perform(work: () => Promise<void>, message = '') {
    if (operation.current) return false;
    operation.current = true; setBusy(true); setError(''); setStatus(''); setExportsOpen(false);
    try { await work(); if (message) setStatus(message); return true; } catch (error) { setError(explain(error)); return false; }
    finally { operation.current = false; setBusy(false); }
  }
  function save(work: () => Promise<ResearchProject>, message: string) { return perform(async () => { apply(await work()); setDialog(null); }, message); }
  function selectProject(id: string) { void perform(async () => { apply(await api.open(id)); changeTab('overview'); }); }
  function openMaterial(item: ResearchMaterial) {
    if (!project) return;
    void perform(async () => {
      const source = await api.openMaterial(project.id, item.id);
      if (!source) { setStatus('Material aberto.'); return; }
      if (source.kind === 'lesson') openLessonSource({ projectId: source.id, startMs: 0 });
      else if (source.kind === 'book' || source.kind === 'review') window.dispatchEvent(new CustomEvent(plannerMaterialEvent, { detail: source }));
      else window.dispatchEvent(new CustomEvent(researchSourceEvent, { detail: source }));
    });
  }
  const locked = busy || loading || !loaded;
  const title = dialog?.kind === 'create' ? 'Novo projeto' : dialog?.kind === 'settings' ? 'Configurações do projeto' : dialog?.kind === 'task' ? dialog.task ? 'Editar tarefa do projeto' : 'Nova tarefa do projeto' : dialog?.kind === 'stage' ? dialog.stage ? 'Editar etapa' : 'Nova etapa' : dialog?.kind === 'meeting' ? dialog.meeting ? 'Editar orientação' : 'Registrar orientação' : dialog?.kind === 'hub' ? 'Vincular material do hub' : dialog?.kind === 'link' ? 'Adicionar link ao projeto' : 'Remover material';
  return <div className="research-workspace"><div className="research-shell" inert={!!dialog || busy || loading}><header className="research-header"><button className="hub-return" onClick={onOpenHub}><LayoutGrid size={15} />Aplicativos</button><span><GraduationCap size={19} />Organizador de TCC e Projetos</span><button className="research-icon-button" aria-label={theme === 'light' ? 'Ativar tema escuro' : 'Ativar tema claro'} onClick={toggleTheme}>{theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}</button></header><div className="research-layout"><aside className="research-sidebar"><button className="research-button research-primary" disabled={locked} onClick={() => show({ kind: 'create' })}><Plus size={16} />Novo projeto</button><div className="research-sidebar-label"><span>Meus projetos</span><small>{projects.length}</small></div><ul>{projects.map(item => <li key={item.id}><button aria-pressed={project?.id === item.id} disabled={locked} onClick={() => selectProject(item.id)}><span className="research-project-type">{researchTypes[item.type]}</span><strong>{item.title}</strong><small>{researchStates[item.status]}</small>{item.tasks > 0 && <progress aria-label={`Progresso de ${item.title}`} max={item.tasks} value={item.done} />}</button></li>)}</ul><div className="research-sidebar-tip"><FolderKanban size={23} strokeWidth={1.5} /><strong>Um passo de cada vez.</strong><p>Organize o trabalho, acompanhe as decisões e mantenha a próxima entrega à vista.</p></div></aside><div className="research-content">{!dialog && error && <p className="research-error" role="alert">{error}</p>}{project ? <><div className="research-project-heading"><div><span className="research-eyebrow">{researchTypes[project.type]}{project.course ? ' · ' + project.course : ''}</span><h1>{project.title}</h1><p><span className={`research-project-status research-project-status-${project.status}`}>{researchStates[project.status]}</span>{project.deadline && <span><CalendarDays size={12} />Entrega em {new Date(project.deadline + 'T12:00:00').toLocaleDateString('pt-BR')}</span>}</p></div><div className="research-heading-actions"><button className="research-icon-button" aria-label="Configurações do projeto" onClick={() => show({ kind: 'settings' })}><Settings2 size={17} /></button><div className="research-export"><button className="research-button" aria-expanded={exportsOpen} onClick={() => setExportsOpen(value => !value)}><Download size={14} />Exportar<ChevronDown size={12} /></button>{exportsOpen && <div><button onClick={() => void perform(async () => { if (await api.export(project.id, 'md')) setStatus('Relatório do projeto exportado.'); })}>Relatório Markdown</button><button onClick={() => void perform(async () => { if (await api.export(project.id, 'csv')) setStatus('Tarefas exportadas em CSV.'); })}>Tarefas CSV</button><button onClick={() => setExportsOpen(false)}>Fechar opções</button></div>}</div></div></div><nav className="research-tabs" aria-label="Áreas do projeto">{tabs.map(({ id, label, Icon }) => <button key={id} aria-pressed={tab === id} onClick={() => changeTab(id)}><Icon size={15} />{label}{id === 'tasks' && <small>{project.tasks.length}</small>}</button>)}</nav><main ref={scroll} className="research-main">
      {tab === 'overview' && <ResearchOverview project={project} today={today} task={task => show({ kind: 'task', task })} stage={stage => show({ kind: 'stage', stage })} meeting={meeting => show({ kind: 'meeting', meeting })} settings={() => show({ kind: 'settings' })} plan={() => changeTab('plan')} createTask={() => show({ kind: 'task' })} />}
      {tab === 'tasks' && <ResearchBoard key={project.id} project={project} busy={busy} edit={task => show({ kind: 'task', task })} create={() => show({ kind: 'task' })} move={(id, status) => void save(() => api.move(project.id, id, status), 'Situação da tarefa atualizada.')} />}
      {tab === 'stages' && <ResearchStages project={project} busy={busy} create={() => show({ kind: 'stage' })} edit={stage => show({ kind: 'stage', stage })} status={(stage, status) => void save(() => api.stage(project.id, stage.id, { ...stage, status }), 'Etapa atualizada.')} />}
      {tab === 'meetings' && <ResearchMeetings project={project} create={() => show({ kind: 'meeting' })} edit={meeting => show({ kind: 'meeting', meeting })} />}
      {tab === 'materials' && <ResearchMaterials project={project} hub={() => show({ kind: 'hub' })} link={() => show({ kind: 'link' })} files={() => void perform(async () => { const result = await api.files(project.id); if (result) { apply(result.project); if (result.added) setStatus(`${result.added} arquivo(s) adicionado(s) ao projeto.`); if (result.errors.length) setError(result.errors.map(item => `${item.name}: ${item.detail}`).join('\n')); } })} open={openMaterial} remove={material => show({ kind: 'remove-material', material })} />}
      {tab === 'plan' && <ResearchPlanForm key={project.id} project={project} initial={planDrafts.current.get(project.id)} busy={busy} dirty={value => { planDrafts.current.set(project.id, value); setStatus(''); }} save={async value => { const success = await save(() => api.plan(project.id, value), 'Plano do projeto salvo com sucesso.'); if (success) planDrafts.current.delete(project.id); return success; }} />}
    </main></> : <main className="research-welcome"><ResearchMark /><span className="research-eyebrow">Da primeira ideia à entrega</span><h1>Um projeto grande.<br />Passos que cabem no seu dia.</h1><p>Planeje o TCC, organize as etapas de uma pesquisa e transforme orientações em ações.</p><button className="research-button research-primary" disabled={locked} onClick={() => show({ kind: 'create' })}><Plus size={16} />Criar meu primeiro projeto</button><small>{loaded ? 'TCC, pesquisa, extensão ou um projeto da sua equipe.' : 'Carregando seus projetos…'}</small></main>}</div></div></div>
    <div className="research-toast" role="status" aria-live="polite" aria-atomic="true">{status && <><CheckCircle2 size={18} /><span>{status}</span><button aria-label="Fechar confirmação" onClick={() => setStatus('')}><X size={14} /></button></>}</div>
    {dialog && <Modal title={title} close={() => { if (!operation.current) { setDialog(null); setError(''); } }}>
      {dialog.kind === 'create' && <ResearchProjectForm busy={busy} error={error} save={value => void save(async () => { const next = await api.create(value); setTab('overview'); return next; }, 'Projeto criado com sucesso.')} />}
      {dialog.kind === 'settings' && project && <ResearchProjectForm project={project} busy={busy} error={error} save={value => void save(() => api.settings(project.id, value), 'Projeto atualizado.')} remove={() => void perform(async () => { const next = await api.remove(project.id); planDrafts.current.delete(project.id); setProjects(next); const first = next[0] ? await api.open(next[0].id) : null; setProject(first); selected.current = first?.id ?? ''; setDialog(null); setTab('overview'); }, 'Projeto excluído.')} />}
      {dialog.kind === 'task' && project && <ResearchTaskForm project={project} task={dialog.task} busy={busy} error={error} save={value => void save(() => api.task(project.id, dialog.task?.id ?? null, value), 'Tarefa salva com sucesso.')} remove={dialog.task ? () => void save(() => api.removeTask(project.id, dialog.task!.id), 'Tarefa excluída.') : undefined} />}
      {dialog.kind === 'stage' && project && <ResearchStageForm stage={dialog.stage} busy={busy} error={error} save={value => void save(() => api.stage(project.id, dialog.stage?.id ?? null, value), 'Etapa salva com sucesso.')} remove={dialog.stage ? () => void save(() => api.removeStage(project.id, dialog.stage!.id), 'Etapa excluída. As tarefas foram mantidas.') : undefined} />}
      {dialog.kind === 'meeting' && project && <ResearchMeetingForm project={project} meeting={dialog.meeting} busy={busy} error={error} save={(value, createTasks) => void save(() => api.meeting(project.id, dialog.meeting?.id ?? null, value, createTasks), 'Orientação salva com sucesso.')} remove={dialog.meeting ? () => void save(() => api.removeMeeting(project.id, dialog.meeting!.id), 'Orientação excluída. As tarefas foram mantidas.') : undefined} />}
      {(dialog.kind === 'hub' || dialog.kind === 'link') && project && <>{dialog.kind === 'hub' && sourceError && <p className="research-error">{sourceError}</p>}<ResearchMaterialForm mode={dialog.kind} sources={sources} busy={busy} error={error} save={value => void save(() => api.material(project.id, value), 'Material adicionado ao projeto.')} /></>}
      {dialog.kind === 'remove-material' && project && <div className="research-remove-material"><p>Remover “{dialog.material.title}” do projeto?{dialog.material.kind === 'file' ? ' A cópia adicionada ao aplicativo será excluída.' : ''}</p>{error && <p className="research-error" role="alert">{error}</p>}<button className="research-button research-danger" disabled={busy} onClick={() => void save(() => api.removeMaterial(project.id, dialog.material.id), 'Material removido do projeto.')}>Remover material</button></div>}
    </Modal>}
  </div>;
}
