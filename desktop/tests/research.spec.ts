import { _electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { dateKey, shiftDay } from '../src/planner-dates';
const require = createRequire(import.meta.url);
async function launch(profile: string) {
  const env: Record<string, string> = { LUME_TEST_MODE: '1', LUME_USER_DATA: profile };
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined && !(key in env)) env[key] = value;
  delete env.ELECTRON_RUN_AS_NODE; delete env.LUME_DEV_URL;
  const executablePath = process.env.LUME_RESEARCH_TEST_EXECUTABLE;
  const app = await _electron.launch({ ...(executablePath ? { executablePath } : { args: ['.'] }), env });
  const page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false));
  await page.getByRole('button', { name: 'Abrir Organizador de TCC e Projetos', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Novo projeto', exact: true })).toBeEnabled();
  return { app, page };
}
async function create(page: Page, title: string) {
  await page.getByRole('button', { name: 'Novo projeto', exact: true }).click();
  const modal = page.getByRole('dialog', { name: 'Novo projeto' });
  await modal.getByLabel('Título do projeto', { exact: true }).fill(title);
  await modal.getByLabel('Curso (opcional)', { exact: true }).fill('Pedagogia');
  await modal.getByLabel('Estudante (opcional)', { exact: true }).fill('Ana');
  await modal.getByLabel('Orientador(a) (opcional)', { exact: true }).fill('Professora Maria');
  await modal.getByLabel('Prazo de entrega', { exact: true }).fill(shiftDay(dateKey(), 60));
  await modal.getByRole('button', { name: 'Criar projeto', exact: true }).click();
  await expect(modal).toHaveCount(0);
}
const current = (page: Page) => page.evaluate(async () => { const api = window.lume.research; return api.open((await api.list())[0].id); });
const tab = (page: Page, name: string) => page.getByRole('navigation', { name: 'Áreas do projeto' }).getByRole('button', { name, exact: true }).click();

test('organiza o projeto, arrasta tarefas, registra orientações, preserva tarefas ao remover etapa e retoma os dados', async ({}, info) => {
  test.setTimeout(240_000);
  const profile = await mkdtemp(path.join(os.tmpdir(), 'lume-research-ui-')); let app: ElectronApplication | undefined;
  try {
    const opened = await launch(profile); app = opened.app; const page = opened.page;
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await create(page, 'Aprendizagem no ensino superior');
    await tab(page, 'Plano do projeto');
    await page.getByLabel('Tema e delimitação', { exact: true }).fill('Práticas de estudo no ensino superior.');
    await page.getByLabel('Objetivo geral', { exact: true }).fill('Investigar as práticas de estudo dos estudantes.');
    await page.getByRole('button', { name: 'Salvar plano do projeto', exact: true }).click();
    await expect(page.locator('.research-toast')).toContainText('Plano do projeto salvo com sucesso.'); await expect(page.locator('.research-toast')).toBeInViewport();
    await page.getByLabel('Metodologia e procedimentos', { exact: true }).fill('Levantamento bibliográfico.'); await expect(page.locator('.research-toast')).toBeEmpty();
    await tab(page, 'Visão geral'); await tab(page, 'Plano do projeto');
    await expect(page.getByLabel('Metodologia e procedimentos', { exact: true })).toHaveValue('Levantamento bibliográfico.');
    await page.getByRole('button', { name: 'Salvar plano do projeto', exact: true }).click(); await expect(page.locator('.research-toast')).toContainText('salvo');
    const stageId = (await current(page)).stages[0].id;
    await tab(page, 'Tarefas 0');
    await page.getByRole('button', { name: 'Nova tarefa', exact: true }).click();
    let modal = page.getByRole('dialog', { name: 'Nova tarefa do projeto' });
    await modal.getByLabel('Título da tarefa', { exact: true }).fill('Delimitar pergunta de pesquisa');
    await modal.getByLabel('Etapa vinculada', { exact: true }).selectOption(stageId);
    await modal.getByLabel('Prioridade', { exact: true }).selectOption('high');
    await modal.getByLabel('Prazo da tarefa', { exact: true }).fill(shiftDay(dateKey(), -1));
    await modal.getByRole('button', { name: 'Salvar tarefa', exact: true }).click(); await expect(modal).toHaveCount(0);
    const task = (await current(page)).tasks[0];
    await page.locator(`[data-research-task="${task.id}"]`).dragTo(page.locator('[data-research-column="doing"]'), { targetPosition: { x: 80, y: 120 } });
    await expect(page.locator('[data-research-column="doing"] .research-task-card')).toHaveCount(1);
    await page.getByLabel('Mover tarefa Delimitar pergunta de pesquisa', { exact: true }).selectOption('done');
    await expect(page.locator('[data-research-column="done"] .research-task-card')).toHaveCount(1);
    await tab(page, 'Orientações'); await page.getByRole('button', { name: 'Registrar orientação', exact: true }).click();
    modal = page.getByRole('dialog', { name: 'Registrar orientação' });
    await modal.getByLabel('O que foi discutido', { exact: true }).fill('Revisar o recorte e detalhar os procedimentos.');
    await modal.getByLabel('Próximos passos', { exact: true }).fill('Revisar objetivo geral\nSelecionar cinco artigos');
    await modal.getByLabel('Prazo dos próximos passos (opcional)', { exact: true }).fill(shiftDay(dateKey(), 7));
    await modal.getByRole('button', { name: 'Salvar orientação', exact: true }).click(); await expect(modal).toHaveCount(0);
    expect((await current(page)).tasks).toHaveLength(3);
    await page.getByRole('button', { name: `Editar orientação de ${dateKey()}`, exact: true }).click(); modal = page.getByRole('dialog', { name: 'Editar orientação' });
    await expect(modal.getByLabel('O que foi discutido', { exact: true })).toHaveValue('Revisar o recorte e detalhar os procedimentos.');
    await modal.getByRole('button', { name: 'Salvar orientação', exact: true }).click(); await expect(modal).toHaveCount(0); expect((await current(page)).tasks).toHaveLength(3);
    await tab(page, 'Etapas'); await expect(page.locator('.research-stage-row')).toHaveCount(7);
    await page.getByRole('button', { name: 'Editar etapa Tema e problema', exact: true }).click(); modal = page.getByRole('dialog', { name: 'Editar etapa' });
    await modal.getByRole('button', { name: 'Excluir', exact: true }).click(); await modal.getByRole('button', { name: 'Confirmar exclusão', exact: true }).click(); await expect(modal).toHaveCount(0);
    expect((await current(page)).tasks.find(item => item.id === task.id)?.stageId).toBe('');
    await tab(page, 'Visão geral'); await page.screenshot({ path: info.outputPath('visao-geral-clara.png'), animations: 'disabled' });
    await tab(page, 'Tarefas 3'); await page.getByRole('button', { name: 'Ativar tema escuro', exact: true }).click(); await page.screenshot({ path: info.outputPath('quadro-escuro.png'), animations: 'disabled' });
    const report = path.join(profile, 'Relatório.md'); await app.evaluate(({ dialog }, filePath) => { dialog.showSaveDialog = (async () => ({ canceled: false, filePath })) as typeof dialog.showSaveDialog; }, report);
    await page.getByRole('button', { name: 'Exportar', exact: true }).click(); await page.getByRole('button', { name: 'Relatório Markdown', exact: true }).click();
    await expect(page.locator('.research-toast')).toContainText('exportado'); expect(await readFile(report, 'utf8')).toContain('Investigar as práticas');
    expect(errors).toEqual([]); await app.close(); app = undefined;
    const reopened = await launch(profile); app = reopened.app;
    expect((await current(reopened.page)).tasks).toHaveLength(3); await tab(reopened.page, 'Plano do projeto');
    await expect(reopened.page.getByLabel('Metodologia e procedimentos', { exact: true })).toHaveValue('Levantamento bibliográfico.');
  } finally { await app?.close(); }
});

test('guarda cópias de arquivos, abre links e os mapas e apresentações exatos vinculados ao projeto', async ({}, info) => {
  test.setTimeout(180_000);
  const profile = await mkdtemp(path.join(os.tmpdir(), 'lume-research-material-'));
  const { ConceptMaps } = require('../electron/concept-maps.cjs'), { Presentations } = require('../electron/presentations.cjs');
  const maps = new ConceptMaps(profile), targetMap = maps.create('Mapa vinculado'); maps.create('Outro mapa');
  const presentations = new Presentations(profile);
  const sourceDraft = { title: 'Defesa do TCC', course: '', audience: '', sections: [{ title: 'Abertura', notes: '', seconds: 60 }] };
  const targetPresentation = presentations.save(null, sourceDraft).find((item: { title: string }) => item.title === sourceDraft.title);
  presentations.save(null, { ...sourceDraft, title: 'Outra apresentação' });
  const original = path.join(profile, 'Minuta.txt'); await writeFile(original, 'Minha minuta de pesquisa.');
  let app: ElectronApplication | undefined;
  try {
    const opened = await launch(profile); app = opened.app; const page = opened.page;
    await create(page, 'Projeto com materiais'); await tab(page, 'Materiais');
    await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [file] })) as typeof dialog.showOpenDialog; }, original);
    await page.getByRole('button', { name: 'Adicionar arquivos', exact: true }).click(); await expect(page.locator('.research-material-card')).toHaveCount(1);
    await app.evaluate(({ shell }) => { (globalThis as unknown as { openedPaths: string[] }).openedPaths = []; shell.openPath = async file => { (globalThis as unknown as { openedPaths: string[] }).openedPaths.push(file); return ''; }; });
    await page.getByRole('button', { name: 'Abrir material Minuta.txt', exact: true }).click(); await expect(page.locator('.research-toast')).toContainText('Material aberto');
    const paths = await app.evaluate(() => (globalThis as unknown as { openedPaths: string[] }).openedPaths); expect(paths[0]).toContain('project-files'); expect(paths[0]).not.toBe(original); expect(await readFile(paths[0], 'utf8')).toBe('Minha minuta de pesquisa.');
    await page.getByRole('button', { name: 'Adicionar link', exact: true }).click(); let modal = page.getByRole('dialog', { name: 'Adicionar link ao projeto' });
    await modal.getByLabel('Endereço do material', { exact: true }).fill('https://example.org/pesquisa'); await modal.getByLabel('Título do material', { exact: true }).fill('Guia do projeto'); await modal.getByRole('button', { name: 'Adicionar material', exact: true }).click(); await expect(modal).toHaveCount(0);
    await app.evaluate(({ shell }) => { (globalThis as unknown as { openedUrls: string[] }).openedUrls = []; shell.openExternal = async url => { (globalThis as unknown as { openedUrls: string[] }).openedUrls.push(url); }; });
    await page.getByRole('button', { name: 'Abrir material Guia do projeto', exact: true }).click(); await expect(page.locator('.research-toast')).toContainText('Material aberto'); expect(await app.evaluate(() => (globalThis as unknown as { openedUrls: string[] }).openedUrls)).toEqual(['https://example.org/pesquisa']);
    async function attach(key: string) { await page.getByRole('button', { name: 'Vincular do hub', exact: true }).click(); const modal = page.getByRole('dialog', { name: 'Vincular material do hub' }); await modal.getByLabel('Material do hub', { exact: true }).selectOption(key); await modal.getByRole('button', { name: 'Adicionar material', exact: true }).click(); await expect(modal).toHaveCount(0); }
    await attach(`map:${targetMap.id}`); await attach(`presentation:${targetPresentation.id}`);
    await page.getByRole('button', { name: 'Abrir material Mapa vinculado', exact: true }).click(); await expect(page.locator('.concept-header-name > button')).toHaveText('Mapa vinculado');
    await page.locator('#app-concept-maps .hub-return').click(); await page.getByRole('button', { name: 'Abrir Organizador de TCC e Projetos', exact: true }).click();
    await page.getByRole('button', { name: 'Abrir material Defesa do TCC', exact: true }).click(); await expect(page.locator('.presentation-title h1')).toHaveText('Defesa do TCC');
    await page.locator('#app-presentation .hub-return').click(); await page.getByRole('button', { name: 'Abrir Organizador de TCC e Projetos', exact: true }).click();
    if (!process.env.LUME_RESEARCH_TEST_EXECUTABLE) await page.screenshot({ path: info.outputPath('materiais-do-projeto.png'), animations: 'disabled' });
    await page.getByRole('button', { name: 'Remover material Minuta.txt', exact: true }).click(); modal = page.getByRole('dialog', { name: 'Remover material' }); await modal.getByRole('button', { name: 'Remover material', exact: true }).click(); await expect(modal).toHaveCount(0); expect(await readFile(original, 'utf8')).toBe('Minha minuta de pesquisa.');
  } finally { await app?.close(); }
});
