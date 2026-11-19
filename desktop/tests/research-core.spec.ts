import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { ResearchProjects } = require('../electron/research-projects.cjs');
const draft = { title: 'TCC sobre aprendizagem', type: 'tcc', status: 'active', course: 'Pedagogia', student: 'Estudante', advisor: 'Orientadora', team: '', startDate: '2026-01-01', deadline: '2027-06-01' };
const root = () => fs.mkdtempSync(path.join(os.tmpdir(), 'lume-research-core-'));

test('organiza etapas, tarefas e orientações sem duplicar tarefas ao editar uma reunião', () => {
  const directory = root(), store = new ResearchProjects(directory);
  let project = store.create(draft);
  expect(project.stages).toHaveLength(7);
  expect(store.create({ ...draft, title: 'Projeto de extensão', type: 'extension' }).stages).toHaveLength(5);
  const stageId = project.stages[0].id;
  project = store.saveTask(project.id, null, { title: 'Delimitar tema', notes: '', owner: 'Estudante', dueDate: '2026-11-30', priority: 'high', status: 'todo', stageId });
  const taskId = project.tasks[0].id;
  expect(store.moveTask(project.id, taskId, 'done').tasks[0].status).toBe('done');
  project = store.removeStage(project.id, stageId);
  expect(project.tasks[0]).toMatchObject({ id: taskId, stageId: '', status: 'done' });
  const meeting = { date: '2026-11-18', advisor: 'Orientadora', notes: 'Delimitar a pergunta.', nextSteps: 'Revisar o objetivo\nBuscar duas referências', followupDue: '2026-11-25' };
  project = store.saveMeeting(project.id, null, meeting, true);
  expect(project.tasks).toHaveLength(3);
  expect(project.meetings[0].taskIds).toHaveLength(2);
  const meetingId = project.meetings[0].id;
  project = store.saveMeeting(project.id, meetingId, { ...meeting, notes: 'Notas atualizadas.' }, false);
  expect(project.tasks).toHaveLength(3);
  expect(() => store.saveMeeting(project.id, meetingId, meeting, true)).toThrow('nova orientação');
  project = store.removeTask(project.id, project.meetings[0].taskIds[0]);
  expect(project.meetings[0].taskIds).toHaveLength(1);
  project = store.removeMeeting(project.id, meetingId);
  expect(project.tasks).toHaveLength(2);
  expect(project.tasks.every((task: { originMeetingId: string }) => !task.originMeetingId)).toBe(true);
  project = store.savePlan(project.id, { topic: 'Aprendizagem', problem: 'Como estudar?', generalObjective: 'Investigar práticas.', specificObjectives: '', methodology: 'Revisão.', notes: '' });
  expect(store.report(project.id)).toContain('Investigar práticas.');
  expect(store.csv(project.id)).toContain('Concluída');
  expect(new ResearchProjects(directory).open(project.id)).toEqual(project);
});

test('conserva arquivos originais, apaga apenas as cópias cadastradas e desfaz uma cópia se o catálogo falhar', async () => {
  const directory = root(), store = new ResearchProjects(directory), project = store.create(draft);
  const original = path.join(directory, 'Minuta.txt'); fs.writeFileSync(original, 'Uma minuta do projeto.');
  let result = await store.addFiles(project.id, [original]);
  expect(result.added).toBe(1); expect(result.errors).toEqual([]);
  const material = result.project.materials[0], copied = store.fileFor(material);
  expect(copied).not.toBe(original); expect(fs.readFileSync(copied, 'utf8')).toBe('Uma minuta do projeto.');
  store.removeMaterial(project.id, material.id);
  expect(fs.existsSync(copied)).toBe(false); expect(fs.readFileSync(original, 'utf8')).toBe('Uma minuta do projeto.');
  const rename = fs.renameSync; fs.renameSync = () => { throw new Error('Disco indisponível'); };
  try { result = await store.addFiles(project.id, [original]); } finally { fs.renameSync = rename; }
  expect(result.added).toBe(0); expect(result.errors).toHaveLength(1);
  expect(fs.readdirSync(store.files)).toEqual([]);
  result = await store.addFiles(project.id, [original]); store.remove(project.id);
  expect(fs.existsSync(store.fileFor(result.project.materials[0]))).toBe(false);
  expect(fs.existsSync(original)).toBe(true);
});

test('recusa datas e endereços inválidos e impede sobrescrita após corrupção ou falha de gravação', () => {
  const directory = root(), store = new ResearchProjects(directory), project = store.create(draft);
  expect(() => store.saveSettings(project.id, { ...draft, deadline: '2026-02-30' })).toThrow('data válida');
  expect(() => store.saveSettings(project.id, { ...draft, startDate: '2027-07-01' })).toThrow('entrega');
  expect(() => store.addMaterial(project.id, { kind: 'link', title: 'Inseguro', notes: '', url: 'javascript:alert(1)' })).toThrow('HTTP');
  store.addMaterial(project.id, { kind: 'hub', title: 'Mapa', notes: '', source: { kind: 'map', id: 'mapa-de-teste' } });
  expect(() => store.addMaterial(project.id, { kind: 'hub', title: 'Mapa de novo', notes: '', source: { kind: 'map', id: 'mapa-de-teste' } })).toThrow('já está');
  const before = fs.readFileSync(store.file, 'utf8');
  const rename = fs.renameSync; fs.renameSync = () => { throw new Error('Disco indisponível'); };
  try { expect(() => store.saveSettings(project.id, { ...draft, title: 'Não deve aparecer' })).toThrow('indisponível'); } finally { fs.renameSync = rename; }
  expect(store.open(project.id).title).toBe(draft.title); expect(fs.readFileSync(store.file, 'utf8')).toBe(before);
  fs.writeFileSync(store.file, '{interrompido');
  const broken = new ResearchProjects(directory);
  expect(() => broken.list()).toThrow('research-projects.json'); expect(() => broken.create(draft)).toThrow('research-projects.json');
  expect(fs.readFileSync(store.file, 'utf8')).toBe('{interrompido');
});
