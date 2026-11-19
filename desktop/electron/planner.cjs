const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const kinds = ['task', 'exam', 'assignment', 'reading', 'review'];
const priorities = ['high', 'medium', 'low'];
const colors = ['sage', 'amber', 'blue', 'purple', 'rose'];

function text(value, limit, required = false) {
  if (typeof value !== 'string' || value.length > limit || value.includes('\0')) throw new Error('Confira os campos do planejador.');
  const result = value.trim();
  if (required && !result) throw new Error('Informe um título.');
  return result;
}

function date(value, optional = false) {
  if (value === '' && optional) return '';
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Informe uma data válida.');
  const parsed = new Date(value + 'T12:00:00Z');
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new Error('Informe uma data válida.');
  return value;
}

function courseDraft(value) {
  if (!colors.includes(value?.color)) throw new Error('Selecione uma cor para a disciplina.');
  return { name: text(value.name, 120, true), teacher: text(value.teacher, 120), color: value.color };
}

function taskDraft(value, courses) {
  if (!kinds.includes(value?.kind) || !priorities.includes(value?.priority)) throw new Error('Confira o tipo e a prioridade da atividade.');
  const courseId = text(value.courseId, 100);
  if (courseId && !courses.some(course => course.id === courseId)) throw new Error('A disciplina selecionada não está disponível.');
  const dueDate = date(value.dueDate, true);
  const time = text(value.time, 5);
  if (time && (!dueDate || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time))) throw new Error('Informe uma data e um horário válidos.');
  let material = null;
  if (value.material !== null && value.material !== undefined) {
    if (!['book', 'lesson', 'review'].includes(value.material.kind)) throw new Error('O material selecionado não é válido.');
    material = { kind: value.material.kind, id: text(value.material.id, 100, true) };
  }
  return {
    title: text(value.title, 200, true), courseId, kind: value.kind, priority: value.priority,
    dueDate, time, notes: text(value.notes, 6000), material,
  };
}

function validateData(value) {
  if (value?.version !== 1 || !Array.isArray(value.courses) || !Array.isArray(value.tasks) || !value.goals || typeof value.goals !== 'object' || Array.isArray(value.goals)) throw new Error('Formato inválido.');
  const ids = new Set();
  for (const course of value.courses) {
    if (!course || typeof course.id !== 'string' || !course.id || ids.has(course.id)) throw new Error('Disciplina inválida.');
    ids.add(course.id);
    courseDraft(course);
  }
  ids.clear();
  for (const task of value.tasks) {
    if (!task || typeof task.id !== 'string' || !task.id || ids.has(task.id) || !['pending', 'done'].includes(task.status)) throw new Error('Atividade inválida.');
    ids.add(task.id);
    taskDraft(task, value.courses);
    if (task.status === 'done') date(task.completedOn);
    else if (task.completedOn !== '') throw new Error('Conclusão inválida.');
  }
  for (const [week, target] of Object.entries(value.goals)) validateGoal(week, target);
}

function validateGoal(week, target) {
  date(week);
  if (new Date(week + 'T12:00:00Z').getUTCDay() !== 1 || !Number.isInteger(target) || target < 1 || target > 999) throw new Error('Informe uma meta entre 1 e 999 atividades para uma semana válida.');
}

class AcademicPlanner {
  constructor(userData) {
    this.file = path.join(userData, 'planner.json');
    this.data = { version: 1, courses: [], tasks: [], goals: {} };
    try {
      const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      validateData(saved);
      this.data = saved;
    } catch (error) {
      if (error.code !== 'ENOENT') this.problem = 'Não foi possível ler os dados do Planejador. Confira o arquivo planner.json na pasta de dados do Lume.';
    }
  }

  read() {
    if (this.problem) throw new Error(this.problem);
    return structuredClone(this.data);
  }

  commit(next) {
    if (this.problem) throw new Error(this.problem);
    validateData(next);
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temporary = this.file + '.' + randomUUID() + '.tmp';
    try {
      fs.writeFileSync(temporary, JSON.stringify(next), { encoding: 'utf8', flag: 'wx' });
      fs.renameSync(temporary, this.file);
    } catch (error) {
      try { fs.unlinkSync(temporary); } catch { /* Mantém o erro original da gravação. */ }
      throw error;
    }
    this.data = next;
    return this.read();
  }

  saveCourse(id, value) {
    const next = this.read();
    const draft = courseDraft(value);
    if (next.courses.some(course => course.id !== id && course.name.toLocaleLowerCase('pt-BR') === draft.name.toLocaleLowerCase('pt-BR'))) throw new Error('Já existe uma disciplina com esse nome.');
    if (id !== null && !next.courses.some(course => course.id === id)) throw new Error('Disciplina não encontrada.');
    const course = { ...draft, id: id ?? randomUUID() };
    next.courses = id === null ? [...next.courses, course] : next.courses.map(item => item.id === id ? course : item);
    return this.commit(next);
  }

  removeCourse(id) {
    const next = this.read();
    if (!next.courses.some(course => course.id === id)) throw new Error('Disciplina não encontrada.');
    next.courses = next.courses.filter(course => course.id !== id);
    next.tasks = next.tasks.map(task => task.courseId === id ? { ...task, courseId: '' } : task);
    return this.commit(next);
  }

  saveTask(id, value) {
    const next = this.read();
    const previous = next.tasks.find(task => task.id === id);
    if (id !== null && !previous) throw new Error('Atividade não encontrada.');
    const task = { ...previous, ...taskDraft(value, next.courses), id: id ?? randomUUID(), status: previous?.status ?? 'pending', completedOn: previous?.completedOn ?? '' };
    next.tasks = id === null ? [...next.tasks, task] : next.tasks.map(item => item.id === id ? task : item);
    return this.commit(next);
  }

  completeTask(id, completed) {
    if (typeof completed !== 'boolean') throw new Error('Estado de conclusão inválido.');
    const next = this.read();
    const task = next.tasks.find(item => item.id === id);
    if (!task) throw new Error('Atividade não encontrada.');
    if ((task.status === 'done') === completed) return next;
    const now = new Date();
    task.completedOn = completed ? [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-') : '';
    task.status = completed ? 'done' : 'pending';
    return this.commit(next);
  }

  removeTask(id) {
    const next = this.read();
    if (!next.tasks.some(task => task.id === id)) throw new Error('Atividade não encontrada.');
    next.tasks = next.tasks.filter(task => task.id !== id);
    return this.commit(next);
  }

  saveGoal(week, target) {
    validateGoal(week, target);
    const next = this.read();
    next.goals[week] = target;
    return this.commit(next);
  }
}

module.exports = { AcademicPlanner };
