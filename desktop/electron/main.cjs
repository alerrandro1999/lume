const { app, BrowserWindow, dialog, globalShortcut, ipcMain, Menu, net, protocol, screen, session, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { constants: { COPYFILE_EXCL } } = require('node:fs');
const { pathToFileURL } = require('node:url');
const { Library } = require('./library.cjs');
const { Notebooks } = require('./notebook.cjs');
const { Speech } = require('./speech.cjs');
const { Ocr } = require('./ocr.cjs');
const { validateEpub } = require('./epub-validation.cjs');
const { Study } = require('./study.cjs');
const { lookup } = require('./lookup.cjs');
const { exportNotes, safeName } = require('./export-notes.cjs');
const { Audiobooks } = require('./audiobook.cjs');
const { Workspace } = require('./workspace.cjs');
const { AudioPlayer } = require('./audio-player.cjs');
const { SearchIndex } = require('./search-index.cjs');
const { Updates } = require('./updates.cjs');
const { Transcriptions } = require('./transcription.cjs');
const { importFormats } = require('./transcription-media.cjs');
const { BibliographicReviews } = require('./bibliography.cjs');
const { formats: bibliographyFormats } = require('./bibliography-import.cjs');
const { AcademicPlanner } = require('./planner.cjs');
const { Presentations } = require('./presentations.cjs');
const { ConceptMaps, conceptSources, conceptSvg } = require('./concept-maps.cjs');
const { ResearchProjects } = require('./research-projects.cjs');
const { AcademicPortfolio, portfolioHtml } = require('./portfolio.cjs');
const { AcademicWriting, review: reviewWriting } = require('./academic-writing.cjs');
const { writingHtml, docx: writingDocx, writeExport: writeWritingExport } = require('./writing-export.cjs');

app.setName('Lume');
if (process.platform === 'win32' && !process.windowsStore) {
  app.setAppUserModelId('com.lume.reader');
}
const testing = process.env.LUME_TEST_MODE === '1';
if (testing && process.env.LUME_USER_DATA) app.setPath('userData', process.env.LUME_USER_DATA);
protocol.registerSchemesAsPrivileged([
  { scheme: 'lume', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

let mainWindow;
let floatingWindow;
let floatingBounds;
let floatingState;
let readerHiddenForPlayer = false;
let quitting = false;
let library;
let notebooks;
let ocr;
let study;
let workspace;
let player;
let searchIndex;
let updates;
let transcriptions;
let bibliography;
let planner;
let presentations;
let conceptMaps;
let researchProjects;
let portfolio;
let writing;
const writingPrints = new Map();
const portfolioPrints = new Map();
let closeAfterPresentation = false;
let quitAfterPresentation = false;
let narrationTimer;
let mediaKeySource = null;
const exportedPaths = new Set();
const audiobooks = new Audiobooks(progress => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('audiobook:progress', progress); });
const speech = new Speech();
const devUrl = !app.isPackaged ? process.env.LUME_DEV_URL : undefined;
const entryUrl = devUrl || 'lume://app/index.html';
const floatingUrl = new URL('floating-player.html', entryUrl).href;
function isAppUrl(value) {
  try {
    const actual = new URL(value);
    const expected = new URL(entryUrl);
    return actual.protocol === expected.protocol && actual.host === expected.host;
  } catch { return false; }
}
const hasLock = testing || app.requestSingleInstanceLock();
if (!hasLock) app.quit();

function verifySender(event, window) {
  if (!window || window.isDestroyed() || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) {
    throw new Error('Solicitação não autorizada.');
  }
  if (!isAppUrl(event.senderFrame.url) || (window === floatingWindow && event.senderFrame.url !== floatingUrl)) {
    throw new Error('Origem não autorizada.');
  }
}

function showReader() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  readerHiddenForPlayer = false;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
}

async function openFloatingPlayer(state) {
  if (!['file', 'narration'].includes(state?.source)) throw new Error('Origem de áudio inválida.');
  floatingState = state;
  if (floatingWindow) {
    mainWindow.webContents.send('player:floating-source', state.source);
    floatingWindow.webContents.send('floating-player:state', state);
    if (floatingWindow.isVisible()) floatingWindow.focus();
    return;
  }
  const reader = mainWindow;
  const readerContents = reader.webContents;
  const wasThrottled = readerContents.getBackgroundThrottling();
  const width = 368, height = 162;
  const area = screen.getDisplayMatching(floatingBounds || reader.getBounds()).workArea;
  const x = Math.max(area.x, Math.min(floatingBounds?.x ?? area.x + area.width - width - 20, area.x + area.width - width));
  const y = Math.max(area.y, Math.min(floatingBounds?.y ?? area.y + area.height - height - 20, area.y + area.height - height));
  const window = new BrowserWindow({
    title: 'Audiobook — Lume', x, y, width, height,
    frame: false, resizable: false, maximizable: false, minimizable: false, fullscreenable: false,
    alwaysOnTop: true, skipTaskbar: true, show: false, backgroundColor: '#222b22',
    webPreferences: {
      preload: path.join(__dirname, 'floating-player-preload.cjs'),
      contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false,
    },
  });
  floatingWindow = window;
  readerContents.send('player:floating-source', state.source);
  readerContents.setBackgroundThrottling(false);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.on('close', () => { floatingBounds = window.getBounds(); });
  window.on('closed', () => {
    floatingWindow = null;
    floatingState = null;
    if (readerContents.isDestroyed()) return;
    readerContents.setBackgroundThrottling(wasThrottled);
    if (quitting || updates?.state.stage === 'installing') return;
    readerContents.send('player:floating-source', null);
    if (readerHiddenForPlayer) showReader();
  });
  try {
    await window.loadURL(floatingUrl);
    if (!window.isDestroyed()) window.show();
  } catch (error) {
    if (!window.isDestroyed()) window.destroy();
    throw error;
  }
}

async function readBook(filePath, options = {}) {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath) || !['.pdf', '.epub'].includes(path.extname(filePath).toLowerCase())) {
    throw new Error('Escolha um arquivo PDF ou EPUB válido.');
  }
  const format = path.extname(filePath).toLowerCase() === '.epub' ? 'epub' : 'pdf';
  const canonicalPath = await fs.realpath(filePath);
  const handle = await fs.open(canonicalPath, 'r');
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new Error('Este caminho não é um arquivo.');
    if (info.size > 300 * 1024 * 1024) throw new Error('Nesta versão, abra livros de até 300 MB.');
    const header = Buffer.alloc(Math.min(info.size, 1024));
    await handle.read(header, 0, header.length, 0);
    if (format === 'pdf' && !header.includes(Buffer.from('%PDF-'))) throw new Error('O arquivo não contém um PDF válido.');
    const data = await handle.readFile();
    // The positional header read above leaves the file cursor at zero.
    if (data.length !== info.size) throw new Error('Não foi possível ler o documento completo.');
    if (format === 'epub') await validateEpub(data);
    if (options.readOnly) return { entry: { ...options.entry }, data: new Uint8Array(data) };
    const record = await library.acquire(canonicalPath, data, format, options);
    return options.metadataOnly ? record : { ...record, data: new Uint8Array(data) };
  } finally {
    await handle.close();
  }
}

