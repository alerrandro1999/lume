import { _electron, expect, test, type ElectronApplication } from '@playwright/test';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { Speech } = require('../electron/speech.cjs');
const { Transcriptions } = require('../electron/transcription.cjs');

test('corrige um intervalo e usa as aulas e cartões para estudar no Estúdio e no Lume', async () => {
  test.skip(process.platform !== 'win32' || process.arch !== 'x64', 'O Estúdio inclui binários para Windows x64.');
  test.setTimeout(150_000);
  const folder = await mkdtemp(path.join(os.tmpdir(), 'lume-lesson-study-'));
  const profile = path.join(folder, 'Perfil de teste');
  const source = path.join(folder, 'Aula de Biologia.wav');
  const second = path.join(folder, 'Aula de Física.wav');
  const exportPath = path.join(folder, 'Cartões.tsv');
  const speech = new Speech();
  const voices: { name: string; language: string }[] = await speech.voices();
  const portuguese = voices.find(voice => voice.language.startsWith('pt'));
  const voice = portuguese ?? voices.find(voice => voice.language.startsWith('en'));
  test.skip(!voice, 'O teste precisa de uma voz do Windows em português ou inglês.');
  const recording = await speech.synthesize(portuguese
    ? 'Bom dia. A universidade recebeu os estudantes. A biblioteca tem livros de história e de ciências. A próxima aula será amanhã pela manhã.'
    : 'Good morning. The university welcomed the students. The library has books about history and science. The next class will be tomorrow morning.', voice!.name);
  await Promise.all([writeFile(source, recording), writeFile(second, recording)]);
  const store = new Transcriptions(profile, path.resolve('resources/transcription/runtime'), () => {});
  const lesson = await store.importAudio(source);
  const other = await store.importAudio(second);
  const segments = [
    { startMs: 0, endMs: 1800, text: 'Texto inicial com erro de reconhecimento.' },
    { startMs: 1800, endMs: 5900, text: 'A universidade recebeu os estudantes.' },
    { startMs: 5900, endMs: 10000, text: 'A biblioteca tem livros de ciências e de história.' },
  ];
  store.save({ ...store.get(lesson.id), language: portuguese ? 'pt' : 'en', segments });
  store.saveMark(lesson.id, null, { category: 'important', note: 'Lembrete da biblioteca', segmentIndex: 2 });
  store.save({ ...store.get(other.id), course: 'Física', segments: [{ startMs: 5900, endMs: 10000, text: 'A biblioteca tem livros de física.' }] });

  const env: Record<string, string> = { LUME_TEST_MODE: '1', LUME_USER_DATA: profile };
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined && !(key in env)) env[key] = value;
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.LUME_DEV_URL;
  const executablePath = process.env.LUME_TRANSCRIPTION_TEST_EXECUTABLE;
  let app: ElectronApplication | undefined;
  try {
    app = await _electron.launch({ ...(executablePath ? { executablePath } : { args: ['.'] }), env });
    const page = await app.firstWindow();
    await page.getByRole('button', { name: 'Abrir Estúdio de Transcrição' }).click();
    await page.getByRole('button', { name: /Aula de Biologia.*Transcrita/ }).click();
    await expect(page.getByRole('heading', { name: 'Aula de Biologia', exact: true })).toBeVisible();
    const audio = page.locator('.studio audio');
    await expect.poll(() => audio.evaluate((element: HTMLAudioElement) => element.duration)).toBeGreaterThan(10);

    await page.getByRole('button', { name: 'Disciplina e glossário' }).click();
    const course = page.getByRole('dialog', { name: 'Disciplina e glossário' });
    await course.getByLabel('Disciplina da aula').fill('Biologia');
    await course.getByRole('button', { name: 'Salvar disciplina' }).click();
    await expect(course.getByText('Disciplina salva.')).toBeVisible();
    await course.getByLabel('Termos técnicos').fill(portuguese ? 'universidade\nbiblioteca' : 'university\nlibrary');
    await course.getByRole('button', { name: 'Salvar glossário' }).click();
    await expect(course.getByText('Glossário salvo.')).toBeVisible();
    await course.getByRole('button', { name: 'Fechar diálogo' }).click();
    await page.getByLabel('Filtrar por disciplina').selectOption('Biologia');
    await expect(page.locator('.studio-projects li')).toHaveCount(1);

    await page.getByRole('button', { name: 'Corrigir intervalo a partir do trecho 1' }).click();
    const range = page.getByRole('dialog', { name: 'Corrigir intervalo' });
    await range.getByLabel('Último trecho do intervalo').selectOption('1');
    await range.getByRole('button', { name: 'Ouvir em 0,75×' }).click();
    await expect.poll(() => audio.evaluate((element: HTMLAudioElement) => element.playbackRate)).toBe(0.75);
    await range.getByRole('button', { name: 'Pausar', exact: true }).click();
    await range.getByRole('button', { name: 'Retranscrever intervalo' }).click();
    const suggestions = range.getByRole('textbox', { name: /Sugestão do trecho/ });
    const expectedWord = portuguese ? /universidade/i : /university/i;
    await expect.poll(() => suggestions.evaluateAll(elements => elements.map(element => (element as HTMLTextAreaElement).value).join(' ')), { timeout: 90_000 }).toMatch(expectedWord);
    expect((await page.evaluate(id => window.lume.transcriptionOpen(id), lesson.id)).segments).toEqual(segments);
    const suggestionValues = await suggestions.evaluateAll(elements => elements.map(element => (element as HTMLTextAreaElement).value));
    await suggestions.nth(suggestionValues.findIndex(text => expectedWord.test(text))).fill('A universidade recebeu os estudantes para a revisão da aula.');
    await range.getByRole('button', { name: 'Aplicar correção' }).click();
    await expect(page.getByText('Correção aplicada ao intervalo.')).toBeVisible();
    const updated = await page.evaluate(id => window.lume.transcriptionOpen(id), lesson.id);
    expect(updated.segments.at(-1)).toEqual(segments[2]);
    expect(updated.segments.slice(0, -1).map(segment => segment.text)).toContain('A universidade recebeu os estudantes para a revisão da aula.');
    expect(updated.segments.slice(0, -1).every(segment => segment.startMs >= 0 && segment.endMs <= 5900)).toBe(true);
    expect(updated.marks[0].note).toBe('Lembrete da biblioteca');

    await page.getByRole('button', { name: 'Buscar nas aulas' }).click();
    const search = page.getByRole('dialog', { name: 'Buscar nas aulas' });
    await search.getByLabel('Buscar nas transcrições').fill('biblioteca');
    await search.getByRole('button', { name: 'Buscar', exact: true }).click();
    await expect(search.getByText('1 trecho encontrado')).toBeVisible();
    await search.getByLabel('Disciplina da busca').selectOption('');
    await search.getByRole('button', { name: 'Buscar', exact: true }).click();
    await expect(search.getByText('2 trechos encontrados')).toBeVisible();
    await search.getByRole('listitem').filter({ hasText: 'Aula de Física.wav' }).getByRole('button', { name: /Abrir trecho/ }).click();
    await expect(page.getByRole('heading', { name: 'Aula de Física' })).toBeVisible();
    await expect.poll(() => audio.evaluate((element: HTMLAudioElement) => element.currentTime)).toBeGreaterThanOrEqual(5.9);
    await page.getByRole('button', { name: /Aula de Biologia.*Transcrita/ }).click();
    await expect(page.getByRole('heading', { name: 'Aula de Biologia' })).toBeVisible();

    await page.getByRole('button', { name: 'Resumo e perguntas' }).click();
    const summary = page.getByRole('region', { name: 'Resumo por tópicos' });
    await expect(summary.getByRole('button', { name: /Ouvir fonte em/ }).first()).toBeVisible();
    const quiz = page.getByRole('region', { name: 'Perguntas de revisão' });
    const firstQuestion = quiz.getByRole('listitem').first();
    await firstQuestion.getByRole('button', { name: 'Mostrar resposta' }).click();
    await expect(firstQuestion.getByRole('status')).toContainText('Resposta:');
    await expect(firstQuestion.getByRole('button', { name: /Ouvir fonte em/ })).toBeVisible();

    await page.getByRole('button', { name: 'Para revisar (1)' }).click();
    await page.getByRole('button', { name: 'Criar cartão da marcação 1' }).click();
    const editor = page.getByRole('dialog', { name: 'Criar cartão de aula' });
    await editor.getByLabel('Pergunta').fill('O que havia na biblioteca?');
    await expect(editor.getByLabel('Resposta')).toHaveValue(segments[2].text);
    await editor.getByRole('button', { name: 'Salvar cartão' }).click();
    await expect(page.getByText('Cartão salvo em Cartões de aulas.')).toBeVisible();

    await page.getByRole('button', { name: 'Aplicativos', exact: true }).click();
    await page.getByRole('button', { name: 'Abrir Lume Leitor' }).click();
    await page.getByRole('button', { name: 'Cartões de aulas' }).click();
    const cards = page.getByRole('dialog', { name: 'Cartões de aulas' });
    await expect(cards.getByRole('heading', { name: 'O que havia na biblioteca?' })).toBeVisible();
    await cards.getByRole('button', { name: 'Mostrar resposta' }).click();
    await expect(cards.getByText(segments[2].text)).toBeVisible();
    await cards.getByRole('button', { name: 'Bom', exact: true }).click();
    await expect(cards.getByText('Revisão salva.')).toBeVisible();
    expect((await page.evaluate(() => window.lume.transcriptionCards()))[0].reviews).toBe(1);
    await app.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = (async () => ({ canceled: false, filePath })) as typeof dialog.showSaveDialog;
    }, exportPath);
    await cards.getByRole('button', { name: 'Exportar para Anki' }).click();
    await expect(cards.getByText('Cartões exportados para o Anki.')).toBeVisible();
    const exportText = await readFile(exportPath, 'utf8');
    expect(exportText).toMatch(/^#separator:Tab/);
    expect(exportText).toContain('"O que havia na biblioteca?"\t');
    expect(exportText).toContain('Fonte: Aula de Biologia.wav · 00:00:05');
    await cards.getByText('Todos os cartões (1)').click();
    await cards.getByRole('button', { name: /O que havia na biblioteca/ }).click();
    await cards.getByRole('button', { name: 'Ouvir trecho de origem' }).click();
    await expect(page.getByRole('heading', { name: 'Aula de Biologia' })).toBeVisible();
    await expect.poll(() => audio.evaluate((element: HTMLAudioElement) => element.currentTime)).toBeGreaterThanOrEqual(5.9);
  } finally {
    await app?.close();
  }
});
