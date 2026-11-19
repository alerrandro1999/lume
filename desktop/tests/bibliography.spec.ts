import { _electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parse } from 'csv-parse/sync';

test('faz a revisão completa com deduplicação, triagem, evidências e contagens PRISMA', async () => {
  test.setTimeout(150_000);
  const root = await mkdtemp(path.join(os.tmpdir(), 'lume-bibliography-'));
  const profile = path.join(root, 'Perfil');
  const ris = path.join(root, 'Busca.ris');
  const bib = path.join(root, 'Referências.bib');
  const csv = path.join(root, 'Registro.csv');
  const evidenceFile = path.join(root, 'Evidências.csv');
  const prismaFile = path.join(root, 'PRISMA.csv');
  await Promise.all([
    writeFile(ris, [
      ['TI  - Atividade física na escola', 'AU  - Silva, Ana', 'PY  - 2022', 'DO  - 10.1234/study1'],
      ['TI  - Treino escolar e atividade física', 'AU  - Silva, Ana', 'PY  - 2022', 'DO  - 10.1234/exclude'],
      ['TI  - Relatório complementar de atividade física', 'AU  - Silva, Ana', 'PY  - 2023', 'DO  - 10.1234/study2'],
      ['TI  - Estudo sem acesso ao texto', 'AU  - Costa, João', 'PY  - 2021'],
      ['AU  - Castro, Ana', 'PY  - 2020'],
    ].map(fields => ['TY  - JOUR', ...fields, 'ER  -'].join('\r\n')).join('\r\n\r\n')),
    writeFile(bib, [
      '@article{duplicate, title={Atividade física na escola}, author={Silva, Ana}, year={2022}, doi={https://doi.org/10.1234/STUDY1}, abstract={Pesquisa em saúde e educação.}}',
      '@article{qualitative, title={Estudo qualitativo de movimento}, author={Costa, João}, year={2020}}',
    ].join('\n')),
    writeFile(csv, [
      'Título;Autores;Ano;DOI;Resumo',
      'Treino escolar e atividade física;Silva, Ana;2022;;',
      'Registro com crianças;Cruz, Júlia;2023;10.1234/registry;"Resumo com\nmais de uma linha."',
      'Treino escolar e atividade física;Silva, Ana;2022;10.1234/distinct;',
    ].join('\r\n')),
  ]);
  const env: Record<string, string> = { LUME_TEST_MODE: '1', LUME_USER_DATA: profile };
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined && !(key in env)) env[key] = value;
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.LUME_DEV_URL;
  let app: ElectronApplication | undefined;
  let page: Page;
  const inspector = () => page.getByRole('article', { name: 'Referência selecionada' });

  async function launch() {
    const executablePath = process.env.LUME_BIBLIOGRAPHY_TEST_EXECUTABLE;
    app = await _electron.launch({ ...(executablePath ? { executablePath } : { args: ['.'] }), env });
    const window = await app.firstWindow();
    await expect(window.getByRole('button', { name: 'Abrir Lume Leitor' })).toBeVisible();
    await expect(window.getByRole('button', { name: 'Abrir Estúdio de Transcrição' })).toBeVisible();
    await window.getByRole('button', { name: 'Abrir Bancada de Revisão Bibliográfica' }).click();
    return window;
  }

  async function importFiles(files: string[], origin: string, kind: 'database' | 'register') {
    await app!.evaluate(({ dialog }, filePaths) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths })) as typeof dialog.showOpenDialog;
    }, files);
    await page.getByRole('button', { name: 'Importar referências', exact: true }).click();
    const form = page.getByRole('dialog', { name: 'Importar referências' });
    await form.getByLabel('Nome da fonte (opcional)').fill(origin);
    await form.getByLabel('Tipo de fonte').selectOption(kind);
    await form.getByRole('button', { name: 'Selecionar arquivos' }).click();
    await expect(form).toHaveCount(0);
  }

  async function selectReference(title: string, key?: string) {
    const list = page.getByRole('region', { name: 'Resultados da busca' });
    await page.getByRole('searchbox', { name: 'Buscar nas referências' }).fill(key ?? title);
    await list.getByRole('button', { name: new RegExp(title, 'i') }).click();
    await expect(inspector().getByRole('heading', { name: title, exact: true })).toBeVisible();
  }

  async function save() {
    await inspector().getByRole('button', { name: 'Salvar decisão', exact: true }).click();
    await expect(page.getByText('Decisão salva.')).toBeVisible();
  }

  async function exportFile(destination: string, button: string, notification: string) {
    await app!.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = (async () => ({ canceled: false, filePath })) as typeof dialog.showSaveDialog;
    }, destination);
    await page.getByRole('button', { name: button }).click();
    await expect(page.getByText(notification)).toBeVisible();
    return parse(await readFile(destination), { delimiter: ';', bom: true }) as string[][];
  }

  try {
    page = await launch();
    await page.getByRole('button', { name: 'Criar primeira revisão' }).click();
    const create = page.getByRole('dialog', { name: 'Nova revisão bibliográfica' });
    await create.getByLabel('Nome da revisão').fill('Revisão de atividade física');
    await create.getByRole('button', { name: 'Criar revisão' }).click();
    await expect(page.getByRole('heading', { name: 'Revisão de atividade física' })).toBeVisible();
    await page.getByRole('button', { name: 'Critérios da revisão' }).click();
    const criteria = page.getByRole('dialog', { name: 'Critérios da revisão' });
    await criteria.getByLabel('Pergunta da revisão').fill('Qual é o efeito da atividade física na escola?');
    await criteria.getByLabel('Critérios de inclusão').fill('Estudos com estudantes do ensino básico.');
    await criteria.getByLabel('Critérios de exclusão').fill('População adulta sem vínculo escolar.');
    await criteria.getByRole('button', { name: 'Salvar critérios' }).click();

    await importFiles([ris, bib], 'Base de teste', 'database');
    await expect(page.getByText('5 novas · 1 duplicata · 1 sem título')).toBeVisible();
    await importFiles([csv], 'Registro de teste', 'register');
    await expect(page.getByText('2 novas · 1 duplicata · 0 sem título')).toBeVisible();
    await importFiles([csv], 'Registro de teste', 'register');
    await expect(page.getByText(/1 arquivo já importado/)).toBeVisible();

    await selectReference('Atividade física na escola', 'saude educacao');
    await expect(inspector()).toContainText('Pesquisa em saúde e educação.');
    await inspector().getByLabel('Etapa da referência').selectOption('awaiting_text');
    await save();
    await inspector().getByLabel('Etapa da referência').selectOption('awaiting_assessment');
    await save();
    await inspector().getByLabel('Etapa da referência').selectOption('included');
    await inspector().getByLabel('ID do estudo').fill('EST-01');
    await inspector().getByLabel('Delineamento').fill('Ensaio controlado');
    await inspector().getByLabel('População ou amostra').fill('120 estudantes');
    await inspector().getByLabel('Resultados').fill('A atividade física aumentou.');
    await save();

    await selectReference('Relatório complementar de atividade física');
    await inspector().getByLabel('Etapa da referência').selectOption('included');
    await inspector().getByLabel('ID do estudo').fill('EST-01');
    await inspector().getByLabel('Notas da revisão').fill('=1+1');
    await save();
    await selectReference('Estudo qualitativo de movimento');
    await inspector().getByLabel('Etapa da referência').selectOption('screen_excluded');
    await expect(inspector().getByRole('button', { name: 'Salvar decisão', exact: true })).toBeDisabled();
    await inspector().getByLabel('Motivo da exclusão').fill('Delineamento inelegível');
    await save();
    await selectReference('Treino escolar e atividade física', '10.1234/exclude');
    await inspector().getByLabel('Etapa da referência').selectOption('full_excluded');
    await inspector().getByLabel('Motivo da exclusão').fill('População fora dos critérios');
    await save();
    await selectReference('Estudo sem acesso ao texto');
    await inspector().getByLabel('Etapa da referência').selectOption('not_retrieved');
    await save();

    await page.getByRole('button', { name: 'Fluxo PRISMA e exportações' }).click();
    const evidence = await exportFile(evidenceFile, 'Exportar evidências', 'Tabela de evidências exportada.');
    expect(evidence.slice(1).map(row => row[0])).toEqual(['EST-01', 'EST-01']);
    expect(evidence[1]).toContain('A atividade física aumentou.');
    expect(evidence[2]).toContain("'=1+1");
    const prisma = await exportFile(prismaFile, 'Exportar contagens PRISMA', 'Contagens PRISMA exportadas.');
    const results = Object.fromEntries(prisma.slice(1).map(([, label, count]) => [label, count]));
    expect(results).toMatchObject({
      'Registros identificados em bases de dados': '7', 'Registros identificados em registros de estudos': '3', 'Duplicatas removidas antes da triagem': '2',
      'Removidos antes da triagem por outros motivos (sem título)': '1', 'Registros triados': '5', 'Registros excluídos por título ou resumo': '1',
      'Relatórios procurados para recuperação': '4', 'Relatórios não recuperados': '1', 'Relatórios avaliados quanto à elegibilidade': '3',
      'Relatórios excluídos após avaliação': '1', 'População fora dos critérios': '1', 'Relatórios de estudos incluídos': '2', 'Estudos incluídos (IDs distintos)': '1',
      'Registros ainda sem triagem': '2',
    });

    await app!.close();
    app = undefined;
    page = await launch();
    await expect(page.getByRole('heading', { name: 'Revisão de atividade física' })).toBeVisible();
    await expect(page.getByText('Qual é o efeito da atividade física na escola?')).toBeVisible();
    await selectReference('Atividade física na escola', '10.1234/study1');
    await expect(inspector().getByLabel('Etapa da referência')).toHaveValue('included');
    await expect(inspector().getByLabel('ID do estudo')).toHaveValue('EST-01');
    await expect(inspector().getByLabel('Resultados')).toHaveValue('A atividade física aumentou.');
  } finally { await app?.close(); }
});