function registerIpc() {
  const handle = (channel, action) => ipcMain.handle(channel, (event, ...args) => {
    verifySender(event, mainWindow);
    if (updates?.state.stage === 'installing' && !channel.startsWith('updates:') && !['speech:cancel', 'ocr:cancel'].includes(channel)) throw new Error('A atualização está sendo instalada. Aguarde o reinício do Lume.');
    if (workspace?.job && ['restore', 'move', 'delete'].includes(workspace.job.kind) && !channel.startsWith('workspace:') && !channel.startsWith('presentations:') && !channel.startsWith('concept-maps:') && !channel.startsWith('research:') && !channel.startsWith('portfolio:') && !channel.startsWith('writing:') && !['library:list', 'player:list', 'search:status', 'search:query', 'speech:cancel', 'ocr:cancel'].includes(channel)) throw new Error('A biblioteca está sendo atualizada. Aguarde a conclusão.');
    return action(...args);
  });
  handle('updates:status', () => updates.read());
  handle('updates:check', () => updates.check());
  handle('updates:download', () => updates.download());
  handle('updates:install', () => updates.install());
  handle('writing:list', () => writing.list());
  handle('writing:open', id => writing.open(id));
  handle('writing:stage', (id, value, token) => writing.stage(id, value, token));
  handle('writing:flush', id => writing.flush(id));
  handle('writing:remove', id => writing.remove(id));
  handle('writing:options', () => ({ projects: researchProjects.list().map(p => ({id:p.id,title:p.title})), maps: conceptMaps.list().map(p => ({id:p.id,title:p.title})) }));
  handle('writing:create', value => {
    const project = value.projectId ? researchProjects.open(value.projectId) : null, map = value.mapId ? conceptMaps.open(value.mapId) : null;
    return writing.create(value, {projectId:project?.id || '',projectTitle:project?.title || '',topic:project?.plan.topic || '',problem:project?.plan.problem || '',objective:project?.plan.generalObjective || '',methodology:project?.plan.methodology || '',mapId:map?.id || '',mapTitle:map?.title || ''});
  });
  handle('writing:sources', query => {
    if (typeof query !== 'string' || query.length > 200) throw new Error('Busca inválida.');
    const term = query.trim().toLocaleLowerCase('pt-BR'), matches = item => `${item.title} ${item.authors}`.toLocaleLowerCase('pt-BR').includes(term), results = [];
    for (const book of library.list()) { const item = {source:{kind:'book',id:book.id},title:book.title || book.name,authors:book.author || '',year:'',journal:'',doi:'',url:''}; if (matches(item)) results.push(item); if (results.length >= 100) break; }
    for (const project of bibliography.list()) { if (results.length >= 100) break; for (const record of bibliography.get(project.id).records) { const item = {source:{kind:'review',id:project.id,recordId:record.id},...Object.fromEntries(['title','authors','year','journal','doi','url'].map(key => [key,String(record[key] || '').slice(0,4000)]))}; if (matches(item)) results.push(item); if (results.length >= 100) break; } }
    return results;
  });
  handle('writing:citation', (id, source, value) => {
    researchSource(source); let metadata;
    if (source.kind === 'book') { const book = library.find(source.id); metadata = {title:book.title || book.name,authors:book.author || '',year:'',journal:'',doi:'',url:''}; }
    else if (source.kind === 'review' && source.recordId) { const record = bibliography.reference(source.id, source.recordId); metadata = Object.fromEntries(['title','authors','year','journal','doi','url'].map(key => [key,String(record[key] || '').slice(0,4000)])); }
    else throw new Error('Escolha um livro ou uma referência da bancada.');
    return writing.addCitation(id, {source,...metadata}, value);
  });
  handle('writing:remove-citation', (id, citationId) => writing.removeCitation(id,citationId));
  handle('writing:open-source', source => { researchSource(source); if (source.kind === 'review' && source.recordId) bibliography.reference(source.id,source.recordId); return source; });
  handle('writing:version', (id, label) => writing.version(id,label));
  handle('writing:restore', (id, versionId) => writing.restore(id,versionId));
  handle('writing:remove-version', (id, versionId) => writing.removeVersion(id,versionId));
  handle('writing:review', id => reviewWriting(writing.flush(id)));
  handle('writing:export', async (id,format) => {
    if (!['pdf','docx'].includes(format)) throw new Error('Formato inválido.');
    const doc = writing.flush(id);
    if (!doc.sections.some(s => s.include && s.blocks.some(b => b.runs.some(r => r.text.trim() || r.citationId)))) throw new Error('Escreva em uma seção incluída na exportação antes de exportar.');
    const result = await dialog.showSaveDialog(mainWindow,{title:'Exportar texto acadêmico',defaultPath:`${safeName(doc.title)}.${format}`,filters:[{name:format.toUpperCase(),extensions:[format]}]});
    if (result.canceled || !result.filePath) return null;
    if (format === 'docx') await writeWritingExport(result.filePath,await writingDocx(doc));
    else {
      const token = randomUUID(), address = `lume://app/writing-print/${token}`; writingPrints.set(token,writingHtml(doc));
      const printWindow = new BrowserWindow({show:false,width:900,height:1100,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,webSecurity:true,backgroundThrottling:false,spellcheck:false}});
      printWindow.webContents.setWindowOpenHandler(() => ({action:'deny'})); printWindow.webContents.on('will-navigate',(event,url) => {if (url !== address) event.preventDefault();});
      try { await printWindow.loadURL(address); await printWindow.webContents.executeJavaScript('document.fonts.ready.then(() => true)'); const buffer = await printWindow.webContents.printToPDF({printBackground:true,preferCSSPageSize:true,displayHeaderFooter:true,headerTemplate:'<span></span>',footerTemplate:'<div style="width:100%;text-align:center;font-size:9px"><span class="pageNumber"></span></div>'}); await writeWritingExport(result.filePath,buffer); }
      finally { writingPrints.delete(token); if (!printWindow.isDestroyed()) printWindow.destroy(); }
    }
    return result.filePath;
  });
  handle('portfolio:read', () => portfolio.read());
  handle('portfolio:profile', value => portfolio.saveProfile(value));
  handle('portfolio:preferences', value => portfolio.savePreferences(value));
  handle('portfolio:entry', (id, value) => portfolio.saveEntry(id, value));
  handle('portfolio:remove-entry', id => portfolio.removeEntry(id));
  handle('portfolio:toggle', (id, visible) => portfolio.toggle(id, visible));
  handle('portfolio:move', (id, delta) => portfolio.move(id, delta));
  handle('portfolio:skill', (id, value) => portfolio.saveSkill(id, value));
  handle('portfolio:remove-skill', id => portfolio.removeSkill(id));
  handle('portfolio:log', (id, value) => portfolio.saveLog(id, value));
  handle('portfolio:remove-log', id => portfolio.removeLog(id));
  handle('portfolio:projects', () => researchProjects.list().map(item => ({ id: item.id, title: item.title })));
  handle('portfolio:import-project', id => portfolio.importProject(researchProjects.open(id)));
  handle('portfolio:open-project', id => { researchProjects.get(id); return id; });
  handle('portfolio:evidence', async id => {
    portfolio.entry(id);
    const result = await dialog.showOpenDialog(mainWindow, { title: 'Adicionar comprovantes', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Comprovantes', extensions: ['pdf', 'png', 'jpg', 'jpeg', 'docx'] }] });
    return result.canceled ? null : portfolio.addEvidence(id, result.filePaths);
  });
  handle('portfolio:remove-evidence', id => portfolio.removeEvidence(id));
  handle('portfolio:open-evidence', async id => {
    const file = portfolio.fileFor(portfolio.evidence(id));
    try { const info = await fs.stat(file); if (!info.isFile()) throw new Error(); } catch { throw new Error('A cópia do comprovante não está disponível. Adicione o arquivo novamente.'); }
    if (await shell.openPath(file)) throw new Error('Não foi possível abrir o comprovante. Confira o aplicativo associado a este formato.');
  });
  handle('portfolio:open-url', id => { const entry = portfolio.entry(id); if (!entry.url) throw new Error('Este registro não tem link.'); return shell.openExternal(entry.url); });
  handle('portfolio:preview', () => portfolioHtml(portfolio.read()));
  handle('portfolio:export', async format => {
    if (!['pdf', 'html', 'csv'].includes(format)) throw new Error('Formato de exportação inválido.');
    const data = portfolio.read();
    if (format !== 'csv' && !data.profile.name) throw new Error('Preencha e salve seu nome no perfil antes de exportar o portfólio.');
    const result = await dialog.showSaveDialog(mainWindow, { title: format === 'csv' ? 'Exportar diário de estágio' : 'Exportar portfólio', defaultPath: `${safeName(format === 'csv' ? 'Diário de estágio' : data.profile.name + ' - Portfólio')}.${format}`, filters: [{ name: format === 'pdf' ? 'Documento PDF' : format === 'html' ? 'Página HTML' : 'Diário CSV', extensions: [format] }] });
    if (result.canceled || !result.filePath) return null;
    let output;
    if (format === 'csv') output = portfolio.csv();
    else if (format === 'html') output = portfolioHtml(data);
    else {
      const token = randomUUID(), address = `lume://app/portfolio-print/${token}`;
      portfolioPrints.set(token, portfolioHtml(data));
      const printWindow = new BrowserWindow({ show: false, width: 900, height: 1100, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, backgroundThrottling: false, spellcheck: false } });
      printWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      printWindow.webContents.on('will-navigate', (event, url) => { if (url !== address) event.preventDefault(); });
      try {
        await printWindow.loadURL(address);
        await printWindow.webContents.executeJavaScript('document.fonts.ready.then(() => true)');
        output = await printWindow.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true, displayHeaderFooter: true, headerTemplate: '<span></span>', footerTemplate: '<div style="width:100%;font-family:Arial;font-size:8px;color:#7b8996;text-align:center">Portfólio acadêmico · <span class="pageNumber"></span> / <span class="totalPages"></span></div>' });
      } finally { portfolioPrints.delete(token); if (!printWindow.isDestroyed()) printWindow.destroy(); }
    }
    await fs.writeFile(result.filePath, output, typeof output === 'string' ? 'utf8' : undefined); return result.filePath;
  });
  function researchSource(source) {
    if (!source || typeof source.id !== 'string') throw new Error('Material inválido.');
    if (source.kind === 'book') { if (!library.find(source.id)) throw new Error('Este livro não está mais na biblioteca.'); }
    else if (source.kind === 'lesson') transcriptions.open(source.id);
    else if (source.kind === 'review') bibliography.get(source.id);
    else if (source.kind === 'map') conceptMaps.open(source.id);
    else if (source.kind === 'presentation') presentations.project(source.id);
    else throw new Error('Material inválido.');
    return { kind: source.kind, id: source.id };
  }
  handle('research:list', () => researchProjects.list());
  handle('research:open', id => researchProjects.open(id));
  handle('research:create', value => researchProjects.create(value));
  handle('research:settings', (id, value) => researchProjects.saveSettings(id, value));
  handle('research:plan', (id, value) => researchProjects.savePlan(id, value));
  handle('research:remove', id => researchProjects.remove(id));
  handle('research:stage', (id, stageId, value) => researchProjects.saveStage(id, stageId, value));
  handle('research:remove-stage', (id, stageId) => researchProjects.removeStage(id, stageId));
  handle('research:task', (id, taskId, value) => researchProjects.saveTask(id, taskId, value));
  handle('research:move', (id, taskId, status) => researchProjects.moveTask(id, taskId, status));
  handle('research:remove-task', (id, taskId) => researchProjects.removeTask(id, taskId));
  handle('research:meeting', (id, meetingId, value, createTasks) => researchProjects.saveMeeting(id, meetingId, value, createTasks));
  handle('research:remove-meeting', (id, meetingId) => researchProjects.removeMeeting(id, meetingId));
  handle('research:sources', () => [
    ...library.list().map(item => ({ kind: 'book', id: item.id, title: item.title || item.name })),
    ...transcriptions.list().map(item => ({ kind: 'lesson', id: item.id, title: item.name })),
    ...bibliography.list().map(item => ({ kind: 'review', id: item.id, title: item.title })),
    ...conceptMaps.list().map(item => ({ kind: 'map', id: item.id, title: item.title })),
    ...presentations.read().map(item => ({ kind: 'presentation', id: item.id, title: item.title })),
  ]);
  handle('research:material', (id, value) => { if (value?.kind === 'hub') researchSource(value.source); return researchProjects.addMaterial(id, value); });
  handle('research:files', async id => {
    researchProjects.get(id);
    const result = await dialog.showOpenDialog(mainWindow, { title: 'Adicionar arquivos ao projeto', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Documentos e imagens', extensions: ['pdf', 'docx', 'odt', 'txt', 'md', 'pptx', 'xlsx', 'csv', 'png', 'jpg', 'jpeg'] }] });
    return result.canceled ? null : researchProjects.addFiles(id, result.filePaths);
  });
  handle('research:open-material', async (id, materialId) => {
    const material = researchProjects.material(id, materialId);
    if (material.kind === 'hub') return researchSource(material.source);
    if (material.kind === 'link') { await shell.openExternal(new URL(material.url).href); return null; }
    const file = researchProjects.fileFor(material);
    try { const info = await fs.stat(file); if (!info.isFile()) throw new Error(); } catch { throw new Error('A cópia deste arquivo não está disponível. Adicione o arquivo novamente ao projeto.'); }
    const problem = await shell.openPath(file);
    if (problem) throw new Error('Não foi possível abrir este arquivo. Confira se há um aplicativo compatível instalado.');
    return null;
  });
  handle('research:remove-material', (id, materialId) => researchProjects.removeMaterial(id, materialId));
  handle('research:export', async (id, format) => {
    if (!['md', 'csv'].includes(format)) throw new Error('Formato de exportação inválido.');
    const project = researchProjects.get(id);
    const result = await dialog.showSaveDialog(mainWindow, { title: 'Exportar projeto', defaultPath: `${safeName(project.title)}.${format}`, filters: [{ name: format === 'md' ? 'Relatório Markdown' : 'Tarefas CSV', extensions: [format] }] });
    if (result.canceled || !result.filePath) return null;
    await fs.writeFile(result.filePath, format === 'md' ? researchProjects.report(id) : researchProjects.csv(id), 'utf8'); return result.filePath;
  });
  handle('concept-maps:list', () => conceptMaps.list());
  handle('concept-maps:open', id => conceptMaps.open(id));
  handle('concept-maps:create', title => conceptMaps.create(title));
  handle('concept-maps:save', (id, value) => conceptMaps.save(id, value));
  handle('concept-maps:remove', id => conceptMaps.remove(id));
  handle('concept-maps:sources', query => conceptSources(library, bibliography, query));
  handle('concept-maps:resolve', source => {
    if (source?.kind === 'book' && library.find(source.id)) return { kind: 'book', id: source.id };
    if (source?.kind === 'review') {
      bibliography.get(source.id);
      if (source.recordId) bibliography.reference(source.id, source.recordId);
      return { kind: 'review', id: source.id, ...(source.recordId ? { recordId: source.recordId } : {}) };
    }
    throw new Error('O material vinculado não está mais disponível neste computador. Você pode manter o bloco ou escolher outra fonte.');
  });
  handle('concept-maps:import', async () => {
    const result = await dialog.showOpenDialog(mainWindow, { title: 'Importar mapa conceitual', properties: ['openFile'], filters: [{ name: 'Mapa do Lume', extensions: ['json'] }] });
    if (result.canceled || !result.filePaths.length) return null;
    const file = result.filePaths[0];
    const info = await fs.stat(file);
    if (!info.isFile() || info.size > 8 * 1024 ** 2) throw new Error('Importe um mapa JSON com até 8 MB.');
    const data = await fs.readFile(file, 'utf8');
    if (Buffer.byteLength(data) > 8 * 1024 ** 2) throw new Error('Importe um mapa JSON com até 8 MB.');
    let parsed;
    try { parsed = JSON.parse(data); } catch { throw new Error('Não foi possível ler este JSON. Selecione um mapa exportado pelo Lume.'); }
    return conceptMaps.import(parsed);
  });
  handle('concept-maps:export', async (id, format) => {
    if (!['json', 'svg'].includes(format)) throw new Error('Formato de exportação inválido.');
    const map = conceptMaps.open(id);
    const result = await dialog.showSaveDialog(mainWindow, { title: 'Exportar mapa conceitual', defaultPath: `${safeName(map.title)}.${format}`, filters: [{ name: format === 'svg' ? 'Imagem vetorial SVG' : 'Mapa editável do Lume', extensions: [format] }] });
    if (result.canceled || !result.filePath) return null;
    await fs.writeFile(result.filePath, format === 'svg' ? conceptSvg(map) : conceptMaps.json(id), 'utf8');
    return result.filePath;
  });
  handle('presentations:list', () => presentations.read());
  handle('presentations:save', (id, value) => presentations.save(id, value));
  handle('presentations:remove', id => presentations.remove(id));
  handle('presentations:begin', (id, audio) => presentations.begin(id, audio));
  handle('presentations:append', (id, index, bytes) => presentations.append(id, index, bytes));
  handle('presentations:checkpoint', id => presentations.checkpoint(id));
  handle('presentations:pause', (id, paused) => presentations.pause(id, paused));
  handle('presentations:section', (id, section) => presentations.section(id, section));
  function afterPresentation(result) {
    if (quitAfterPresentation) { quitAfterPresentation = false; closeAfterPresentation = false; setImmediate(() => app.quit()); }
    else if (closeAfterPresentation) { closeAfterPresentation = false; setImmediate(() => mainWindow?.close()); }
    return result;
  }
  handle('presentations:finish', id => afterPresentation(presentations.finish(id)));
  handle('presentations:cancel', id => afterPresentation(presentations.cancel(id)));
  handle('presentations:assess', (id, value) => presentations.assess(id, value));
  handle('presentations:remove-take', id => presentations.removeTake(id));
  handle('presentations:export', async (id, format) => {
    if (!['audio', 'report'].includes(format)) throw new Error('Formato de exportação inválido.');
    if (presentations.active?.id === id) throw new Error('Finalize o ensaio antes de exportar.');
    const take = presentations.findTake(id);
    if (format === 'audio' && !presentations.availableAudio(take)) throw new Error('Este ensaio não tem gravação de áudio.');
    const extension = format === 'audio' ? 'webm' : 'md';
    const result = await dialog.showSaveDialog(mainWindow, {
      title: format === 'audio' ? 'Exportar áudio do ensaio' : 'Exportar relatório do ensaio',
      defaultPath: `${safeName(take.script.title)} - ensaio.${extension}`,
      filters: [{ name: format === 'audio' ? 'Áudio WebM' : 'Markdown', extensions: [extension] }],
    });
    if (result.canceled || !result.filePath) return null;
    if (format === 'audio') await fs.copyFile(presentations.audioFile(id), result.filePath);
    else await fs.writeFile(result.filePath, presentations.report(id), 'utf8');
    return result.filePath;
  });
  handle('planner:read', () => planner.read());
  handle('planner:save-course', (id, value) => planner.saveCourse(id, value));
  handle('planner:remove-course', id => planner.removeCourse(id));
  handle('planner:save-task', (id, value) => planner.saveTask(id, value));
  handle('planner:complete-task', (id, completed) => planner.completeTask(id, completed));
  handle('planner:remove-task', id => planner.removeTask(id));
  handle('planner:save-goal', (week, target) => planner.saveGoal(week, target));
  handle('planner:materials', () => [
    ...library.list().map(item => ({ kind: 'book', id: item.id, title: item.title || item.name })),
    ...transcriptions.list().map(item => ({ kind: 'lesson', id: item.id, title: item.name })),
    ...bibliography.list().map(item => ({ kind: 'review', id: item.id, title: item.title })),
  ]);
  handle('bibliography:list', () => bibliography.list());
  handle('bibliography:create', title => bibliography.create(title));
  handle('bibliography:open', id => bibliography.open(id));
  handle('bibliography:configure', (id, value) => bibliography.configure(id, value));
  handle('bibliography:references', (id, filter) => bibliography.references(id, filter));
  handle('bibliography:reference', (id, recordId) => bibliography.reference(id, recordId));
  handle('bibliography:update', (id, recordId, value) => bibliography.update(id, recordId, value));
  handle('bibliography:import', async (id, origin) => {
    bibliography.get(id);
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Importar referências bibliográficas', buttonLabel: 'Importar referências', properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Referências RIS, BibTeX e CSV', extensions: bibliographyFormats }],
    });
    return result.canceled || !result.filePaths.length ? null : bibliography.import(id, result.filePaths, origin);
  });
  handle('bibliography:source', (id, recordId) => shell.openExternal(bibliography.sourceUrl(id, recordId)));
  handle('bibliography:export', async (id, format) => {
    const data = bibliography.export(id, format);
    const { title } = bibliography.open(id);
    const label = format === 'evidence' ? 'Tabela de evidências' : 'Contagens PRISMA';
    const result = await dialog.showSaveDialog(mainWindow, {
      title: `Exportar ${label.toLowerCase()}`, defaultPath: `${safeName(title)} - ${label}.csv`, filters: [{ name: 'CSV', extensions: ['csv'] }],
    });
    if (result.canceled || !result.filePath) return null;
    await fs.writeFile(result.filePath, data, 'utf8');
    return result.filePath;
  });
  handle('transcription:list', () => transcriptions.list());
  handle('transcription:open', id => transcriptions.open(id));
  handle('transcription:import', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Importar gravação', buttonLabel: 'Importar gravação', properties: ['openFile'],
      filters: [{ name: 'Gravações MP3, WAV, FLAC, MP4 e M4A', extensions: importFormats }],
    });
    return result.canceled || !result.filePaths[0] ? null : transcriptions.importAudio(result.filePaths[0]);
  });
  handle('transcription:start', (id, language, quality) => transcriptions.transcribe(id, language, quality));
  handle('transcription:retry-range', (id, language, quality, value) => {
    if (!value || typeof value !== 'object') throw new Error('Selecione um intervalo válido.');
    return transcriptions.transcribe(id, language, quality, value);
  });
  handle('transcription:apply-range', (id, value) => transcriptions.replaceRange(id, value));
  handle('transcription:organize', (id, course) => transcriptions.organize(id, course));
  handle('transcription:search', (query, course) => transcriptions.search(query, course));
  handle('transcription:glossary', id => transcriptions.study.terms(transcriptions.get(id).course));
  handle('transcription:save-glossary', (id, text) => transcriptions.saveGlossary(id, text));
  handle('transcription:make-card', (id, markId, value) => { transcriptions.card(id, markId, value); });
  handle('transcription:cards', () => transcriptions.cards());
  handle('transcription:review-card', (id, grade) => { transcriptions.study.revise(id, grade); return transcriptions.cards(); });
  handle('transcription:remove-card', id => { transcriptions.study.remove(id); return transcriptions.cards(); });
  handle('transcription:export-anki', async () => {
    const data = transcriptions.study.anki();
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Exportar cartões de aula para o Anki', defaultPath: 'Cartões de aulas.tsv', filters: [{ name: 'Texto separado por tabulações', extensions: ['tsv'] }],
    });
    if (result.canceled || !result.filePath) return null;
    await fs.writeFile(result.filePath, data, 'utf8');
    return result.filePath;
  });
  handle('transcription:cancel', id => transcriptions.cancel(id));
  handle('transcription:edit', (id, index, value) => transcriptions.edit(id, index, value));
  handle('transcription:save-mark', (id, markId, value) => transcriptions.saveMark(id, markId, value));
  handle('transcription:remove-mark', (id, markId) => transcriptions.removeMark(id, markId));
  handle('transcription:export', async (id, format) => {
    const data = transcriptions.exportText(id, format);
    const { name } = transcriptions.open(id);
    const result = await dialog.showSaveDialog(mainWindow, {
      title: format === 'srt' ? 'Exportar legendas' : 'Exportar transcrição',
      defaultPath: `${safeName(path.parse(name).name)} - transcrição.${format}`,
      filters: [{ name: format === 'srt' ? 'Legendas SRT' : 'Texto TXT', extensions: [format] }],
    });
    if (result.canceled || !result.filePath) return null;
    await fs.writeFile(result.filePath, data, 'utf8');
    return result.filePath;
  });
  handle('transcription:remove', async id => {
    const { name } = transcriptions.open(id);
    const result = await dialog.showMessageBox(mainWindow, {
      type: 'warning', title: 'Excluir projeto', message: `Excluir “${name}” do Estúdio?`,
      detail: 'A transcrição e a cópia do áudio no Estúdio serão apagadas. O arquivo original continuará na pasta de origem.',
      buttons: ['Cancelar', 'Excluir projeto'], defaultId: 0, cancelId: 0, noLink: true,
    });
    return result.response === 1 ? transcriptions.remove(id) : null;
  });
  handle('book:choose', async (mode = 'import') => {
    if (!['import', 'external'].includes(mode)) throw new Error('Modo de abertura inválido.');
    const result = await dialog.showOpenDialog(mainWindow, {
      title: mode === 'import' ? 'Importar para a biblioteca' : 'Abrir sem copiar', buttonLabel: mode === 'import' ? 'Importar livro' : 'Abrir sem copiar', properties: ['openFile'],
      filters: [{ name: 'Livros PDF e EPUB', extensions: ['pdf', 'epub'] }, { name: 'PDF', extensions: ['pdf'] }, { name: 'EPUB', extensions: ['epub'] }],
    });
    return result.canceled ? null : readBook(result.filePaths[0], { mode });
  });
  handle('book:drop', filePath => readBook(filePath));
  handle('book:recent', id => {
    const entry = library.find(id);
    if (!entry) throw new Error('Documento não encontrado na biblioteca.');
    return readBook(library.pathFor(entry), { mode: 'recent', entryId: id });
  });
  handle('book:import-existing', async id => {
    const entry = library.find(id); if (!entry) throw new Error('Livro não encontrado.');
    try { return await readBook(library.pathFor(entry), { mode: 'import', entryId: id }); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const result = await dialog.showOpenDialog(mainWindow, { title: `Localizar ${entry.name} para importar`, buttonLabel: 'Localizar e importar', properties: ['openFile'], filters: [{ name: entry.format === 'epub' ? 'EPUB' : 'PDF', extensions: [entry.format === 'epub' ? 'epub' : 'pdf'] }] });
      return result.canceled ? null : readBook(result.filePaths[0], { mode: 'import', entryId: id });
    }
  });
  handle('library:show-books', async () => {
    const folder = library.booksDirectory(); await fs.mkdir(folder, { recursive: true });
    const error = await shell.openPath(folder); if (error) throw new Error('Não foi possível abrir a pasta dos livros.');
  });
  handle('library:list', () => library.list());
  handle('book:content', id => { const entry = library.find(id); if (!entry) throw new Error('Livro não encontrado.'); return readBook(library.pathFor(entry), { readOnly: true, entry }); });
  handle('library:describe', (id, value) => { const entry = library.find(id); if (!entry || !Number.isInteger(value?.pages) || value.pages < 1 || value.pages > 100000) throw new Error('Descrição inválida.'); entry.totalPages = value.pages; entry.page = Math.min(entry.page, value.pages); if (typeof value.title === 'string' && entry.format === 'epub') entry.title = value.title.slice(0, 300); if (typeof value.author === 'string') entry.author = value.author.slice(0, 300); library.save(); });
  handle('search:status', () => searchIndex.status());
  handle('search:fingerprint', id => { const entry = library.find(id); if (!entry) throw new Error('Livro não encontrado.'); return searchIndex.fingerprint(entry); });
  handle('search:save', (id, units, fingerprint) => searchIndex.save(id, units, fingerprint));
  handle('search:query', (query, scope) => searchIndex.query(query, scope));
  handle('workspace:cancel', () => workspace.cancel());
  handle('workspace:storage', () => workspace.storage());
  handle('workspace:delete-copy', key => workspace.deleteCopy(key));
  handle('workspace:import-files', async () => {
    const result = await dialog.showOpenDialog(mainWindow, { title: 'Importar vários livros', properties: ['openFile', 'multiSelections'], filters: [{ name: 'PDF e EPUB', extensions: ['pdf', 'epub'] }] });
    return result.canceled ? null : workspace.batch(result.filePaths, readBook);
  });
  handle('workspace:import-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, { title: 'Importar livros de uma pasta e subpastas', properties: ['openDirectory'] });
    if (result.canceled) return null;
    const scan = await workspace.run('scan', job => workspace.scan(result.filePaths[0], job)); return workspace.batch(scan.files, readBook, scan.ignored);
  });
  handle('workspace:move', async removeOld => { if (typeof removeOld !== 'boolean') throw new Error('Opção inválida.'); const result = await dialog.showOpenDialog(mainWindow, { title: 'Escolha a nova pasta (será criada a subpasta Lume Livros)', properties: ['openDirectory', 'createDirectory'] }); return result.canceled ? null : workspace.relocate(result.filePaths[0], removeOld); });
  handle('workspace:backup', async (prefs, options) => { if (audiobooks.job) throw new Error('Conclua ou cancele a geração de áudio antes do backup.'); const result = await dialog.showSaveDialog(mainWindow, { title: 'Salvar backup da biblioteca', defaultPath: `Lume-backup-${new Date().toISOString().slice(0, 10)}.zip`, filters: [{ name: 'Backup ZIP do Lume', extensions: ['zip'] }] }); if (result.canceled || !result.filePath) return null; const saved = await workspace.createBackup(result.filePath, prefs, options); exportedPaths.add(result.filePath); return saved; });
  handle('workspace:preview-restore', async () => { const result = await dialog.showOpenDialog(mainWindow, { title: 'Conferir backup do Lume', properties: ['openFile'], filters: [{ name: 'Backup ZIP do Lume', extensions: ['zip', 'lumebackup'] }] }); return result.canceled ? null : workspace.preview(result.filePaths[0]); });
  handle('workspace:restore', async id => { if (audiobooks.job) throw new Error('Conclua ou cancele a geração de áudio antes de restaurar.'); player.sleep(0, () => {}); const result = await workspace.restore(id); exportedPaths.add(result.recovery); return result; });
  handle('player:list', () => player.list());
  handle('player:choose', async () => { const result = await dialog.showOpenDialog(mainWindow, { title: 'Abrir audiobooks', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Audiobook e áudio', extensions: ['mp3', 'm4b', 'm4a', 'wav'] }] }); if (result.canceled) return null; const loaded = []; for (const file of result.filePaths) loaded.push(await player.add(file)); return loaded; });
  handle('player:open-export', (directory, index) => player.openExport(directory, index));
  handle('player:list-exports', id => { notebooks.file(id); return player.listExports(id); });
  handle('player:link-export', async id => {
    notebooks.file(id);
    const result = await dialog.showOpenDialog(mainWindow, { title: 'Escolha a pasta do audiobook gerado pelo Lume', properties: ['openDirectory'] });
    if (result.canceled || !result.filePaths[0]) return null;
    return player.linkDirectory(id, result.filePaths[0]);
  });
  handle('player:progress', (id, position, rate) => player.progress(id, position, rate));
  ipcMain.on('player:checkpoint', (event, id, position, rate) => {
    try {
      verifySender(event, mainWindow);
      if (workspace?.job?.kind !== 'restore') player.progress(id, position, rate);
    } catch { /* The periodic position remains available. */ }
    event.returnValue = null;
  });
  handle('player:bookmark', (id, value) => player.bookmark(id, value));
  handle('player:remove-bookmark', (id, mark) => player.removeBookmark(id, mark));
  handle('player:sleep', minutes => player.sleep(minutes, () => mainWindow?.webContents.send('player:sleep-ended')));
  handle('player:media-keys', (source, active) => {
    if (!['file', 'narration'].includes(source) || typeof active !== 'boolean') throw new Error('Origem de áudio inválida.');
    if (!active) {
      if (mediaKeySource === source) {
        mediaKeySource = null;
        globalShortcut.unregister('MediaPlayPause');
      }
      return;
    }
    mediaKeySource = source;
    if (!globalShortcut.isRegistered('MediaPlayPause')) {
      globalShortcut.register('MediaPlayPause', () => {
        if (mainWindow && !mainWindow.isDestroyed() && mediaKeySource && updates?.state.stage !== 'installing' && workspace?.job?.kind !== 'restore') {
          mainWindow.webContents.send('player:media-toggle', mediaKeySource);
        }
      });
    }
  });
  handle('player:floating-open', openFloatingPlayer);
  handle('player:floating-close', source => {
    if (floatingState?.source === source) floatingWindow?.close();
  });
  handle('player:floating-state', state => {
    if (!floatingWindow || state?.source !== floatingState?.source) return;
    floatingState = state;
    floatingWindow.webContents.send('floating-player:state', state);
  });
  ipcMain.handle('floating-player:read', event => {
    verifySender(event, floatingWindow);
    return floatingState;
  });
  ipcMain.handle('floating-player:command', (event, command, position) => {
    verifySender(event, floatingWindow);
    if (command === 'close' || command === 'expand') {
      if (command === 'expand') {
        showReader();
        mainWindow?.webContents.send('player:floating-expand', floatingState.source);
      }
      floatingWindow.close();
      return;
    }
    if (updates?.state.stage === 'installing') return;
    if (workspace?.job?.kind === 'restore') throw new Error('Aguarde a restauração da biblioteca.');
    if (!['toggle', 'rewind', 'forward', 'seek'].includes(command) || (command === 'seek' && !Number.isFinite(position))) {
      throw new Error('Comando de reprodução inválido.');
    }
    mainWindow?.webContents.send('player:floating-command', floatingState.source, command, position);
  });
  handle('library:progress', (id, page, totalPages) => library.progress(id, page, totalPages));
  handle('library:epub-progress', (id, location) => library.epubProgress(id, location));
  handle('library:metadata', (id, metadata) => library.metadata(id, metadata));
  handle('library:remove', id => library.remove(id));
  handle('library:organize', (id, value) => library.organize(id, value));
  handle('study:read', id => study.read(id));
  handle('study:settings', value => study.settings(value));
  handle('study:tick', (id, seconds, sample, data) => study.tick(id, seconds, sample, data));
  handle('study:listen', (id, value) => study.listen(id, value));
  handle('study:glossary', (id, value) => study.glossary(id, value));
  handle('study:crop', (id, value) => study.crop(id, value));
  handle('study:card', (id, value) => study.card(id, value));
  handle('study:remove-card', (id, cardId) => study.removeCard(id, cardId));
  handle('study:review', (id, cardId, grade) => study.review(id, cardId, grade));
  handle('study:lookup', value => lookup(value));
  handle('study:export-notes', async (id, format) => {
    const entry = library.find(id); if (!entry) throw new Error('Livro não encontrado.');
    const result = await exportNotes(mainWindow, entry, notebooks.read(id), format); if (result) exportedPaths.add(result); return result;
  });
  handle('study:show-export', value => {
    if (typeof value !== 'string' || !exportedPaths.has(value) && !player.exports.some(item => item.directory === value)) throw new Error('Exportação não encontrada.');
    shell.showItemInFolder(value);
  });
  handle('study:open-source', value => {
    if (typeof value !== 'string') throw new Error('Fonte inválida.');
    const url = new URL(value);
    if (url.protocol !== 'https:' || !['pt.wiktionary.org', 'mymemory.translated.net'].includes(url.hostname) || url.username || url.password) throw new Error('Fonte inválida.');
    return shell.openExternal(url.href);
  });
  handle('audiobook:export', async (id, chapters, voice) => {
    const entry = library.find(id); if (!entry) throw new Error('Livro não encontrado.');
    if (audiobooks.job) throw new Error('Já existe uma exportação de audiobook em andamento.');
    const result = await dialog.showOpenDialog(mainWindow, { title: 'Escolha onde salvar o audiobook', buttonLabel: 'Salvar audiobook aqui', properties: ['openDirectory', 'createDirectory'] });
    if (result.canceled || !result.filePaths[0]) return null;
    const exported = await audiobooks.export(entry, chapters, voice, result.filePaths[0]);
    exportedPaths.add(exported.directory);
    player.linkExport(id, exported);
    return exported.directory;
  });
  handle('audiobook:cancel', () => audiobooks.cancel());
  handle('notebook:read', id => notebooks.read(id));
  handle('notebook:annotation', (id, annotation) => notebooks.annotation(id, annotation));
  handle('notebook:remove-annotation', (id, annotationId) => notebooks.remove(id, 'annotations', annotationId));
  handle('notebook:bookmark', (id, bookmark) => notebooks.bookmark(id, bookmark));
  handle('notebook:remove-bookmark', (id, bookmarkId) => notebooks.remove(id, 'bookmarks', bookmarkId));
  handle('notebook:review-page', (id, page, update) => notebooks.reviewPage(id, page, update));
  handle('ocr:recognize', async (id, page, image, jobId) => {
    if (library.find(id)?.format === 'epub') throw new Error('O reconhecimento por OCR está disponível para PDFs.');
    notebooks.page(id, page);
    const result = await ocr.recognize(image, jobId);
    return notebooks.ocr(id, page, result);
  });
  handle('ocr:area', (id, page, image, jobId) => {
    if (library.find(id)?.format === 'epub') throw new Error('O reconhecimento por OCR está disponível para PDFs.');
    notebooks.page(id, page);
    return ocr.recognize(image, jobId, 'region');
  });
  handle('ocr:cancel', () => ocr.cancel());
  handle('ocr:save-pdf', async (id, bytes) => {
    const entry = library.find(id);
    if (!entry || entry.format === 'epub' || !(bytes instanceof Uint8Array) || bytes.length > 350 * 1024 * 1024 || Buffer.from(bytes.subarray(0, 5)).toString() !== '%PDF-') {
      throw new Error('PDF pesquisável inválido ou maior que 350 MB.');
    }
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Salvar PDF pesquisável',
      defaultPath: `${safeName(entry.title || path.parse(entry.name).name)} - pesquisável.pdf`,
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (result.canceled || !result.filePath) return null;
    const destination = result.filePath;
    const temporary = path.join(path.dirname(destination), `.lume-pdf-${randomUUID()}.tmp`);
    try {
      await fs.writeFile(temporary, bytes, { flag: 'wx' });
      await fs.copyFile(temporary, destination, COPYFILE_EXCL);
    } catch (error) {
      if (error.code === 'EEXIST') throw new Error('Já existe um arquivo com esse nome. Escolha outro nome para a cópia pesquisável.');
      throw error;
    } finally {
      await fs.unlink(temporary).catch(() => {});
    }
    exportedPaths.add(destination);
    return destination;
  });
  handle('speech:voices', () => speech.voices());
  handle('speech:synthesize', (id, text, voice) => { notebooks.file(id); return speech.synthesize(text, voice); });
  handle('speech:cancel', () => speech.cancel());
  handle('speech:position', (id, value) => study.narration(id, value));
  handle('speech:sleep', minutes => {
    if (![0, 15, 30, 60].includes(minutes)) throw new Error('Temporizador inválido.');
    clearTimeout(narrationTimer);
    if (!minutes) return;
    narrationTimer = setTimeout(() => mainWindow?.webContents.send('speech:sleep-ended'), minutes * 60000);
  });
  ipcMain.on('speech:checkpoint', (event, id, value) => {
    try {
      verifySender(event, mainWindow);
      if (workspace?.job?.kind !== 'restore') study.narration(id, value);
    } catch { /* A periodic checkpoint remains available. */ }
    event.returnValue = null;
  });
}

function requestOpen() { mainWindow?.webContents.send('pdf:open-request'); }

function createWindow() {
  const windowIcon = app.isPackaged
    ? path.join(process.resourcesPath, 'lume.ico')
    : path.join(__dirname, '../resources/branding/lume.ico');
  mainWindow = new BrowserWindow({
    title: 'Hub de aplicativos', width: 1360, height: 900, minWidth: 900, minHeight: 640,
    icon: process.platform === 'win32' ? windowIcon : undefined,
    backgroundColor: '#f8f7f4', show: !testing,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
      spellcheck: false, webSecurity: true, backgroundThrottling: !testing,
    },
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  let closingForAudio = false;
  mainWindow.on('close', event => {
    try { writing?.flushAll(); } catch { event.preventDefault(); dialog.showErrorBox('Há um texto não salvo', 'Não foi possível gravar a Oficina de Escrita. Mantenha o Lume aberto, confira o espaço no disco e use Tentar salvar novamente na oficina.'); return; }
    if (presentations?.active) {
      event.preventDefault();
      closeAfterPresentation = true;
      mainWindow.webContents.send('presentations:finish-request');
      return;
    }
    if (!quitting && updates?.state.stage !== 'installing' && floatingWindow?.isVisible()) {
      event.preventDefault();
      readerHiddenForPlayer = true;
      mainWindow.hide();
      return;
    }
    if (!workspace?.job && !audiobooks.job && !transcriptions?.job) return;
    event.preventDefault(); workspace?.cancel(); audiobooks.cancel(); transcriptions?.cancel();
    if (closingForAudio) return; closingForAudio = true;
    const timer = setInterval(() => {
      if (!workspace?.job && !audiobooks.job && !transcriptions?.job) {
        clearInterval(timer);
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
      }
    }, 100);
  });
  if (testing) mainWindow.webContents.setAudioMuted(true);
  mainWindow.on('closed', () => {
    mainWindow = null;
    globalShortcut.unregister('MediaPlayPause');
    mediaKeySource = null;
    clearTimeout(narrationTimer);
    floatingWindow?.destroy();
    speech.cancel(); audiobooks.cancel(); transcriptions?.cancel(); void ocr.cancel();
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isAppUrl(url)) event.preventDefault();
  });
  mainWindow.webContents.on('did-start-navigation', ({ isMainFrame, isSameDocument }) => {
    if (isMainFrame && !isSameDocument) {
      floatingWindow?.close();
      transcriptions?.cancel();
      if (presentations?.active) {
        try { presentations.finish(presentations.active.id, true); } catch (error) { console.error('Treino de Apresentação:', error); }
      }
      globalShortcut.unregister('MediaPlayPause');
      mediaKeySource = null;
    }
  });
  mainWindow.webContents.on('render-process-gone', () => {
    floatingWindow?.close(); transcriptions?.cancel();
    if (presentations?.active) {
      try { presentations.finish(presentations.active.id, true); } catch (error) { console.error('Treino de Apresentação:', error); }
    }
  });
  mainWindow.loadURL(entryUrl);
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    { label: 'Arquivo', submenu: [
      { label: 'Importar livro…', accelerator: 'CmdOrCtrl+O', click: requestOpen },
      { label: 'Abrir sem copiar…', accelerator: 'CmdOrCtrl+Shift+O', click: () => mainWindow?.webContents.send('book:external-request') },
      { type: 'separator' }, { role: 'quit', label: 'Sair' },
    ] },
    { label: 'Editar', submenu: [
      { role: 'copy', label: 'Copiar' }, { role: 'selectAll', label: 'Selecionar tudo' },
    ] },
    { label: 'Exibir', submenu: [
      { role: 'togglefullscreen', label: 'Tela cheia' },
      ...(!app.isPackaged ? [{ role: 'toggleDevTools', label: 'Ferramentas do desenvolvedor' }] : []),
    ] },
  ]));
}

