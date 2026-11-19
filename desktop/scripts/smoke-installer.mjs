import { _electron, expect as baseExpect } from '@playwright/test';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, copyFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
const expect = baseExpect.configure({ timeout: 20000 }), exec = promisify(execFile);
if (process.platform !== 'win32') throw new Error('Este teste utiliza o instalador Windows.');
await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "$lumeExisting = @(Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -eq 'Lume' }); if ($lumeExisting.Count) { exit 20 }; if (Get-Process Lume -ErrorAction SilentlyContinue) { exit 21 }"], { windowsHide: true }).catch(error => { throw new Error(`O teste não instala sobre uma instalação pessoal existente nem com o Lume aberto. Código: ${error.code}`); });
const root = path.resolve('.lume-test-data'); await mkdir(root, { recursive: true });
const staging = await mkdtemp(path.join(root, 'installer-smoke-')), destination = path.join(staging, 'lume'), profile = path.join(staging, 'profile'); await mkdir(profile);
if (path.dirname(staging) !== root || path.dirname(destination) !== staging) throw new Error('Destino de teste fora da área temporária do projeto.');
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const filename = `Lume-Setup-${pkg.version}-x64.exe`;
const installer = path.join(staging, filename), executable = path.join(destination, 'Lume.exe');
// Reproduce a setup next to a destination whose name is also the setup's prefix.
await copyFile(path.resolve('release/installers', filename), installer);
const linkResult = await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "@((Join-Path ([Environment]::GetFolderPath('Desktop')) 'Lume.lnk'), (Join-Path ([Environment]::GetFolderPath('StartMenu')) 'Programs\\Lume.lnk')) | ConvertTo-Json -Compress"], { windowsHide: true });
const links = JSON.parse(linkResult.stdout); const savedLinks = [];
for (const [index, link] of links.entries()) if (await stat(link).then(info => info.isFile(), () => false)) { const backup = path.join(staging, `atalho-${index}.lnk`); await copyFile(link, backup); savedLinks.push({ link, backup }); }
const realCatalog = path.join(process.env.APPDATA, 'Lume', 'library.json');
const hash = async file => createHash('sha256').update(await readFile(file)).digest('hex');
const originalHash = await hash(realCatalog).catch(() => null);
const run = (file, args, expected = 0) => new Promise((resolve, reject) => { const child = spawn(file, args, { windowsHide: true, stdio: 'inherit', env: { ...process.env, TEMP: path.join(root, 'tmp'), TMP: path.join(root, 'tmp') } }); child.on('error', reject); child.on('exit', code => code === expected ? resolve() : reject(new Error(`O instalador terminou com código ${code}, esperado ${expected}.`))); });
const env = { ...process.env, LUME_TEST_MODE: '1', LUME_USER_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE; delete env.LUME_DEV_URL;
let app, installed = false;
try {
  await run(installer, ['/S', `/D=${destination}`]); installed = true; console.log('Instalação silenciosa concluída em pasta isolada.');
  app = await _electron.launch({ executablePath: executable, args: [], env }); let window = await app.firstWindow(); await expect(window.getByRole('heading', { name: /Sua próxima página/ })).toBeVisible();
  await expect(window.getByRole('button', { name: 'Atualizações do Lume', exact: true })).toHaveCount(0);
  await window.getByRole('button', { name: 'Sobre o Lume', exact: true }).click();
  const about = window.getByRole('dialog', { name: 'Sobre o Lume', exact: true });
  await expect(about).toContainText(`Versão ${pkg.version}`);
  await about.getByRole('button', { name: 'Fechar diálogo', exact: true }).click();
  await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, path.resolve('examples/Primeiros passos.pdf'));
  await window.getByRole('button', { name: 'Importar livro', exact: true }).click(); await expect(window.locator('.document-heading h1')).toHaveText('Primeiros passos'); await window.getByLabel('Página atual', { exact: true }).fill('2'); await window.getByLabel('Página atual', { exact: true }).press('Enter'); await expect(window.locator('.position-saved')).toContainText('página 2');
  const book = (await window.evaluate(() => window.lume.listRecent()))[0]; await window.evaluate(async id => { await window.lume.saveBookmark(id, { page: 2, label: 'Preservado na reinstalação' }); await window.lume.saveCard(id, { page: 2, front: 'Pergunta', back: 'Resposta' }); }, book.id);
  await run(installer, ['/S', `/D=${destination}`], 2);
  await expect(window.getByLabel('Página atual', { exact: true })).toHaveValue('2');
  console.log('O instalador aguardou o Lume aberto, sem encerrar a leitura.');
  await app.close(); app = null;
  const files = [path.join(profile, 'library.json'), path.join(profile, 'documents', `${book.id}.json`), path.join(profile, 'study.json'), book.path]; const before = await Promise.all(files.map(hash));
  await expect.poll(async () => {
    const processes = await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Get-Process -Name Lume -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id'], { windowsHide: true });
    return processes.stdout.trim();
  }).toBe('');
  await run(installer, ['/S', `/D=${destination}`]); expect(await Promise.all(files.map(hash))).toEqual(before); console.log('Reinstalação preservou livro, notas, cartões e progresso.');
  app = await _electron.launch({ executablePath: executable, args: [], env }); window = await app.firstWindow(); await expect(window.getByRole('heading', { name: /Sua próxima página/ })).toBeVisible(); await window.locator('.document-card-main').click(); await expect(window.getByLabel('Página atual', { exact: true })).toHaveValue('2'); expect((await window.evaluate(id => window.lume.readNotebook(id), book.id)).bookmarks[0].label).toBe('Preservado na reinstalação'); expect((await window.evaluate(id => window.lume.readStudy(id), book.id)).book.cards).toHaveLength(1); await app.close(); app = null;
  const beforeUninstall = await Promise.all(files.map(hash));
  await run(path.join(destination, 'Uninstall Lume.exe'), ['/S', '/KEEP_APP_DATA']); await expect.poll(() => stat(executable).then(() => true, () => false)).toBe(false); installed = false; expect(await Promise.all(files.map(hash))).toEqual(beforeUninstall); console.log('Desinstalação preservou os dados e removeu o programa de teste.');
} finally {
  await app?.close();
  if (installed && await stat(path.join(destination, 'Uninstall Lume.exe')).then(() => true, () => false)) await run(path.join(destination, 'Uninstall Lume.exe'), ['/S', '/KEEP_APP_DATA']);
  for (const saved of savedLinks) await copyFile(saved.backup, saved.link);
  if (originalHash !== await hash(realCatalog).catch(() => null)) throw new Error('O catálogo pessoal mudou durante o teste. Confira antes de continuar.');
}
console.log('Instalador validado; a biblioteca pessoal permaneceu intacta.');
