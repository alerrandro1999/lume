import { _electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
async function launch(profile: string) {
  const env: Record<string, string> = { LUME_TEST_MODE: '1', LUME_USER_DATA: profile };
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined && !(key in env)) env[key] = value;
  delete env.ELECTRON_RUN_AS_NODE; delete env.LUME_DEV_URL;
  const executablePath = process.env.LUME_PORTFOLIO_TEST_EXECUTABLE;
  const app = await _electron.launch({ ...(executablePath ? { executablePath } : { args: ['.'] }), env });
  const page = await app.firstWindow(); await app.evaluate(({ BrowserWindow }) => {const window=BrowserWindow.getAllWindows()[0];window.webContents.setBackgroundThrottling(false);if(process.platform==='darwin')window.show();});
  await page.getByRole('button', { name: 'Abrir Portfólio Acadêmico e de Estágio', exact: true }).click();
  await expect(page.locator('.portfolio-person')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Novo registro', exact: true })).toBeEnabled();
  return { app, page };
}
const tab = (page: Page, label: string) => page.getByRole('navigation', { name: 'Áreas do portfólio' }).getByRole('button', { name: new RegExp('^' + label) }).click();
const read = (page: Page) => page.evaluate(() => window.lume.portfolio.read());
test('monta a trajetória, registra estágio, guarda comprovantes e exporta somente os dados selecionados', async ({}, info) => {
  test.setTimeout(240_000);
  const profile = await mkdtemp(path.join(os.tmpdir(), 'lume-portfolio-ui-')); let app: ElectronApplication | undefined;
  try {
    const opened = await launch(profile); app = opened.app; const page = opened.page;
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await tab(page, 'Meu perfil'); await page.getByLabel('Nome completo', { exact: true }).fill('Ana Silva'); await page.getByLabel('Título de apresentação', { exact: true }).fill('Estudante de Pedagogia');
    await page.getByLabel('Curso', { exact: true }).fill('Licenciatura em Pedagogia'); await page.getByLabel('Instituição', { exact: true }).fill('Instituição de Ensino'); await page.getByLabel('E-mail', { exact: true }).fill('ana-reservado@example.org');
    await page.getByLabel('Sobre mim', { exact: true }).fill('Tenho interesse em práticas de aprendizagem, leitura e desenvolvimento de projetos educacionais.');
    await tab(page, 'Visão geral'); await tab(page, 'Meu perfil'); await expect(page.getByLabel('Nome completo', { exact: true })).toHaveValue('Ana Silva');
    await page.getByRole('button', { name: 'Salvar perfil', exact: true }).click(); await expect(page.locator('.portfolio-toast')).toContainText('Perfil salvo'); await expect(page.locator('.portfolio-toast')).toBeInViewport();
    async function entry(kind: string, title: string) {
      await page.locator('.portfolio-topline').getByRole('button', { name: 'Novo registro', exact: true }).click(); const form = page.getByRole('dialog', { name: 'Novo registro na trajetória' });
      await form.getByLabel('Categoria do registro', { exact: true }).selectOption(kind); await form.getByLabel('Título do registro', { exact: true }).fill(title);
      await form.getByLabel('Instituição ou organização', { exact: true }).fill('Instituição de Ensino');
      if (kind === 'education') await form.getByLabel('Descrição e responsabilidades', { exact: true }).fill(Array.from({ length: 6 }, () => 'A formação reúne estudos sobre aprendizagem, planejamento e práticas de leitura. As atividades incluem análise de textos, produção de materiais e discussão de projetos em equipe.').join('\n\n'));
      if (kind === 'experience') await form.getByLabel('Resultados e aprendizados', { exact: true }).fill(Array.from({ length: 8 }, () => 'Durante a experiência, desenvolvi a organização do trabalho e a comunicação com a equipe. Registrei as atividades realizadas e revisei os materiais a partir das orientações recebidas.').join('\n\n'));
      if (kind === 'experience') await form.getByLabel('Meta de horas (opcional)', { exact: true }).fill('120');
      await form.getByRole('button', { name: 'Salvar registro', exact: true }).click(); await expect(form).toHaveCount(0).catch(async error => { const details=await form.evaluate(node=>({alerts:Array.from(node.querySelectorAll('[role=alert]')).map(n=>n.textContent),invalid:Array.from(node.querySelectorAll<HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement>('input,textarea,select')).filter(n=>!n.validity.valid).map(n=>({type:n.type,value:n.value,message:n.validationMessage}))}));throw new Error('Registro não salvo: '+JSON.stringify(details),{cause:error}); });
    }
    await entry('education', 'Licenciatura em Pedagogia'); await entry('experience', 'Estágio pedagógico'); await entry('project', 'PROJETO_RESERVADO_NAO_PUBLICAR');
    await tab(page, 'Minha trajetória'); await page.getByLabel('Incluir PROJETO_RESERVADO_NAO_PUBLICAR na apresentação', { exact: true }).uncheck(); await expect(page.locator('.portfolio-toast')).toContainText('fora da apresentação');
    await page.getByRole('button', { name: 'Comprovantes de Estágio pedagógico', exact: true }).click();
    const proofFile = path.join(profile, 'Declaracao.pdf'), proof = await PDFDocument.create(); proof.addPage().drawText('COMPROVANTE_RESERVADO'); await writeFile(proofFile, await proof.save());
    await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [file] })) as typeof dialog.showOpenDialog; }, proofFile);
    let modal = page.getByRole('dialog', { name: 'Comprovantes do registro' }); await modal.getByRole('button', { name: 'Adicionar comprovantes', exact: true }).click(); await expect(modal).toContainText('Declaracao.pdf');
    await modal.getByRole('button', { name: 'Fechar diálogo', exact: true }).click();
    await tab(page, 'Diário de estágio'); await page.getByRole('button', { name: 'Registrar atividade', exact: true }).click(); modal = page.getByRole('dialog', { name: 'Registrar atividade de estágio' });
    await modal.getByLabel('Horas da atividade', { exact: true }).fill('2'); await modal.getByLabel('Minutos adicionais', { exact: true }).fill('30'); await modal.getByLabel('Atividade realizada', { exact: true }).fill('NOTA_INTERNA_DIARIO'); await modal.getByLabel('Aprendizados e reflexões', { exact: true }).fill('Aprendi a organizar atividades em equipe.');
    await modal.getByRole('button', { name: 'Salvar atividade', exact: true }).click(); await expect(modal).toHaveCount(0); await expect(page.locator('.portfolio-diary-summary')).toContainText('2 h 30 min');
    await tab(page, 'Competências'); await page.getByRole('button', { name: 'Nova competência', exact: true }).click(); modal = page.getByRole('dialog', { name: 'Nova competência' });
    await modal.getByLabel('Nome da competência', { exact: true }).fill('Planejamento de atividades'); await modal.getByLabel('Autoavaliação', { exact: true }).selectOption('practicing'); await modal.getByRole('button', { name: 'Salvar competência', exact: true }).click(); await expect(modal).toHaveCount(0);
    await tab(page, 'Prévia e exportação'); await page.getByRole('checkbox', { name: 'Incluir contatos', exact: true }).uncheck(); await expect(page.locator('.portfolio-toast')).toContainText('contatos');
    await expect(page.frameLocator('iframe[title="Prévia do portfólio"]').getByRole('heading', { name: 'Ana Silva', exact: true })).toBeVisible();
    await expect(page.frameLocator('iframe[title="Prévia do portfólio"]').locator('body')).not.toContainText('PROJETO_RESERVADO');
    const pdfFile = info.outputPath('portfolio-academico.pdf');
    await app.evaluate(({ dialog }, filePath) => { dialog.showSaveDialog = (async () => ({ canceled: false, filePath })) as typeof dialog.showSaveDialog; }, pdfFile);
    await page.getByRole('button', { name: 'Exportar PDF', exact: true }).click(); await expect(page.locator('.portfolio-toast')).toContainText('PDF exportado', { timeout: 30000 });
    const pdf = await PDFDocument.load(await readFile(pdfFile)); expect(pdf.getPageCount()).toBeGreaterThanOrEqual(2);
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const loadingTask = getDocument({ data: new Uint8Array(await readFile(pdfFile)), useSystemFonts: true });
    const document = await loadingTask.promise;
    const texts: string[] = [];
    try { for (let number = 1; number <= document.numPages; number++) { const content = await (await document.getPage(number)).getTextContent(); texts.push(content.items.map(item => 'str' in item ? item.str : '').join(' ')); } } finally { await loadingTask.destroy(); }
    const text = texts.join('\n'); expect(text).toContain('Ana Silva'); expect(text).toContain('Estágio pedagógico'); expect(text).not.toContain('ana-reservado'); expect(text).not.toContain('PROJETO_RESERVADO'); expect(text).not.toContain('COMPROVANTE_RESERVADO'); expect(text).not.toContain('NOTA_INTERNA_DIARIO');
    const csvFile = info.outputPath('diario.csv'); await app.evaluate(({ dialog }, filePath) => { dialog.showSaveDialog = (async () => ({ canceled: false, filePath })) as typeof dialog.showSaveDialog; }, csvFile);
    await page.getByRole('button', { name: 'Exportar', exact: true }).click(); await page.getByRole('button', { name: 'Diário de estágio CSV', exact: true }).click(); await expect(page.locator('.portfolio-toast')).toContainText('CSV'); expect(await readFile(csvFile, 'utf8')).toContain('NOTA_INTERNA_DIARIO');
    expect(errors).toEqual([]); await app.close(); app = undefined;
    const reopened = await launch(profile); app = reopened.app; expect((await read(reopened.page)).logs[0].minutes).toBe(150); expect((await read(reopened.page)).evidence).toHaveLength(1);
  } finally { await app?.close(); }
});
test('reaproveita um projeto do hub e abre o projeto original correto', async ({}, info) => {
  test.setTimeout(120_000); const profile = await mkdtemp(path.join(os.tmpdir(), 'lume-portfolio-project-'));
  const { ResearchProjects } = require('../electron/research-projects.cjs'), projects = new ResearchProjects(profile);
  const draft = { title: 'Projeto de leitura', type: 'tcc', status: 'active', course: 'Pedagogia', student: '', advisor: '', team: '', startDate: '2026-01-01', deadline: '' };
  const target = projects.create(draft); projects.create({ ...draft, title: 'Outro projeto mais recente' });
  let app: ElectronApplication | undefined;
  try {
    const opened = await launch(profile); app = opened.app; const page = opened.page;
    await tab(page, 'Minha trajetória'); await page.getByRole('button', { name: 'Trazer projeto do hub', exact: true }).click(); const form = page.getByRole('dialog', { name: 'Trazer projeto do hub' });
    await form.getByLabel('Projeto do Organizador de TCC', { exact: true }).selectOption(target.id); await form.getByRole('button', { name: 'Adicionar projeto ao portfólio', exact: true }).click(); await expect(form).toHaveCount(0); expect((await read(page)).entries[0].sourceProjectId).toBe(target.id);
    await page.getByRole('button', { name: 'Abrir projeto original Projeto de leitura', exact: true }).click(); await expect(page.locator('.research-project-heading h1')).toHaveText('Projeto de leitura');
    await page.locator('#app-research .hub-return').click(); await page.getByRole('button', { name: 'Abrir Portfólio Acadêmico e de Estágio', exact: true }).click();
    await tab(page, 'Visão geral'); if (!process.env.LUME_PORTFOLIO_TEST_EXECUTABLE) await page.screenshot({ path: info.outputPath('portfolio-visao-geral.png'), animations: 'disabled' });
  } finally { await app?.close(); }
});
