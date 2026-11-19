import {_electron,expect as baseExpect} from '@playwright/test';
import {mkdtemp,readFile,writeFile,stat} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import os from 'node:os';
import path from 'node:path';
if(process.platform!=='darwin')throw new Error('A verificação nativa exige macOS.');
const execute=promisify(execFile),expect=baseExpect.configure({timeout:30000});
const folder=path.resolve('release/macos',process.arch==='arm64'?'mac-arm64':'mac','Lume.app');
const executable=path.join(folder,'Contents/MacOS/Lume'),resources=path.join(folder,'Contents/Resources');
await execute('/usr/bin/codesign',['--verify','--deep','--strict',folder]);
await execute('/usr/bin/lipo',[executable,'-verify_arch',process.arch==='arm64'?'arm64':'x86_64']);
for(const file of ['ocr/por.traineddata','ocr/eng.traineddata','transcription/runtime/ggml-base-q5_1.bin','transcription/runtime/ggml-small-q5_1.bin'])expect((await stat(path.join(resources,file))).size).toBeGreaterThan(1000);
const profile=await mkdtemp(path.join(os.tmpdir(),'lume-mac-smoke-')),env={...process.env,LUME_TEST_MODE:'1',LUME_USER_DATA:profile};
delete env.ELECTRON_RUN_AS_NODE;delete env.LUME_DEV_URL;
let app;
try{
  app=await _electron.launch({executablePath:executable,args:[],env});const page=await app.firstWindow(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false));
  const pkg=JSON.parse(await readFile('package.json','utf8'));expect(await app.evaluate(({app})=>app.getVersion())).toBe(pkg.version);
  const catalog=page.getByRole('list',{name:'Catálogo de aplicativos'});await expect(catalog.getByRole('button')).toHaveCount(9);
  for(const[id,name]of [['lume','Lume Leitor'],['transcription','Estúdio de Transcrição'],['bibliography','Bancada de Revisão Bibliográfica'],['planner','Planejador Acadêmico'],['presentation','Treino de Apresentação'],['concept-maps','Mapas Conceituais'],['research','Organizador de TCC e Projetos'],['portfolio','Portfólio Acadêmico e de Estágio'],['writing','Oficina de Escrita Acadêmica']]){
    await page.getByRole('button',{name:`Abrir ${name}`,exact:true}).click();const surface=page.locator(`#app-${id}`);await expect(surface).toBeVisible();await expect(surface.locator('.hub-return')).toBeEnabled();await surface.locator('.hub-return').click();await expect(catalog).toBeVisible();
  }
  await page.getByRole('button',{name:'Abrir Lume Leitor',exact:true}).click();
  await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},path.resolve('examples/Primeiros passos.pdf'));
  await page.getByRole('button',{name:'Importar livro',exact:true}).click();await expect(page.locator('.document-heading h1')).toHaveText('Primeiros passos');
  const recording=await page.evaluate(async()=>{
    const api=window.lume,book=(await api.listRecent())[0],voices=await api.speechVoices();
    const voice=voices.find(v=>v.language.startsWith('en'))||voices[0];if(!voice)throw new Error('O runner não possui uma voz instalada para validar a narração.');
    return Array.from(await api.synthesizeSpeech(book.id,'This is a short test. The university library helps students read and study.',voice.name));
  });
  const wave=path.join(profile,'Narracao.wav'),mobile=path.join(profile,'Aula.m4a');await writeFile(wave,Buffer.from(recording));expect(Buffer.from(recording).subarray(0,4).toString()).toBe('RIFF');
  await execute(path.join(resources,'transcription/runtime/ffmpeg/ffmpeg'),['-nostdin','-hide_banner','-loglevel','error','-i',wave,'-c:a','aac',mobile]);
  await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},mobile);
  const result=await page.evaluate(async()=>{const project=await window.lume.transcriptionImport();if(!project)throw new Error('Áudio não importado.');return window.lume.transcriptionStart(project.id,'en','fast');});
  expect(result.segments.length).toBeGreaterThan(0);expect(result.segments.some(segment=>segment.text.trim())).toBe(true);
  await page.locator('#app-lume .hub-return').click();await page.getByRole('button',{name:'Abrir Oficina de Escrita Acadêmica',exact:true}).click();await page.getByRole('button',{name:'Criar meu primeiro texto',exact:true}).click();
  const form=page.getByRole('dialog',{name:'Novo texto acadêmico'});await form.getByLabel('Título do trabalho',{exact:true}).fill('Validação no macOS');await form.getByRole('button',{name:'Criar texto',exact:true}).click();await expect(form).toHaveCount(0);await page.getByRole('textbox',{name:'Texto da seção',exact:true}).fill('As ideias foram salvas no Mac.');await expect(page.locator('.writing-save-state')).toHaveText('Salvo neste computador');
  expect(errors).toEqual([]);await app.close();app=null;
  expect(JSON.parse(await readFile(path.join(profile,'academic-writing.json'),'utf8')).documents).toHaveLength(1);
  console.log('Pacote macOS validado: nove apps, leitura, voz nativa, conversão M4A, transcrição real e salvamento.');
}finally{await app?.close();}
