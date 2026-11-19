const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const states = ['todo', 'doing', 'review', 'done'];
const types = ['tcc', 'research', 'extension', 'other'];
const sourceKinds = ['book', 'lesson', 'review', 'map', 'presentation'];
const extensions = new Set(['.pdf', '.docx', '.odt', '.txt', '.md', '.pptx', '.xlsx', '.csv', '.png', '.jpg', '.jpeg']);
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const planFields = ['topic', 'problem', 'generalObjective', 'specificObjectives', 'methodology', 'notes'];
const emptyPlan = () => Object.fromEntries(planFields.map(key => [key, '']));
function text(value, limit, required = false) {
  if (typeof value !== 'string' || value.length > limit || value.includes('\0')) throw new Error('Confira os campos do projeto.');
  const clean = value.trim();
  if (required && !clean) throw new Error('Informe um título.');
  return clean;
}
function day(value, optional = true) {
  if (optional && value === '') return '';
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Informe uma data válida.');
  const date = new Date(value + 'T12:00:00Z');
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error('Informe uma data válida.');
  return value;
}
function key(value) { if (typeof value !== 'string' || !uuid.test(value)) throw new Error('Registro inválido.'); return value; }
function state(value) { if (!states.includes(value)) throw new Error('Selecione uma situação válida.'); return value; }
function settings(value) {
  if (!types.includes(value?.type) || !['active', 'on_hold', 'completed'].includes(value.status)) throw new Error('Confira o tipo e a situação do projeto.');
  const startDate = day(value.startDate), deadline = day(value.deadline);
  if (startDate && deadline && deadline < startDate) throw new Error('A entrega deve ser na data de início ou depois dela.');
  return { title: text(value.title, 200, true), type: value.type, status: value.status, course: text(value.course, 150), student: text(value.student, 150), advisor: text(value.advisor, 150), team: text(value.team, 1200), startDate, deadline };
}
function stageDraft(value) { return { title: text(value?.title, 180, true), notes: text(value.notes, 6000), deadline: day(value.deadline), status: state(value.status) }; }
function taskDraft(value, project) {
  if (!['low', 'medium', 'high'].includes(value?.priority)) throw new Error('Selecione uma prioridade válida.');
  const stageId = text(value.stageId, 100);
  if (stageId && !project.stages.some(stage => stage.id === stageId)) throw new Error('Etapa não encontrada.');
  return { title: text(value.title, 200, true), notes: text(value.notes, 6000), owner: text(value.owner, 150), dueDate: day(value.dueDate), priority: value.priority, status: state(value.status), stageId };
}
function meetingDraft(value) { return { date: day(value?.date, false), advisor: text(value.advisor, 150), notes: text(value.notes, 12000), nextSteps: text(value.nextSteps, 6000), followupDue: day(value.followupDue) }; }
function materialDraft(value) {
  const title = text(value?.title, 300, true), notes = text(value.notes, 6000);
  if (value.kind === 'link') {
    let url; try { url = new URL(text(value.url, 3000, true)); } catch { throw new Error('Informe um endereço completo, começando por https:// ou http://.'); }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('Use um endereço HTTP ou HTTPS sem credenciais.');
    return { kind: 'link', title, notes, url: url.href, source: null };
  }
  if (value.kind !== 'hub' || !sourceKinds.includes(value.source?.kind)) throw new Error('Selecione um material do hub.');
  const source = { kind: value.source.kind, id: text(value.source.id, 150, true) };
  return { kind: 'hub', title, notes, url: '', source };
}
function validateProject(project) {
  key(project.id); settings(project);
  if (!Number.isFinite(Date.parse(project.updatedAt)) || !project.plan || planFields.some(field => typeof project.plan[field] !== 'string')) throw new Error('Projeto inválido.');
  for (const field of planFields) text(project.plan[field], 10000);
  for (const [collection, max] of [['stages', 100], ['tasks', 2000], ['meetings', 500], ['materials', 500]]) if (!Array.isArray(project[collection]) || project[collection].length > max) throw new Error('Este projeto atingiu o limite de registros.');
  const ids = new Set();
  const unique = item => { key(item.id); if (ids.has(item.id)) throw new Error('Registro duplicado.'); ids.add(item.id); };
  for (const stage of project.stages) { unique(stage); stageDraft(stage); }
  for (const task of project.tasks) { unique(task); taskDraft(task, project); if (task.originMeetingId && !project.meetings.some(meeting => meeting.id === task.originMeetingId)) throw new Error('Orientação de origem inválida.'); }
  for (const meeting of project.meetings) { unique(meeting); meetingDraft(meeting); if (!Array.isArray(meeting.taskIds) || meeting.taskIds.some(id => !project.tasks.some(task => task.id === id))) throw new Error('Tarefas da orientação inválidas.'); }
  for (const material of project.materials) {
    unique(material);
    if (material.kind === 'file') {
      text(material.title, 300, true); text(material.notes, 6000); text(material.name, 300, true);
      if (!extensions.has(material.extension) || !Number.isSafeInteger(material.size) || material.size < 0) throw new Error('Arquivo do projeto inválido.');
    } else materialDraft(material);
  }
}
class ResearchProjects {
  constructor(userData) {
    this.file = path.join(userData, 'research-projects.json');
    this.files = path.join(userData, 'project-files');
    this.data = { version: 1, projects: [] };
    try {
      const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (saved?.version !== 1 || !Array.isArray(saved.projects) || saved.projects.length > 100) throw new Error('Formato inválido.');
      const ids = new Set();
      for (const project of saved.projects) { validateProject(project); if (ids.has(project.id)) throw new Error('Projeto duplicado.'); ids.add(project.id); }
      this.data = saved;
    } catch (error) { if (error.code !== 'ENOENT') this.problem = 'Não foi possível ler os projetos. Confira o arquivo research-projects.json nos dados do Lume.'; }
  }
  check() { if (this.problem) throw new Error(this.problem); }
  list() {
    this.check();
    return this.data.projects.map(project => ({ id: project.id, title: project.title, type: project.type, status: project.status, deadline: project.deadline, updatedAt: project.updatedAt, tasks: project.tasks.length, done: project.tasks.filter(task => task.status === 'done').length })).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  get(id) { this.check(); const project = this.data.projects.find(item => item.id === id); if (!project) throw new Error('Projeto não encontrado.'); return project; }
  open(id) { return structuredClone(this.get(id)); }
  commit(next) {
    this.check();
    for (const project of next.projects) validateProject(project);
    const json = JSON.stringify(next);
    if (Buffer.byteLength(json) > 64 * 1024 ** 2) throw new Error('Os projetos atingiram o limite de armazenamento.');
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temporary = this.file + '.' + randomUUID() + '.tmp';
    try { fs.writeFileSync(temporary, json, { flag: 'wx', encoding: 'utf8' }); fs.renameSync(temporary, this.file); }
    catch (error) { try { fs.unlinkSync(temporary); } catch { /* Preserva o erro de gravação. */ } throw error; }
    this.data = next;
  }
  update(id, change) {
    const project = this.open(id); change(project); project.updatedAt = new Date().toISOString();
    this.commit({ ...this.data, projects: this.data.projects.map(item => item.id === id ? project : item) });
    return this.open(id);
  }
  create(value) {
    this.check(); if (this.data.projects.length >= 100) throw new Error('Você já possui 100 projetos.');
    const draft = settings(value);
    const titles = draft.type === 'tcc' ? ['Tema e problema', 'Projeto de pesquisa', 'Revisão da literatura', 'Metodologia', 'Desenvolvimento e análise', 'Redação final', 'Apresentação e entrega'] : ['Planejamento', 'Pesquisa e preparação', 'Execução', 'Revisão', 'Entrega'];
    const project = { ...draft, id: randomUUID(), updatedAt: new Date().toISOString(), plan: emptyPlan(), stages: titles.map(title => ({ id: randomUUID(), title, notes: '', deadline: '', status: 'todo' })), tasks: [], meetings: [], materials: [] };
    this.commit({ ...this.data, projects: [...this.data.projects, project] }); return this.open(project.id);
  }
  saveSettings(id, value) { const draft = settings(value); return this.update(id, project => Object.assign(project, draft)); }
  savePlan(id, value) { const plan = Object.fromEntries(planFields.map(field => [field, text(value?.[field], 10000)])); return this.update(id, project => { project.plan = plan; }); }
  saveStage(id, stageId, value) {
    const draft = stageDraft(value);
    return this.update(id, project => {
      if (stageId !== null && !project.stages.some(stage => stage.id === stageId)) throw new Error('Etapa não encontrada.');
      const stage = { ...draft, id: stageId ?? randomUUID() };
      project.stages = stageId === null ? [...project.stages, stage] : project.stages.map(item => item.id === stageId ? stage : item);
    });
  }
  removeStage(id, stageId) { return this.update(id, project => { if (!project.stages.some(stage => stage.id === stageId)) throw new Error('Etapa não encontrada.'); project.stages = project.stages.filter(stage => stage.id !== stageId); for (const task of project.tasks) if (task.stageId === stageId) task.stageId = ''; }); }
  saveTask(id, taskId, value) {
    return this.update(id, project => {
      const previous = taskId === null ? null : project.tasks.find(task => task.id === taskId);
      if (taskId !== null && !previous) throw new Error('Tarefa não encontrada.');
      const task = { ...taskDraft(value, project), id: previous?.id ?? randomUUID(), originMeetingId: previous?.originMeetingId ?? '' };
      project.tasks = previous ? project.tasks.map(item => item.id === taskId ? task : item) : [...project.tasks, task];
    });
  }
  moveTask(id, taskId, status) { state(status); return this.update(id, project => { const task = project.tasks.find(task => task.id === taskId); if (!task) throw new Error('Tarefa não encontrada.'); task.status = status; }); }
  removeTask(id, taskId) { return this.update(id, project => { if (!project.tasks.some(task => task.id === taskId)) throw new Error('Tarefa não encontrada.'); project.tasks = project.tasks.filter(task => task.id !== taskId); for (const meeting of project.meetings) meeting.taskIds = meeting.taskIds.filter(item => item !== taskId); }); }
  saveMeeting(id, meetingId, value, createTasks) {
    if (typeof createTasks !== 'boolean' || (meetingId !== null && createTasks)) throw new Error('Crie tarefas apenas ao registrar uma nova orientação.');
    const draft = meetingDraft(value);
    return this.update(id, project => {
      const previous = meetingId === null ? null : project.meetings.find(meeting => meeting.id === meetingId);
      if (meetingId !== null && !previous) throw new Error('Orientação não encontrada.');
      const meeting = { ...draft, id: previous?.id ?? randomUUID(), taskIds: previous?.taskIds ?? [] };
      if (createTasks) {
        const lines = draft.nextSteps.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
        if (lines.length > 20 || lines.some(line => line.length > 200)) throw new Error('Use até 20 próximos passos, um por linha, com até 200 caracteres cada.');
        for (const title of lines) {
          const task = { id: randomUUID(), title, notes: 'Próximo passo registrado na orientação de ' + draft.date.split('-').reverse().join('/'), owner: project.student, dueDate: draft.followupDue, priority: 'medium', status: 'todo', stageId: '', originMeetingId: meeting.id };
          project.tasks.push(task); meeting.taskIds.push(task.id);
        }
      }
      project.meetings = previous ? project.meetings.map(item => item.id === meetingId ? meeting : item) : [meeting, ...project.meetings];
    });
  }
  removeMeeting(id, meetingId) { return this.update(id, project => { if (!project.meetings.some(meeting => meeting.id === meetingId)) throw new Error('Orientação não encontrada.'); project.meetings = project.meetings.filter(meeting => meeting.id !== meetingId); for (const task of project.tasks) if (task.originMeetingId === meetingId) task.originMeetingId = ''; }); }
  addMaterial(id, value) { const draft = materialDraft(value); return this.update(id, project => { if (draft.kind === 'hub' && project.materials.some(item => item.kind === 'hub' && item.source.kind === draft.source.kind && item.source.id === draft.source.id)) throw new Error('Este material já está vinculado ao projeto.'); project.materials.push({ ...draft, id: randomUUID() }); }); }
  fileFor(material) { key(material.id); if (material.kind !== 'file' || !extensions.has(material.extension)) throw new Error('Arquivo inválido.'); return path.join(this.files, material.id + material.extension); }
  material(id, materialId) { const material = this.get(id).materials.find(item => item.id === materialId); if (!material) throw new Error('Material não encontrado.'); return structuredClone(material); }
  async addFiles(id, paths) {
    this.get(id);
    if (!Array.isArray(paths) || paths.length > 20) throw new Error('Adicione até 20 arquivos por vez.');
    await fsp.mkdir(this.files, { recursive: true });
    const errors = []; let added = 0;
    for (const file of paths) {
      const name = path.basename(file), extension = path.extname(name).toLowerCase(), fileId = randomUUID();
      const temporary = path.join(this.files, fileId + '.tmp'), destination = path.join(this.files, fileId + extension);
      try {
        if (!extensions.has(extension)) throw new Error('Formato não suportado. Use documentos, planilhas, apresentações, PDFs ou imagens.');
        const info = await fsp.stat(file);
        if (!info.isFile() || info.size > 50 * 1024 ** 2) throw new Error('Cada arquivo pode ter até 50 MB.');
        await fsp.copyFile(file, temporary, fs.constants.COPYFILE_EXCL);
        const copied = await fsp.stat(temporary);
        if (copied.size > 50 * 1024 ** 2) throw new Error('Cada arquivo pode ter até 50 MB.');
        await fsp.rename(temporary, destination);
        this.update(id, project => project.materials.push({ id: fileId, kind: 'file', title: name.slice(0, 300), name: name.slice(0, 300), notes: '', extension, size: copied.size })); added++;
      } catch (error) { await fsp.unlink(destination).catch(() => {}); errors.push({ name, detail: error.code ? 'Não foi possível copiar o arquivo.' : error.message }); }
      finally { await fsp.unlink(temporary).catch(() => {}); }
    }
    return { project: this.open(id), added, errors };
  }
  removeMaterial(id, materialId) {
    const material = this.material(id, materialId);
    const project = this.update(id, next => { next.materials = next.materials.filter(item => item.id !== materialId); });
    if (material.kind === 'file') { try { fs.unlinkSync(this.fileFor(material)); } catch (error) { if (error.code !== 'ENOENT') console.warn('Não foi possível remover o arquivo do projeto:', error.message); } }
    return project;
  }
  remove(id) {
    const project = this.open(id); this.commit({ ...this.data, projects: this.data.projects.filter(item => item.id !== id) });
    for (const material of project.materials) if (material.kind === 'file') { try { fs.unlinkSync(this.fileFor(material)); } catch (error) { if (error.code !== 'ENOENT') console.warn('Não foi possível remover o arquivo do projeto:', error.message); } }
    return this.list();
  }
  report(id) {
    const project = this.get(id), labels = { todo: 'A fazer', doing: 'Em andamento', review: 'Em revisão', done: 'Concluída' };
    const date = value => value ? value.split('-').reverse().join('/') : 'Sem prazo';
    const lines = [`# ${project.title}`, '', `Curso: ${project.course || 'Não informado'}`, `Estudante: ${project.student || 'Não informado'}`, `Orientador(a): ${project.advisor || 'Não informado'}`, `Equipe: ${project.team || 'Não informada'}`, `Entrega: ${date(project.deadline)}`, '', '## Plano do projeto', ''];
    for (const [field, label] of Object.entries({ topic: 'Tema', problem: 'Problema / pergunta', generalObjective: 'Objetivo geral', specificObjectives: 'Objetivos específicos', methodology: 'Metodologia', notes: 'Notas do projeto' })) lines.push(`### ${label}`, project.plan[field] || 'Não preenchido.', '');
    lines.push('## Etapas', '');
    for (const stage of project.stages) lines.push(`### ${stage.title}`, `${labels[stage.status]} · ${date(stage.deadline)}`, stage.notes, '');
    lines.push('## Tarefas', '');
    for (const task of project.tasks) lines.push(`- [${task.status === 'done' ? 'x' : ' '}] ${task.title} — ${labels[task.status]} · ${date(task.dueDate)}${task.owner ? ' · ' + task.owner : ''}`, task.notes ? '  ' + task.notes.replaceAll('\n', '\n  ') : '');
    lines.push('', '## Orientações', '');
    for (const meeting of [...project.meetings].sort((a, b) => b.date.localeCompare(a.date))) lines.push(`### ${date(meeting.date)} · ${meeting.advisor || 'Orientação'}`, meeting.notes, '', '**Próximos passos**', meeting.nextSteps || 'Não registrados.', '');
    lines.push('## Materiais', '');
    for (const material of project.materials) lines.push(`- ${material.title}${material.kind === 'link' ? ' — ' + material.url : ''}`, material.notes);
    return lines.join('\n');
  }
  csv(id) {
    const project = this.get(id), cell = value => { const raw = String(value ?? ''); const safe = /^[\s]*[=+\-@]/.test(raw) ? "'" + raw : raw; return '"' + safe.replaceAll('"', '""') + '"'; };
    const rows = [['Tarefa', 'Situação', 'Prioridade', 'Prazo', 'Responsável', 'Etapa', 'Notas'], ...project.tasks.map(task => [task.title, { todo: 'A fazer', doing: 'Em andamento', review: 'Em revisão', done: 'Concluída' }[task.status], { low: 'Baixa', medium: 'Média', high: 'Alta' }[task.priority], task.dueDate, task.owner, project.stages.find(stage => stage.id === task.stageId)?.title || '', task.notes])];
    return '\uFEFF' + rows.map(row => row.map(cell).join(';')).join('\r\n') + '\r\n';
  }
}
module.exports = { ResearchProjects };
