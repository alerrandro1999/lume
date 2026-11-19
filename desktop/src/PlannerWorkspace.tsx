import { useEffect, useRef, useState } from 'react';
import { CalendarDays, Check, CheckCheck, ChevronRight, LayoutGrid, List, Moon, Pencil, Plus, Search, Sun, Target } from 'lucide-react';
import type { Theme } from './Hub';
import { Modal } from './ReadingTools';
import { openLessonSource } from './lesson-navigation';
import { dateKey, formatDay, shiftDay, weekStart } from './planner-dates';
import { PlannerCalendar } from './PlannerCalendar';
import { PlannerCourseForm, PlannerGoalForm, PlannerTaskForm } from './PlannerForms';
import { plannerKinds, plannerMaterialEvent, plannerPriorities, type PlannerCourse, type PlannerData, type PlannerMaterialOption, type PlannerTask } from './planner-types';
import './planner.css';

type Scope = 'all' | 'today' | 'week' | 'overdue';
type PlannerDialog = { kind: 'task'; task?: PlannerTask } | { kind: 'course'; course?: PlannerCourse } | { kind: 'goal' };
const scopes: [Scope, string][] = [['all', 'Todas'], ['today', 'Hoje'], ['week', 'Esta semana'], ['overdue', 'Atrasadas']];
const priorityOrder = { high: 0, medium: 1, low: 2 };
const normalize = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('pt-BR');
const explain = (error: unknown) => error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : 'Não foi possível salvar o planejador.';

export function PlannerMark() {
  return <span className="planner-mark" aria-hidden="true"><CalendarDays size={26} strokeWidth={1.7} /></span>;
}

