import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { dateKey, monthDays, shiftDay, weekStart } from '../src/planner-dates';

const require = createRequire(import.meta.url);
const { AcademicPlanner } = require('../electron/planner.cjs');
const draft = { title: 'Ler o capítulo', courseId: '', kind: 'reading', priority: 'high', dueDate: '2026-11-23', time: '09:30', notes: 'Preparar fichamento.', material: null };

test('persiste as atividades e a meta, reabre conclusões e preserva tarefas ao remover disciplinas', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lume-planner-core-'));
  const planner = new AcademicPlanner(root);
  let state = planner.saveCourse(null, { name: 'Sociologia', teacher: 'Docente', color: 'sage' });
  const courseId = state.courses[0].id;
  state = planner.saveTask(null, { ...draft, courseId });
  const id = state.tasks[0].id;
  state = planner.completeTask(id, true);
  expect(state.tasks[0].completedOn).toBe(dateKey());
  const completedOn = state.tasks[0].completedOn;
  expect(planner.completeTask(id, true).tasks[0].completedOn).toBe(completedOn);
  planner.saveGoal(weekStart(dateKey()), 4);
  const reloaded = new AcademicPlanner(root);
  expect(reloaded.read()).toEqual(planner.read());
  expect(reloaded.removeCourse(courseId).tasks[0]).toMatchObject({ id, courseId: '', status: 'done' });
  expect(reloaded.completeTask(id, false).tasks[0]).toMatchObject({ status: 'pending', completedOn: '' });
  expect(reloaded.removeTask(id).tasks).toHaveLength(0);
});

test('rejeita dados inválidos e uma falha ao gravar conserva o estado anterior', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lume-planner-failure-'));
  const planner = new AcademicPlanner(root);
  planner.saveTask(null, draft);
  const before = planner.read();
  const bytes = fs.readFileSync(planner.file, 'utf8');
  expect(() => planner.saveTask(null, { ...draft, dueDate: '2026-02-30' })).toThrow('data válida');
  expect(() => planner.saveTask(null, { ...draft, dueDate: '', time: '09:30' })).toThrow('horário');
  expect(() => planner.saveTask(null, { ...draft, courseId: 'missing' })).toThrow('disciplina');
  expect(() => planner.saveGoal('2026-11-24', 3)).toThrow('semana válida');
  expect(() => planner.saveTask('missing', draft)).toThrow('não encontrada');
  const rename = fs.renameSync;
  fs.renameSync = () => { throw new Error('Gravação interrompida'); };
  try { expect(() => planner.saveTask(null, { ...draft, title: 'Não deve aparecer' })).toThrow('interrompida'); }
  finally { fs.renameSync = rename; }
  expect(planner.read()).toEqual(before);
  expect(fs.readFileSync(planner.file, 'utf8')).toBe(bytes);
  expect(fs.readdirSync(root)).toEqual(['planner.json']);
  fs.writeFileSync(planner.file, '{arquivo interrompido');
  const invalid = new AcademicPlanner(root);
  expect(() => invalid.read()).toThrow('planner.json');
  expect(() => invalid.saveTask(null, draft)).toThrow('planner.json');
  expect(fs.readFileSync(planner.file, 'utf8')).toBe('{arquivo interrompido');
});

test('calcula semanas de segunda a domingo e calendário entre meses sem converter as datas para UTC', () => {
  expect(weekStart('2026-11-22')).toBe('2026-11-16');
  expect(weekStart('2026-11-23')).toBe('2026-11-23');
  expect(weekStart('2027-01-01')).toBe('2026-12-28');
  expect(shiftDay('2024-02-28', 1)).toBe('2024-02-29');
  const days = monthDays('2026-11-18');
  expect(days).toHaveLength(42);
  expect(new Set(days).size).toBe(42);
  expect(days[0]).toBe('2026-10-26');
  expect(days.at(-1)).toBe('2026-12-06');
});
