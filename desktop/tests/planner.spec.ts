import { _electron, expect, test, type ElectronApplication } from '@playwright/test';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { dateKey, shiftDay } from '../src/planner-dates';

test('organiza a agenda, calendário e metas, abre materiais do hub e retoma o planejador', async () => {
  test.setTimeout(180_000);
  const profile = await mkdtemp(path.join(os.tmpdir(), 'lume-planner-ui-'));
  const env: Record<string, string> = { LUME_TEST_MODE: '1', LUME_USER_DATA: profile };
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined && !(key in env)) env[key] = value;
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.LUME_DEV_URL;
  const executablePath = process.env.LUME_PLANNER_TEST_EXECUTABLE;
  let app: ElectronApplication | undefined;

  async function launch() {
    app = await _electron.launch({ ...(executablePath ? { executablePath } : { args: ['.'] }), env });
    const page = await app.firstWindow();
    await page.getByRole('button', { name: 'Abrir Planejador Acadêmico', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Organize sua semana' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Adicionar disciplina', exact: true })).toBeEnabled();
    return page;
  }

  try {
    const page = await launch();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.getByRole('button', { name: 'Adicionar disciplina', exact: true }).click();
    let modal = page.getByRole('dialog', { name: 'Nova disciplina' });
    await modal.getByLabel('Nome da disciplina').fill('Metodologia');
    await modal.getByLabel('Docente (opcional)').fill('Professora Ana');
    await modal.getByRole('button', { name: 'Salvar disciplina', exact: true }).click();
    await expect(modal).toHaveCount(0);
    await page.getByRole('button', { name: 'Definir meta', exact: true }).click();
    modal = page.getByRole('dialog', { name: 'Meta semanal' });
    await modal.getByLabel('Atividades por semana').fill('2');
    await modal.getByRole('button', { name: 'Salvar meta' }).click();

    const project = await page.evaluate(() => window.lume.bibliography.create('Referências do projeto'));
    await page.getByRole('button', { name: 'Aplicativos', exact: true }).click();
    await page.getByRole('button', { name: 'Abrir Planejador Acadêmico', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Adicionar disciplina' })).toBeEnabled();
    await page.locator('.planner-sidebar').getByRole('button', { name: 'Nova atividade', exact: true }).click();
    modal = page.getByRole('dialog', { name: 'Nova atividade' });
    await modal.getByLabel('Título', { exact: true }).fill('Revisar bibliografia');
    await modal.getByLabel('Disciplina', { exact: true }).selectOption({ label: 'Metodologia' });
    await modal.getByLabel('Tipo', { exact: true }).selectOption('reading');
    await modal.getByLabel('Prioridade', { exact: true }).selectOption('high');
    await modal.getByLabel('Data', { exact: true }).fill(dateKey());
    await modal.getByLabel('Material do hub (opcional)').selectOption(`review:${project.id}`);
    await modal.getByLabel('Notas', { exact: true }).fill('Conferir os critérios de inclusão.');
    await modal.getByRole('button', { name: 'Salvar atividade', exact: true }).click();
    await expect(page.locator('.planner-task')).toHaveCount(1);
    await page.getByRole('button', { name: 'Abrir material · Referências do projeto' }).click();
    await expect(page.getByRole('heading', { name: 'Referências do projeto', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Aplicativos', exact: true }).click();
    await page.getByRole('button', { name: 'Abrir Planejador Acadêmico', exact: true }).click();
    await expect(page.getByRole('checkbox', { name: 'Concluir Revisar bibliografia' })).toBeEnabled();
    await page.getByRole('checkbox', { name: 'Concluir Revisar bibliografia' }).click();
    await expect(page.getByRole('progressbar', { name: 'Progresso da meta semanal' })).toHaveAttribute('value', '1');
    await expect(page.locator('.planner-task')).toHaveCount(0);
    await page.getByLabel('Mostrar concluídas').check();
    await expect(page.getByRole('checkbox', { name: 'Concluir Revisar bibliografia' })).toBeChecked();
    await page.getByRole('checkbox', { name: 'Concluir Revisar bibliografia' }).click();
    await expect(page.getByRole('progressbar', { name: 'Progresso da meta semanal' })).toHaveAttribute('value', '0');
    await page.getByRole('button', { name: 'Editar atividade Revisar bibliografia' }).click();
    modal = page.getByRole('dialog', { name: 'Editar atividade' });
    await modal.getByLabel('Data', { exact: true }).fill(shiftDay(dateKey(), -1));
    await modal.getByRole('button', { name: 'Salvar atividade', exact: true }).click();
    await page.getByRole('button', { name: 'Atrasadas', exact: true }).click();
    await expect(page.locator('.planner-task')).toHaveCount(1);
    await page.getByRole('searchbox', { name: 'Buscar atividades' }).fill('sem resultado');
    await expect(page.getByRole('heading', { name: 'Nenhuma atividade neste filtro' })).toBeVisible();
    await page.getByRole('searchbox', { name: 'Buscar atividades' }).clear();
    await page.getByRole('button', { name: 'Calendário', exact: true }).click();
    await expect(page.locator('.planner-day')).toHaveCount(42);
    await page.getByRole('button', { name: `${new Date(shiftDay(dateKey(), -1) + 'T12:00:00').toLocaleDateString('pt-BR')}, 1 atividade`, exact: true }).click();
    await expect(page.locator('.planner-task')).toHaveCount(1);
    await page.getByRole('button', { name: 'Editar disciplina Metodologia' }).click();
    modal = page.getByRole('dialog', { name: 'Editar disciplina' });
    await modal.getByRole('button', { name: 'Remover disciplina' }).click();
    await modal.getByRole('button', { name: 'Confirmar remoção' }).click();
    await expect(page.locator('.planner-task')).toContainText('Sem disciplina');
    expect(errors).toEqual([]);
    await app!.close();
    app = undefined;
    const reopened = await launch();
    await expect(reopened.locator('.planner-task')).toHaveCount(1);
    await expect(reopened.locator('.planner-task')).toContainText('Revisar bibliografia');
    await reopened.getByRole('button', { name: 'Editar atividade Revisar bibliografia' }).click();
    modal = reopened.getByRole('dialog', { name: 'Editar atividade' });
    await modal.getByRole('button', { name: 'Excluir atividade' }).click();
    await modal.getByRole('button', { name: 'Confirmar exclusão' }).click();
    await expect(reopened.getByRole('heading', { name: 'Seu semestre começa por aqui' })).toBeVisible();
  } finally { await app?.close(); }
});