if (hasLock) {
  app.whenReady().then(() => {
    const assetRoot = path.resolve(__dirname, '../dist');
    protocol.handle('lume', async request => {
      const url = new URL(request.url);
      if (url.host !== 'app') return new Response('Não encontrado', { status: 404 });
      if (url.pathname.startsWith('/writing-print/')) { const html = writingPrints.get(url.pathname.slice('/writing-print/'.length)); return html ? new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } }) : new Response('Documento não encontrado', { status: 404 }); }
      if (url.pathname.startsWith('/portfolio-print/')) { const html = portfolioPrints.get(url.pathname.slice('/portfolio-print/'.length)); return html ? new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } }) : new Response('Documento não encontrado', { status: 404 }); }
      if (url.pathname.startsWith('/audio/')) return player.response(url.pathname.slice('/audio/'.length), request);
      if (url.pathname.startsWith('/transcription-audio/')) return transcriptions.response(url.pathname.slice('/transcription-audio/'.length), request);
      if (url.pathname.startsWith('/presentation-audio/')) return presentations.response(url.pathname.slice('/presentation-audio/'.length), request);
      if (url.pathname.startsWith('/covers/')) {
        const cover = library?.cover(url.pathname.slice('/covers/'.length));
        if (!cover) return new Response('Capa não encontrada', { status: 404 });
        try {
          const data = await fs.readFile(cover);
          return new Response(data, { headers: { 'Content-Type': data[0] === 0x89 ? 'image/png' : 'image/jpeg' } });
        } catch { return new Response('Capa não encontrada', { status: 404 }); }
      }
      let decoded;
      try { decoded = decodeURIComponent(url.pathname); }
      catch { return new Response('Caminho inválido', { status: 400 }); }
      const target = path.resolve(assetRoot, `.${decoded}`);
      const relative = path.relative(assetRoot, target);
      if (relative.startsWith('..') || path.isAbsolute(relative)) return new Response('Acesso negado', { status: 403 });
      return net.fetch(pathToFileURL(target).href);
    });
    session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) => {
      const ownFrame = mainWindow && contents === mainWindow.webContents && details.isMainFrame && isAppUrl(details.requestingUrl);
      const audioOnly = details.mediaTypes?.length === 1 && details.mediaTypes[0] === 'audio';
      callback(!!ownFrame && permission === 'media' && audioOnly && !!presentations?.active && presentations.findTake(presentations.active.id).audio);
    });
    session.defaultSession.setPermissionCheckHandler((contents, permission, origin, details) =>
      !!mainWindow && contents === mainWindow.webContents && permission === 'media' &&
      details.isMainFrame && isAppUrl(origin) && details.mediaType === 'audio' &&
      !!presentations?.active && presentations.findTake(presentations.active.id).audio);
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (request, callback) => {
      callback({ cancel: !devUrl || !request.url.startsWith(`${devUrl}/`) });
    });
    library = new Library(app.getPath('userData'));
    study = new Study(app.getPath('userData'), library);
    notebooks = new Notebooks(app.getPath('userData'), library);
    player = new AudioPlayer(app.getPath('userData'));
    const transcriptionRuntime = app.isPackaged
      ? path.join(process.resourcesPath, 'transcription', 'runtime')
      : path.join(__dirname, '../resources/transcription/runtime');
    transcriptions = new Transcriptions(app.getPath('userData'), transcriptionRuntime, progress => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('transcription:progress', progress);
    });
    bibliography = new BibliographicReviews(app.getPath('userData'));
    planner = new AcademicPlanner(app.getPath('userData'));
    presentations = new Presentations(app.getPath('userData'));
    conceptMaps = new ConceptMaps(app.getPath('userData'));
    researchProjects = new ResearchProjects(app.getPath('userData'));
    portfolio = new AcademicPortfolio(app.getPath('userData'));
    writing = new AcademicWriting(app.getPath('userData'), state => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('writing:saved',state); });
    searchIndex = new SearchIndex(app.getPath('userData'), library, notebooks);
    updates = new Updates({ version: app.getVersion(), packaged: app.isPackaged, windowsStore: process.windowsStore, release: require('../package.json').lumeRelease, createUpdater: () => {
      const { autoUpdater } = require('electron-updater');
      autoUpdater.netSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (request, callback) => callback({ cancel: !request.url.startsWith('https://') }));
      return autoUpdater;
    }, notify: state => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('updates:state', state); }, beforeInstall: async () => {
      if (workspace?.job || audiobooks.job) throw new Error('Conclua ou cancele a operação da biblioteca ou a exportação de áudio antes de reiniciar.');
      if (transcriptions.job) throw new Error('Conclua a operação do Estúdio antes de reiniciar.');
      if (presentations.active) throw new Error('Finalize o ensaio antes de reiniciar para atualizar.');
      writing.flushAll(); await library.pending; speech.cancel(); await ocr.cancel(); player.sleep(0, () => {});
    } });
    workspace = new Workspace(app.getPath('userData'), library, notebooks, study, player, searchIndex, progress => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('workspace:progress', progress); });
    ocr = new Ocr(app.isPackaged ? path.join(process.resourcesPath, 'ocr') : path.join(__dirname, '../resources/ocr'), app.isPackaged, progress => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('ocr:progress', progress);
    });
    registerIpc();
    createWindow();
    app.on('activate', () => { if (mainWindow) showReader(); else createWindow(); });
  }).catch(error => { console.error(error); app.quit(); });
  app.on('second-instance', () => { showReader(); mainWindow?.focus(); });
}
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', event => {
  try { writing?.flushAll(); } catch { event.preventDefault(); return; }
  if (presentations?.active && mainWindow && !mainWindow.webContents.isDestroyed()) {
    event.preventDefault();
    quitAfterPresentation = true;
    mainWindow.webContents.send('presentations:finish-request');
    return;
  }
  quitting = true; globalShortcut.unregisterAll(); speech.cancel(); audiobooks.cancel(); transcriptions?.cancel(); workspace?.cancel(); if (player) player.sleep(0, () => {}); void ocr?.cancel();
});
