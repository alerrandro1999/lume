import { _electron, expect, test, type ElectronApplication } from '@playwright/test';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const require = createRequire(import.meta.url);
const { Speech } = require('../electron/speech.cjs');
const execute = promisify(execFile);

test('importa MP4 e M4A, transcreve e reabre as marcações da aula', async () => {
  test.skip(process.platform !== 'win32' || process.arch !== 'x64', 'O Estúdio inclui o Whisper para Windows x64.');
  test.setTimeout(150_000);
  const folder = await mkdtemp(path.join(os.tmpdir(), 'lume-transcription-'));
  const source = path.join(folder, 'Aula de Ciências.mp4');
  const wave = path.join(folder, 'Voz.wav');
  const mobile = path.join(folder, 'Gravação do celular.m4a');
  const silent = path.join(folder, 'Vídeo silencioso.mp4');
  const profile = path.join(folder, 'Perfil de teste');
  const speech = new Speech();
  const voices: { name: string; language: string }[] = await speech.voices();
  const portuguese = voices.find(voice => voice.language.startsWith('pt'));
  const voice = portuguese ?? voices.find(voice => voice.language.startsWith('en'));
  test.skip(!voice, 'O teste precisa de uma voz do Windows em português ou inglês.');
  const recording = await speech.synthesize(portuguese
    ? 'Bom dia. A universidade recebeu os estudantes. A biblioteca tem livros de história e de ciências. A próxima aula será amanhã pela manhã.'
    : 'Good morning. The university welcomed the students. The library has books about history and science. The next class will be tomorrow morning.', voice!.name);
  await writeFile(wave, recording);
  const converter = path.resolve('resources/transcription/runtime/ffmpeg/ffmpeg.exe');
  async function encode(args: string[]) {
    await execute(converter, ['-nostdin', '-hide_banner', '-loglevel', 'error', ...args], { windowsHide: true });
  }
  await encode(['-f', 'lavfi', '-i', 'color=c=blue:s=160x90:r=10', '-i', wave, '-c:v', 'mpeg4', '-c:a', 'aac', '-shortest', source]);
  await encode(['-i', wave, '-c:a', 'aac', mobile]);
  await encode(['-f', 'lavfi', '-i', 'color=c=blue:s=160x90:r=10', '-t', '1', '-an', '-c:v', 'mpeg4', silent]);
  const originalVideo = await readFile(source);

  const env: Record<string, string> = { LUME_TEST_MODE: '1', LUME_USER_DATA: profile };
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !(key in env)) env[key] = value;
  }
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.LUME_DEV_URL;
  let app: ElectronApplication | undefined;

  async function openStudio() {
    const executablePath = process.env.LUME_TRANSCRIPTION_TEST_EXECUTABLE;
    app = await _electron.launch({ ...(executablePath ? { executablePath } : { args: ['.'] }), env });
    const page = await app.firstWindow();
    await expect(page.getByRole('heading', { name: 'Aplicativos', exact: true })).toBeVisible();
    await expect(page.getByText('Em breve', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Abrir Estúdio de Transcrição' }).click();
    await expect(page.getByRole('heading', { name: 'Estúdio de Transcrição' })).toBeVisible();
    return page;
  }

  try {
    const page = await openStudio();
    async function choose(filePath: string) {
      await app!.evaluate(({ dialog }, file) => {
        dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [file] })) as typeof dialog.showOpenDialog;
      }, filePath);
    }
    await choose(silent);
    await page.getByRole('button', { name: 'Escolher gravação' }).click();
    await expect(page.getByRole('alert')).toContainText('não tem uma faixa de áudio');
    expect(await page.evaluate(() => window.lume.transcriptionList())).toHaveLength(0);
    await choose(mobile);
    await page.getByRole('button', { name: 'Escolher gravação' }).click();
    await expect(page.getByRole('heading', { name: 'Gravação do celular' })).toBeVisible();
    await expect.poll(() => page.locator('.studio audio').evaluate((element: HTMLAudioElement) => element.duration)).toBeGreaterThan(2);
    await choose(source);
    await page.getByRole('button', { name: 'Importar gravação' }).click();
    await expect(page.getByRole('heading', { name: 'Aula de Ciências' })).toBeVisible();
    const audio = page.locator('.studio audio');
    await expect.poll(() => audio.evaluate((element: HTMLAudioElement) => element.duration)).toBeGreaterThan(2);
    await expect(page.getByLabel('Qualidade')).toHaveValue('accurate');
    await page.getByLabel('Qualidade').selectOption('fast');
    if (!portuguese) await page.getByLabel('Idioma do áudio').selectOption('en');
    const canceled = await page.evaluate(async isPortuguese => {
      const item = (await window.lume.transcriptionList()).find(project => project.name.endsWith('.mp4'))!;
      const pending = window.lume.transcriptionStart(item.id, isPortuguese ? 'pt' : 'en', 'fast');
      await window.lume.transcriptionCancel(item.id);
      return await pending === null;
    }, Boolean(portuguese));
    expect(canceled).toBe(true);
    await page.getByRole('button', { name: 'Iniciar transcrição' }).click();
    await expect(page.getByText('Transcrição concluída.')).toBeVisible({ timeout: 90_000 });
    await expect(page.locator('.studio-segments')).toContainText(portuguese ? /universidade|biblioteca/i : /university|library/i);

    const first = page.locator('.studio-segment').first();
    const seekTarget = await page.evaluate(async () => {
      const item = (await window.lume.transcriptionList()).find(project => project.name.endsWith('.mp4'))!;
      const { segments } = await window.lume.transcriptionOpen(item.id);
      return segments[1]?.startMs ?? 0;
    });
    expect(seekTarget).toBeGreaterThan(0);
    const time = page.getByRole('button', { name: /Reproduzir trecho 2 em/ });
    await time.click();
    await expect(time).toHaveAttribute('aria-current', 'true');
    await expect.poll(() => audio.evaluate((element: HTMLAudioElement) => element.currentTime)).toBeGreaterThan(seekTarget / 1000 + 0.1);
    await audio.evaluate((element: HTMLAudioElement) => element.pause());
    await expect(page.locator('.studio [role="alert"]')).toHaveCount(0);

    await first.getByRole('button', { name: 'Editar trecho 1' }).click();
    await page.getByLabel('Texto do trecho 1').fill('Revisão acadêmica da gravação.');
    await page.getByRole('button', { name: 'Salvar trecho' }).click();
    const search = page.getByRole('searchbox', { name: 'Buscar na transcrição' });
    await search.fill('revisao academica');
    await expect(page.locator('.studio-segment')).toHaveCount(1);
    await expect(first).toContainText('Revisão acadêmica da gravação.');
    await search.fill('sem correspondência');
    await expect(page.getByText('Nenhum trecho corresponde à busca.')).toBeVisible();
    await search.clear();

    const notes = ['Revisar para a prova.', 'Confirmar este conceito.', 'Usar este exemplo no trabalho.'];
    for (const [index, category] of ['important', 'question', 'example'].entries()) {
      const mark = page.getByRole('button', { name: `Marcar trecho ${index + 1}`, exact: true });
      await mark.focus();
      await mark.press('Enter');
      await expect(page.getByLabel('Categoria')).toBeFocused();
      await page.getByLabel('Categoria').selectOption(category);
      await page.getByLabel('Nota (opcional)').fill(notes[index]);
      await page.getByRole('button', { name: 'Salvar marcação' }).press('Enter');
      await expect(page.getByRole('button', { name: `Para revisar (${index + 1})` })).toBeVisible();
    }

    for (const format of ['TXT', 'SRT']) {
      const file = path.join(folder, `Aula.${format.toLowerCase()}`);
      await app!.evaluate(({ dialog }, filePath) => {
        dialog.showSaveDialog = (async () => ({ canceled: false, filePath })) as typeof dialog.showSaveDialog;
      }, file);
      await page.getByRole('button', { name: `Exportar ${format}` }).click();
      await expect(page.getByText(format === 'TXT' ? 'Texto exportado.' : 'Legendas exportadas.')).toBeVisible();
      const contents = await readFile(file, 'utf8');
      expect(contents).toContain('Revisão acadêmica da gravação.');
      if (format === 'SRT') expect(contents).toMatch(/^1\r\n\d\d:\d\d:\d\d,\d{3} --> \d\d:\d\d:\d\d,\d{3}\r\n/);
    }

    await page.getByRole('button', { name: 'Aplicativos', exact: true }).click();
    await page.getByRole('button', { name: 'Abrir Lume Leitor' }).click();
    await expect(page.getByRole('heading', { name: /Sua próxima página/ })).toBeVisible();
    await page.getByRole('button', { name: 'Aplicativos', exact: true }).click();
    await page.getByRole('button', { name: 'Abrir Estúdio de Transcrição' }).click();
    await expect(first).toContainText('Revisão acadêmica da gravação.');
    await page.getByRole('button', { name: 'Gerar nova versão' }).click();
    await page.getByLabel('Qualidade').selectOption('accurate');
    await page.getByRole('button', { name: 'Transcrever novamente' }).click();
    await expect(page.getByText('Nova versão salva. A anterior continua em Gravações.')).toBeVisible({ timeout: 90_000 });
    await expect(page.getByRole('heading', { name: 'Aula de Ciências (versão 2)', exact: true })).toBeVisible();
    await expect(page.locator('.studio-segments')).toContainText(portuguese ? /universidade|biblioteca/i : /university|library/i);
    await expect(page.getByRole('button', { name: 'Para revisar (3)' })).toBeVisible();
    const original = page.locator('.studio-project').filter({ has: page.getByText('Aula de Ciências', { exact: true }) });
    await original.click();
    await expect(first).toContainText('Revisão acadêmica da gravação.');
    await app!.close();
    app = undefined;

    const reopened = await openStudio();
    const reopenedOriginal = reopened.locator('.studio-project').filter({ has: reopened.getByText('Aula de Ciências', { exact: true }) });
    await reopenedOriginal.click();
    await expect(reopened.locator('.studio-segment').first()).toContainText('Revisão acadêmica da gravação.');
    await reopened.getByRole('button', { name: 'Para revisar (3)' }).click();
    const marks = reopened.getByRole('list', { name: 'Marcações da aula' });
    await expect(marks.getByRole('listitem')).toHaveCount(3);
    for (const note of notes) await expect(marks).toContainText(note);
    const range = await reopened.evaluate(async () => {
      const item = (await window.lume.transcriptionList()).find(project => project.name === 'Aula de Ciências.mp4')!;
      const project = await window.lume.transcriptionOpen(item.id);
      return project.marks[1];
    });
    const reviewAudio = reopened.locator('.studio audio');
    await expect.poll(() => reviewAudio.evaluate((element: HTMLAudioElement) => element.duration)).toBeGreaterThan(2);
    await marks.getByRole('button', { name: /Ouvir marcação 2/ }).click();
    await expect.poll(() => reviewAudio.evaluate((element: HTMLAudioElement) => element.currentTime)).toBeGreaterThan(range.startMs / 1000);
    await expect.poll(() => reviewAudio.evaluate((element: HTMLAudioElement) => element.paused)).toBe(true);
    expect(await reviewAudio.evaluate((element: HTMLAudioElement) => element.currentTime)).toBeLessThan(range.endMs / 1000 + 0.8);
    await marks.getByRole('button', { name: 'Editar marcação 1' }).click();
    await reopened.getByLabel('Nota (opcional)').fill('Levar este ponto para o grupo de estudo.');
    await reopened.getByRole('button', { name: 'Salvar marcação' }).click();
    await expect(marks).toContainText('Levar este ponto para o grupo de estudo.');
    await marks.getByRole('button', { name: 'Excluir marcação 3' }).click();
    await expect(reopened.getByRole('button', { name: 'Para revisar (2)' })).toBeVisible();
    await app!.evaluate(({ dialog }) => {
      dialog.showMessageBox = (async () => ({ response: 1, checkboxChecked: false })) as typeof dialog.showMessageBox;
    });
    await reopened.getByRole('button', { name: 'Excluir projeto' }).click();
    await expect(reopened.getByText('Projeto excluído.')).toBeVisible();
    await expect(reopenedOriginal).toHaveCount(0);
    await reopened.getByRole('button', { name: /Aula de Ciências \(versão 2\)/ }).click();
    const remainingAudio = reopened.locator('.studio audio');
    await expect.poll(() => remainingAudio.evaluate((element: HTMLAudioElement) => element.duration)).toBeGreaterThan(2);
    await expect(reopened.getByRole('button', { name: 'Para revisar (3)' })).toBeVisible();
    expect(await readFile(source)).toEqual(originalVideo);
  } finally {
    await app?.close();
  }
});