export function PlannerWorkspace({ visible, onOpenHub, theme, toggleTheme }: { visible: boolean; onOpenHub(): void; theme: Theme; toggleTheme(): void }) {
  const api = window.lume?.planner;
  const [data, setData] = useState<PlannerData | null>(null);
  const [materials, setMaterials] = useState<PlannerMaterialOption[]>([]);
  const [today, setToday] = useState(() => dateKey());
  const [selectedDay, setSelectedDay] = useState(() => dateKey());
  const [month, setMonth] = useState(() => dateKey());
  const [view, setView] = useState<'agenda' | 'calendar'>('agenda');
  const [scope, setScope] = useState<Scope>('all');
  const [courseId, setCourseId] = useState('all');
  const [query, setQuery] = useState('');
  const [showCompleted, setShowCompleted] = useState(false);
  const [dialog, setDialog] = useState<PlannerDialog | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const operation = useRef(false);
  const main = useRef<HTMLElement>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!visible || !api) return;
    document.title = 'Planejador Acadêmico';
    let current = true;
    setLoading(true);
    setError('');
    Promise.all([api.read(), api.materials()])
      .then(([planner, sources]) => { if (current) { setData(planner); setMaterials(sources); } })
      .catch(error => { if (current) setError(explain(error)); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [api, visible, reload]);

  useEffect(() => {
    if (!visible) return;
    setToday(dateKey());
    const timer = window.setInterval(() => setToday(dateKey()), 60_000);
    return () => window.clearInterval(timer);
  }, [visible]);

  const tasks = data?.tasks ?? [];
  const courses = data?.courses ?? [];
  const week = weekStart(today);
  const weekEnd = shiftDay(week, 7);
  const weeklyCompleted = tasks.filter(task => task.status === 'done' && task.completedOn >= week && task.completedOn < weekEnd).length;
  const goal = data?.goals[week];
  const pending = tasks.filter(task => task.status === 'pending');
  const overdue = pending.filter(task => task.dueDate && task.dueDate < today).length;
  const dueToday = pending.filter(task => task.dueDate === today).length;
  const thisWeek = pending.filter(task => task.dueDate >= week && task.dueDate < weekEnd).length;
  const normalizedQuery = normalize(query.trim());
  const filtered = tasks.filter(task => (showCompleted || task.status === 'pending') &&
    (courseId === 'all' || task.courseId === courseId) &&
    normalize(`${task.title} ${task.notes}`).includes(normalizedQuery));
  const listed = filtered.filter(task => {
    if (view === 'calendar') return task.dueDate === selectedDay;
    if (scope === 'today') return task.dueDate === today;
    if (scope === 'week') return task.dueDate >= week && task.dueDate < weekEnd;
    if (scope === 'overdue') return task.status === 'pending' && !!task.dueDate && task.dueDate < today;
    return true;
  }).sort((a, b) => Number(a.status === 'done') - Number(b.status === 'done') ||
    (a.dueDate || '9999-99-99').localeCompare(b.dueDate || '9999-99-99') ||
    (a.time || '99:99').localeCompare(b.time || '99:99') ||
    priorityOrder[a.priority] - priorityOrder[b.priority] || a.title.localeCompare(b.title, 'pt-BR'));
  const locked = busy || loading || !data;
  const emptyTitle = tasks.length ? 'Nenhuma atividade neste filtro' : 'Seu semestre começa por aqui';
  const listTitle = view === 'calendar' ? `Atividades de ${formatDay(selectedDay)}` : 'Agenda';

  async function perform(action: () => Promise<PlannerData>, message: string) {
    if (operation.current) return;
    operation.current = true;
    setBusy(true);
    setError('');
    setStatus('');
    try {
      setData(await action());
      setDialog(null);
      setStatus(message);
    } catch (error) { setError(explain(error)); }
    finally { operation.current = false; setBusy(false); }
  }

  function showDialog(next: PlannerDialog) { setError(''); setDialog(next); }
  function closeDialog() { if (!operation.current) { setError(''); setDialog(null); } }
  function selectScope(next: Scope) { setScope(next); setView('agenda'); main.current?.scrollTo(0, 0); }
  function openMaterial(task: PlannerTask) {
    const material = task.material;
    if (!material) return;
    if (material.kind === 'lesson') openLessonSource({ projectId: material.id, startMs: 0 });
    else window.dispatchEvent(new CustomEvent(plannerMaterialEvent, { detail: material }));
  }

  return <div className="planner">
    <header className="planner-header" inert={!!dialog}>
      <button className="hub-return" type="button" onClick={onOpenHub}><LayoutGrid size={15} aria-hidden="true" />Aplicativos</button>
      <span><CalendarDays size={20} aria-hidden="true" />Planejador Acadêmico</span>
      <button className="icon-button planner-theme" type="button" onClick={toggleTheme} aria-label={theme === 'light' ? 'Ativar tema escuro' : 'Ativar tema claro'}>
        {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
      </button>
    </header>
    <div className="planner-layout" inert={!!dialog}>
      <aside className="planner-sidebar">
        <button className="planner-button planner-primary" type="button" disabled={locked} onClick={() => showDialog({ kind: 'task' })}><Plus size={17} aria-hidden="true" />Nova atividade</button>
        <h2>Minhas disciplinas</h2>
        <button className="planner-course-filter" type="button" aria-pressed={courseId === 'all'} onClick={() => setCourseId('all')}>Todas as disciplinas<span>{courses.length}</span></button>
        <ul className="planner-courses">
          {courses.map(course => <li key={course.id}>
            <button type="button" className="planner-course-filter" aria-pressed={courseId === course.id} onClick={() => setCourseId(course.id)} title={course.teacher || undefined}>
              <i className={`planner-color planner-color-${course.color}`} /><span>{course.name}</span>
            </button>
            <button className="icon-button" type="button" aria-label={`Editar disciplina ${course.name}`} disabled={locked} onClick={() => showDialog({ kind: 'course', course })}><Pencil size={13} /></button>
          </li>)}
        </ul>
        <button className="planner-course-filter" type="button" aria-pressed={courseId === ''} onClick={() => setCourseId('')}>Sem disciplina</button>
        <button className="planner-add-course" type="button" disabled={locked} onClick={() => showDialog({ kind: 'course' })}><Plus size={14} aria-hidden="true" />Adicionar disciplina</button>
        <section className="planner-weekly" aria-labelledby="planner-goal-title">
          <Target size={19} aria-hidden="true" />
          <h2 id="planner-goal-title">Meta desta semana</h2>
          <p>{formatDay(week)} a {formatDay(shiftDay(week, 6))}</p>
          {goal ? <>
            <strong>{weeklyCompleted}<small> / {goal}</small></strong>
            <progress value={Math.min(weeklyCompleted, goal)} max={goal} aria-label="Progresso da meta semanal" />
            <p>{weeklyCompleted >= goal ? 'Meta alcançada!' : 'Atividades concluídas na semana'}</p>
          </> : <p>Defina quantas atividades quer concluir.</p>}
          <button className="planner-add-course" type="button" disabled={locked} onClick={() => showDialog({ kind: 'goal' })}>{goal ? 'Ajustar meta' : 'Definir meta'}</button>
        </section>
      </aside>
      <main className="planner-main" ref={main} aria-labelledby="planner-title">
        <div className="planner-main-heading">
          <div><p>{new Date(today + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}</p><h1 id="planner-title">Organize sua semana</h1></div>
          <div className="planner-view-switch" role="group" aria-label="Visualização do planejador">
            <button type="button" aria-pressed={view === 'agenda'} onClick={() => setView('agenda')}><List size={15} aria-hidden="true" />Agenda</button>
            <button type="button" aria-pressed={view === 'calendar'} onClick={() => setView('calendar')}><CalendarDays size={15} aria-hidden="true" />Calendário</button>
          </div>
        </div>
        <div className="planner-metrics">
          <button type="button" onClick={() => selectScope('today')}><span>Para hoje</span><strong>{dueToday}</strong></button>
          <button type="button" onClick={() => selectScope('week')}><span>Pendentes na semana</span><strong>{thisWeek}</strong></button>
          <button type="button" onClick={() => selectScope('overdue')}><span>Atrasadas</span><strong>{overdue}</strong></button>
          <div><span>Concluídas na semana</span><strong>{weeklyCompleted}</strong></div>
        </div>
        {error && !dialog && <p className="planner-error" role="alert">{error}<button className="planner-button" type="button" disabled={busy} onClick={() => setReload(value => value + 1)}>Tentar novamente</button></p>}
        <p className="planner-status" role="status">{loading ? 'Carregando planejador…' : status}</p>
        <div className="planner-controls">
          <div className="planner-scopes" role="group" aria-label="Período da agenda">
            {scopes.map(([id, label]) => <button key={id} type="button" aria-pressed={view === 'agenda' && scope === id} onClick={() => selectScope(id)}>{label}</button>)}
          </div>
          <label className="planner-search"><Search size={15} aria-hidden="true" /><input type="search" aria-label="Buscar atividades" placeholder="Buscar atividades" value={query} onChange={event => setQuery(event.target.value)} /></label>
          <label className="planner-completed"><input type="checkbox" checked={showCompleted} onChange={event => setShowCompleted(event.target.checked)} />Mostrar concluídas</label>
        </div>
        {view === 'calendar' && <PlannerCalendar month={month} selected={selectedDay} today={today} tasks={filtered} changeMonth={setMonth} select={setSelectedDay} />}
        <section className="planner-agenda" aria-labelledby="planner-agenda-title">
          <div className="planner-list-heading"><h2 id="planner-agenda-title">{listTitle}</h2><span>{listed.length} {listed.length === 1 ? 'atividade' : 'atividades'}</span></div>
          {listed.length ? <ul className="planner-task-list">{listed.map(task => {
            const course = courses.find(item => item.id === task.courseId);
            const material = materials.find(item => task.material?.kind === item.kind && task.material.id === item.id);
            const late = task.status !== 'done' && task.dueDate && task.dueDate < today;
            return <li key={task.id} className={task.status === 'done' ? 'planner-task planner-task-done' : 'planner-task'}>
              <button className="planner-check" type="button" role="checkbox" aria-checked={task.status === 'done'} aria-label={`Concluir ${task.title}`} disabled={locked} onClick={() => { if (api) void perform(() => api.completeTask(task.id, task.status !== 'done'), task.status === 'done' ? 'Atividade reaberta.' : 'Atividade concluída.'); }}>
                {task.status === 'done' && <Check size={15} />}
              </button>
              <div className="planner-task-body">
                <button className="planner-task-title" type="button" disabled={locked} onClick={() => showDialog({ kind: 'task', task })}>{task.title}</button>
                <div className="planner-task-meta">
                  <span className={`planner-course-tag planner-color-${course?.color ?? 'sage'}`}>{course?.name ?? 'Sem disciplina'}</span>
                  <span>{plannerKinds[task.kind]}</span>
                  <span className={late ? 'planner-late' : ''}>{task.dueDate ? formatDay(task.dueDate) : 'Sem data'}{task.time ? ` às ${task.time}` : ''}{late ? ' · Atrasada' : ''}</span>
                  <span className={`planner-priority planner-priority-${task.priority}`}>Prioridade {plannerPriorities[task.priority].toLocaleLowerCase('pt-BR')}</span>
                </div>
                {task.notes && <p className="planner-task-notes">{task.notes}</p>}
                {task.material && <button type="button" className="planner-material" disabled={!material || locked} title={material?.title} onClick={() => openMaterial(task)}>{material ? `Abrir material · ${material.title}` : 'Material indisponível'}<ChevronRight size={12} aria-hidden="true" /></button>}
              </div>
              <button className="icon-button" type="button" aria-label={`Editar atividade ${task.title}`} disabled={locked} onClick={() => showDialog({ kind: 'task', task })}><Pencil size={15} /></button>
            </li>;
          })}</ul> : !loading && <div className="planner-empty"><CheckCheck size={30} aria-hidden="true" /><h3>{emptyTitle}</h3><p>{tasks.length ? 'Escolha outro período ou ajuste os filtros.' : 'Adicione uma disciplina e registre sua primeira tarefa, prova ou leitura.'}</p><button className="planner-button" type="button" disabled={locked} onClick={() => showDialog({ kind: 'task' })}><Plus size={15} aria-hidden="true" />Nova atividade</button></div>}
        </section>
      </main>
    </div>
    {api && dialog?.kind === 'task' && <Modal title={dialog.task ? 'Editar atividade' : 'Nova atividade'} close={closeDialog}>
      <PlannerTaskForm task={dialog.task} courses={courses} materials={materials} date={view === 'calendar' ? selectedDay : today} courseId={courseId === 'all' ? '' : courseId} busy={busy} error={error}
        save={value => void perform(() => api.saveTask(dialog.task?.id ?? null, value), 'Atividade salva.')}
        remove={dialog.task ? () => void perform(() => api.removeTask(dialog.task!.id), 'Atividade excluída.') : undefined} />
    </Modal>}
    {api && dialog?.kind === 'course' && <Modal title={dialog.course ? 'Editar disciplina' : 'Nova disciplina'} close={closeDialog}>
      <PlannerCourseForm course={dialog.course} busy={busy} error={error} save={value => void perform(() => api.saveCourse(dialog.course?.id ?? null, value), 'Disciplina salva.')}
        remove={dialog.course ? () => void perform(async () => {
          const next = await api.removeCourse(dialog.course!.id);
          if (courseId === dialog.course!.id) setCourseId('all');
          return next;
        }, 'Disciplina removida. As atividades ficaram em Sem disciplina.') : undefined} />
    </Modal>}
    {api && dialog?.kind === 'goal' && <Modal title="Meta semanal" close={closeDialog}><PlannerGoalForm target={goal ?? 5} busy={busy} error={error} save={target => void perform(() => api.saveGoal(week, target), 'Meta semanal salva.')} /></Modal>}
  </div>;
}
