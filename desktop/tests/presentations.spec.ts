import { _electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

function environment(profile: string) {
  const env: Record<string, string> = { LUME_TEST_MODE: '1', LUME_USER_DATA: profile };
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined && !(key in env)) env[key] = value;
  delete env.ELECTRON_RUN_AS_NODE; delete env.LUME_DEV_URL;
  return env;
}
async function launch(profile: string, microphone = false) {
  const executablePath = process.env.LUME_PRESENTATION_TEST_EXECUTABLE;
  const flags = microphone ? ['--use-fake-device-for-media-stream'] : [];
  const app = await _electron.launch({ ...(executablePath ? { executablePath, args: flags } : { args: ['.', ...flags] }), env: environment(profile) });
  const page = await app.firstWindow();
  await page.getByRole('button', { name: 'Abrir Treino de Apresentação', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Nova apresentação', exact: true })).toBeEnabled();
  return { app, page };
}
async function create(page: Page, title: string) {
  await page.getByRole('button', { name: 'Nova apresentação', exact: true }).click();
  const modal = page.getByRole('dialog', { name: 'Nova apresentação', exact: true });
  await modal.getByLabel('Título da apresentação', { exact: true }).fill(title);
  await modal.getByLabel('Disciplina (opcional)', { exact: true }).fill('Metodologia científica');
  await modal.getByLabel('Público (opcional)', { exact: true }).fill('Turma do 3º semestre');
  await modal.getByLabel('Notas do tópico 1', { exact: true }).fill('Apresentar o problema e a pergunta da pesquisa.');
  await modal.getByLabel('Notas do tópico 2', { exact: true }).fill('Explicar os resultados e mostrar um exemplo.');
  await modal.getByRole('button', { name: 'Salvar roteiro', exact: true }).click();
  await expect(modal).toHaveCount(0);
}

test('ensaia por tópicos, pausa ao voltar ao hub, salva avaliação e retoma o histórico', async ({}, testInfo) => {
  test.setTimeout(150_000);
  const profile = await mkdtemp(path.join(os.tmpdir(), 'lume-presentation-ui-'));
  let app: ElectronApplication | undefined;
  try {
    const launched = await launch(profile); app = launched.app;
    const page = launched.page;
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await expect(page.getByRole('heading', { name: 'Mais confiança para apresentar' })).toBeVisible();
    await create(page, 'Tecnologia na educação');
    await page.screenshot({ path: testInfo.outputPath('roteiro-claro.png') });
    await page.getByRole('button', { name: 'Iniciar ensaio', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Pausar ensaio', exact: true })).toBeVisible();
    await expect(page.getByTestId('presentation-clock')).not.toHaveText('00:00');
    await page.getByRole('button', { name: 'Próximo tópico', exact: true }).click();
    await expect(page.locator('.presentation-current h2')).toHaveText('Desenvolvimento');
    await page.getByRole('button', { name: 'Pausar ensaio', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Retomar ensaio', exact: true })).toBeVisible();
    const paused = await page.evaluate(() => window.lume.presentations.list().then(projects => projects[0].takes[0].durationMs));
    await page.getByRole('button', { name: 'Aplicativos', exact: true }).click();
    await page.getByRole('button', { name: 'Abrir Treino de Apresentação', exact: true }).click();
    expect(await page.evaluate(() => window.lume.presentations.list().then(projects => projects[0].takes[0].durationMs))).toBe(paused);
    await page.getByRole('button', { name: 'Retomar ensaio', exact: true }).click();
    await page.getByRole('button', { name: 'Aplicativos', exact: true }).click();
    await page.getByRole('button', { name: 'Abrir Treino de Apresentação', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Retomar ensaio', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Finalizar e salvar', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Reveja sua apresentação' })).toBeVisible();
    await page.getByLabel('Clareza', { exact: true }).selectOption('4');
    await page.getByLabel('Organização', { exact: true }).selectOption('3');
    await page.getByLabel('O que melhorar no próximo ensaio', { exact: true }).fill('Encurtar a abertura e explicar o gráfico.');
    await page.getByRole('button', { name: 'Salvar autoavaliação', exact: true }).click();
    const confirmation = page.locator('.presentation-assessment-feedback');
    await expect(confirmation).toHaveText('Autoavaliação salva com sucesso.');
    await expect(confirmation).toBeInViewport();
    await page.getByLabel('Clareza', { exact: true }).selectOption('3');
    await expect(confirmation).toBeEmpty();
    await page.getByLabel('Clareza', { exact: true }).selectOption('4');
    await page.getByRole('button', { name: 'Salvar autoavaliação', exact: true }).click();
    await expect(confirmation).toHaveText('Autoavaliação salva com sucesso.');
    await page.screenshot({ path: testInfo.outputPath('autoavaliacao-salva.png'), animations: 'disabled' });
    const reportFile = path.join(profile, 'Relatório do ensaio.md');
    await app.evaluate(({ dialog }, filePath) => { dialog.showSaveDialog = (async () => ({ canceled: false, filePath })) as typeof dialog.showSaveDialog; }, reportFile);
    await page.getByRole('button', { name: 'Exportar relatório', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Relatório exportado');
    expect(await readFile(reportFile, 'utf8')).toContain('Clareza: 4/5');
    await page.getByRole('button', { name: 'Editar roteiro', exact: true }).click();
    const modal = page.getByRole('dialog', { name: 'Editar apresentação' });
    await modal.getByLabel('Título do tópico 1', { exact: true }).fill('Nova abertura');
    await modal.getByRole('button', { name: 'Salvar roteiro', exact: true }).click();
    await page.getByRole('button', { name: /^Histórico/ }).click();
    await expect(page.locator('.presentation-timing')).toContainText('Abertura');
    await expect(page.locator('.presentation-timing')).not.toContainText('Nova abertura');
    await page.getByRole('button', { name: 'Ativar tema escuro', exact: true }).click();
    await page.screenshot({ path: testInfo.outputPath('historico-escuro.png'), animations: 'disabled' });
    expect(errors).toEqual([]);
    await app.close(); app = undefined;
    const reopened = await launch(profile); app = reopened.app;
    await reopened.page.getByRole('button', { name: /^Histórico/ }).click();
    await expect(reopened.page.getByLabel('Clareza', { exact: true })).toHaveValue('4');
    await expect(reopened.page.getByLabel('O que melhorar no próximo ensaio', { exact: true })).toHaveValue('Encurtar a abertura e explicar o gráfico.');
    await reopened.page.getByRole('button', { name: 'Excluir ensaio', exact: true }).click();
    await reopened.page.getByRole('button', { name: 'Confirmar exclusão do ensaio', exact: true }).click();
    await expect(reopened.page.getByRole('heading', { name: 'Seu primeiro ensaio começa no roteiro' })).toBeVisible();
  } finally { await app?.close(); }
});

test('grava com microfone simulado, reproduz, exporta e finaliza o áudio ao fechar', async ({}, testInfo) => {
  test.setTimeout(150_000);
  const profile = await mkdtemp(path.join(os.tmpdir(), 'lume-presentation-audio-'));
  let app: ElectronApplication | undefined;
  try {
    const launched = await launch(profile, true); app = launched.app;
    const page = launched.page;
    await create(page, 'Defesa do trabalho final');
    expect(await page.evaluate(async () => {
      try { const stream = await navigator.mediaDevices.getUserMedia({ audio: true }); stream.getTracks().forEach(track => track.stop()); return 'allowed'; }
      catch { return 'denied'; }
    })).toBe('denied');
    await page.getByRole('checkbox', { name: 'Gravar áudio do ensaio', exact: true }).check();
    await page.getByRole('button', { name: 'Iniciar ensaio', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Pausar ensaio', exact: true })).toBeVisible();
    expect(await page.evaluate(async () => {
      try { const stream = await navigator.mediaDevices.getUserMedia({ video: true }); stream.getTracks().forEach(track => track.stop()); return 'allowed'; }
      catch { return 'denied'; }
    })).toBe('denied');
    await expect(page.getByTestId('presentation-clock')).toHaveText('00:02');
    await page.screenshot({ path: testInfo.outputPath('ensaio-gravando.png') });
    await page.getByRole('button', { name: 'Pausar ensaio', exact: true }).click();
    await page.getByRole('button', { name: 'Retomar ensaio', exact: true }).click();
    await page.getByRole('button', { name: 'Finalizar e salvar', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Ouça seu ensaio' })).toBeVisible();
    const media = await page.evaluate(async () => {
      const take = (await window.lume.presentations.list())[0].takes[0];
      const response = await fetch(take.audioUrl!, { headers: { Range: 'bytes=0-3' } });
      const player = document.querySelector<HTMLAudioElement>('.presentation-recording audio')!;
      await player.play();
      return { status: response.status, type: response.headers.get('content-type'), bytes: [...new Uint8Array(await response.arrayBuffer())], paused: player.paused };
    });
    expect(media).toEqual({ status: 206, type: 'audio/webm', bytes: [0x1a, 0x45, 0xdf, 0xa3], paused: false });
    const audioFile = path.join(profile, 'ensaio-exportado.webm');
    await app.evaluate(({ dialog }, filePath) => { dialog.showSaveDialog = (async () => ({ canceled: false, filePath })) as typeof dialog.showSaveDialog; }, audioFile);
    await page.getByRole('button', { name: 'Exportar áudio', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Áudio exportado');
    expect((await readFile(audioFile)).byteLength).toBeGreaterThan(500);
    await page.getByRole('button', { name: 'Roteiro e ensaio', exact: true }).click();
    await page.getByRole('button', { name: 'Iniciar ensaio', exact: true }).click();
    await expect(page.getByTestId('presentation-clock')).toHaveText('00:01');
    await app.close(); app = undefined;
    const stored = JSON.parse(await readFile(path.join(profile, 'presentations', 'projects.json'), 'utf8'));
    expect(stored.projects[0].takes).toHaveLength(2);
    expect(stored.projects[0].takes[0].status).toBe('finished');
    expect((await readFile(path.join(profile, 'presentations', stored.projects[0].takes[0].id + '.webm'))).byteLength).toBeGreaterThan(500);
    const reopened = await launch(profile, true); app = reopened.app;
    await reopened.page.getByRole('button', { name: /^Histórico/ }).click();
    await expect(reopened.page.getByRole('heading', { name: 'Ouça seu ensaio' })).toBeVisible();
  } finally { await app?.close(); }
});
