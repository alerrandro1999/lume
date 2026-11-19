import { useState } from 'react';
import { plannerColors, plannerKinds, plannerPriorities, type PlannerCourse, type PlannerCourseDraft, type PlannerMaterialOption, type PlannerTask, type PlannerTaskDraft } from './planner-types';

const materialLabels = { book: 'Livros', lesson: 'Gravações', review: 'Revisões bibliográficas' };

export function PlannerTaskForm({ task, courses, materials, date, courseId, busy, error, save, remove }: {
  task?: PlannerTask;
  courses: PlannerCourse[];
  materials: PlannerMaterialOption[];
  date: string;
  courseId: string;
  busy: boolean;
  error: string;
  save(value: PlannerTaskDraft): void;
  remove?(): void;
}) {
  const [draft, setDraft] = useState<PlannerTaskDraft>(() => task ? { ...task } : {
    title: '', courseId, kind: 'task', priority: 'medium', dueDate: date, time: '', notes: '', material: null,
  });
  const [deleting, setDeleting] = useState(false);
  const materialKey = draft.material ? `${draft.material.kind}:${draft.material.id}` : '';
  const missing = !!draft.material && !materials.some(item => `${item.kind}:${item.id}` === materialKey);
  function edit<K extends keyof PlannerTaskDraft>(field: K, value: PlannerTaskDraft[K]) { setDraft(previous => ({ ...previous, [field]: value })); }

  return <form className="planner-form" onSubmit={event => { event.preventDefault(); save(draft); }}>
    <fieldset disabled={busy}>
      <label>Título<input maxLength={200} required value={draft.title} onChange={event => edit('title', event.target.value)} placeholder="Ex.: Revisar o capítulo sobre metodologia" /></label>
      <div className="planner-form-pair">
        <label><span id="planner-type-label">Tipo</span><select aria-labelledby="planner-type-label" value={draft.kind} onChange={event => edit('kind', event.target.value as PlannerTaskDraft['kind'])}>
          {Object.entries(plannerKinds).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select></label>
        <label><span id="planner-priority-label">Prioridade</span><select aria-labelledby="planner-priority-label" value={draft.priority} onChange={event => edit('priority', event.target.value as PlannerTaskDraft['priority'])}>
          {Object.entries(plannerPriorities).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select></label>
      </div>
      <label><span id="planner-course-label">Disciplina</span><select aria-labelledby="planner-course-label" value={draft.courseId} onChange={event => edit('courseId', event.target.value)}>
        <option value="">Sem disciplina</option>{courses.map(course => <option key={course.id} value={course.id}>{course.name}</option>)}
      </select></label>
      <div className="planner-form-pair">
        <label>Data<input type="date" min="0001-01-01" max="9999-12-31" value={draft.dueDate} onChange={event => setDraft(previous => ({ ...previous, dueDate: event.target.value, time: event.target.value ? previous.time : '' }))} /></label>
        <label>Horário (opcional)<input type="time" value={draft.time} disabled={!draft.dueDate} onChange={event => edit('time', event.target.value)} /></label>
      </div>
      <label><span id="planner-material-label">Material do hub (opcional)</span><select aria-labelledby="planner-material-label" value={materialKey} onChange={event => {
        const chosen = materials.find(item => `${item.kind}:${item.id}` === event.target.value);
        edit('material', chosen ? { kind: chosen.kind, id: chosen.id } : null);
      }}>
        <option value="">Sem material vinculado</option>
        {missing && <option value={materialKey}>Material indisponível</option>}
        {(['book', 'lesson', 'review'] as const).map(kind => <optgroup key={kind} label={materialLabels[kind]}>
          {materials.filter(item => item.kind === kind).map(item => <option key={item.id} value={`${item.kind}:${item.id}`}>{item.title}</option>)}
        </optgroup>)}
      </select></label>
      <label>Notas<textarea rows={3} maxLength={6000} value={draft.notes} onChange={event => edit('notes', event.target.value)} /></label>
    </fieldset>
    {error && <p className="planner-error" role="alert">{error}</p>}
    <div className="planner-form-actions">
      {!!remove && !deleting && <button className="planner-button planner-danger" type="button" disabled={busy} onClick={() => setDeleting(true)}>Excluir atividade</button>}
      <button className="planner-button planner-primary" type="submit" disabled={busy || !draft.title.trim()}>{busy ? 'Salvando…' : 'Salvar atividade'}</button>
    </div>
    {deleting && <div className="planner-confirm"><p>Excluir esta atividade do planejador?</p><div>
      <button className="planner-button" type="button" disabled={busy} onClick={() => setDeleting(false)}>Voltar</button>
      <button className="planner-button planner-danger" type="button" disabled={busy} onClick={remove}>Confirmar exclusão</button>
    </div></div>}
  </form>;
}

export function PlannerCourseForm({ course, busy, error, save, remove }: {
  course?: PlannerCourse; busy: boolean; error: string;
  save(value: PlannerCourseDraft): void; remove?(): void;
}) {
  const [draft, setDraft] = useState<PlannerCourseDraft>(course ?? { name: '', teacher: '', color: 'sage' });
  const [deleting, setDeleting] = useState(false);
  return <form className="planner-form" onSubmit={event => { event.preventDefault(); save(draft); }}>
    <fieldset disabled={busy}>
      <label>Nome da disciplina<input required maxLength={120} value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} placeholder="Ex.: Metodologia científica" /></label>
      <label>Docente (opcional)<input maxLength={120} value={draft.teacher} onChange={event => setDraft({ ...draft, teacher: event.target.value })} /></label>
      <label><span id="planner-color-label">Cor</span><select aria-labelledby="planner-color-label" value={draft.color} onChange={event => setDraft({ ...draft, color: event.target.value as PlannerCourseDraft['color'] })}>
        {Object.entries(plannerColors).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
      </select></label>
    </fieldset>
    {error && <p className="planner-error" role="alert">{error}</p>}
    <div className="planner-form-actions">
      {!!remove && !deleting && <button className="planner-button planner-danger" type="button" disabled={busy} onClick={() => setDeleting(true)}>Remover disciplina</button>}
      <button className="planner-button planner-primary" type="submit" disabled={busy || !draft.name.trim()}>{busy ? 'Salvando…' : 'Salvar disciplina'}</button>
    </div>
    {deleting && <div className="planner-confirm"><p>As atividades desta disciplina ficarão em Sem disciplina. Confirma a remoção?</p><div>
      <button className="planner-button" type="button" disabled={busy} onClick={() => setDeleting(false)}>Voltar</button>
      <button className="planner-button planner-danger" type="button" disabled={busy} onClick={remove}>Confirmar remoção</button>
    </div></div>}
  </form>;
}

export function PlannerGoalForm({ target, busy, error, save }: { target: number; busy: boolean; error: string; save(target: number): void }) {
  const [value, setValue] = useState(String(target));
  return <form className="planner-form" onSubmit={event => { event.preventDefault(); save(Number(value)); }}>
    <p>Quantas atividades você quer concluir nesta semana? Cada atividade concluída conta uma vez, incluindo as que foram criadas em outras semanas.</p>
    <label>Atividades por semana<input type="number" min={1} max={999} step={1} required value={value} disabled={busy} onChange={event => setValue(event.target.value)} /></label>
    {error && <p className="planner-error" role="alert">{error}</p>}
    <button className="planner-button planner-primary" type="submit" disabled={busy}>Salvar meta</button>
  </form>;
}
