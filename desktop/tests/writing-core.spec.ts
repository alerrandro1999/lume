import {test,expect} from '@playwright/test';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import type {WritingDocument,WritingBlock} from '../src/writing-types';
const require=createRequire(import.meta.url);
const {AcademicWriting,review,words}=require('../electron/academic-writing.cjs');
const {writingHtml,docx,usedReferences}=require('../electron/writing-export.cjs');
const root=()=>fs.mkdtempSync(path.join(os.tmpdir(),'lume-writing-core-'));
const create={title:'Leitura na graduação',type:'article',author:'Ana Silva',course:'Pedagogia',goal:1500};
const block=(text:string):WritingBlock=>({id:randomUUID(),type:'paragraph',runs:[{text,bold:false,italic:false,citationId:''}]});

test('confirma o autosave após gravar, preserva o arquivo e o rascunho se houver falha e recupera versões',()=>{
  const directory=root(),events:unknown[]=[],store=new AcademicWriting(directory,(state:unknown)=>events.push(state));let doc:WritingDocument=store.create(create);
  doc.sections[1].blocks=[block('Primeira redação com uma ideia.')];const token=randomUUID();store.stage(doc.id,doc,token);
  expect(events).toHaveLength(0);expect(store.open(doc.id).sections[1].blocks[0].runs[0].text).toContain('Primeira');
  store.flush(doc.id);expect(events).toEqual([{id:doc.id,token,state:'saved'}]);
  doc=store.version(doc.id,'Primeira versão'); const original=fs.readFileSync(store.file,'utf8');
  doc.sections[1].blocks[0].runs[0].text='Segunda redação recuperável.';store.stage(doc.id,doc,randomUUID());
  const rename=fs.renameSync;try{fs.renameSync=()=>{throw new Error('Disco indisponível');};expect(()=>store.flush(doc.id)).toThrow('Disco');}finally{fs.renameSync=rename;}
  expect(fs.readFileSync(store.file,'utf8')).toBe(original);expect(store.open(doc.id).sections[1].blocks[0].runs[0].text).toContain('Segunda');
  store.flushAll();doc=store.restore(doc.id,doc.versions[0].id);expect(doc.sections[1].blocks[0].runs[0].text).toContain('Primeira');expect(doc.versions.at(-1)!.snapshot.sections[1].blocks[0].runs[0].text).toContain('Segunda');
  expect(new AcademicWriting(directory).open(doc.id)).toEqual(doc);expect(events).toContainEqual(expect.objectContaining({state:'error'}));
});
test('não sobrescreve armazenamento corrompido e rejeita citações inexistentes e seções duplicadas',()=>{
  const directory=root(),file=path.join(directory,'academic-writing.json');fs.writeFileSync(file,'{arquivo incompleto');const broken=new AcademicWriting(directory);expect(()=>broken.create(create)).toThrow('Preserve');expect(fs.readFileSync(file,'utf8')).toBe('{arquivo incompleto');
  const store=new AcademicWriting(root()),doc:WritingDocument=store.create(create);const invalid=structuredClone(doc);invalid.sections.push(invalid.sections[0]);expect(()=>store.stage(doc.id,invalid,randomUUID())).toThrow('duplicado');
  doc.sections[0].blocks=[{...block(''),runs:[{text:'',bold:false,italic:false,citationId:randomUUID()}]}];expect(()=>store.stage(doc.id,doc,randomUUID())).toThrow('Referência');
  expect(()=>store.flushAll()).toThrow('corrigidas');doc.sections[0].blocks=[block('Texto corrigido.')];doc.sections[0].title='';store.stage(doc.id,doc,randomUUID());store.flushAll();expect(store.open(doc.id).sections[0].blocks[0].runs[0].text).toBe('Texto corrigido.');
});
test('vincula fontes, preserva metadados no histórico e exporta só o conteúdo selecionado em HTML e DOCX',async()=>{
  const store=new AcademicWriting(root());let doc:WritingDocument=store.create(create);const source={source:{kind:'review',id:randomUUID(),recordId:randomUUID()},title:'Livro sobre escrita',authors:'Silva, Ana',year:'2024',journal:'Educação',doi:'10.123/teste',url:''};
  doc=store.addCitation(doc.id,source,{label:'(Silva, 2024, p. 12)',locator:'p. 12'});const cid=doc.citations[0].id;
  doc=store.addCitation(doc.id,{...source,title:'FONTE_NAO_USADA',source:{...source.source,recordId:randomUUID()}},{label:'(Outra, 2023)',locator:''});
  doc.sections[1].notes='NOTA_PRIVADA';doc.sections[1].guide='GUIA_PRIVADO';doc.context.topic='CONTEXTO_PRIVADO';
  doc.sections[1].blocks=[{...block('Um argumento <script>perigoso</script>.'),runs:[{text:'Um argumento <script>perigoso</script>.',bold:true,italic:true,citationId:''},{text:'',bold:false,italic:false,citationId:cid}]}, {...block('Primeiro item'),type:'number'}, {...block('Segundo item'),type:'number'}];
  doc.sections[0].include=false;doc.sections[0].blocks=[block('SECAO_PRIVADA')];store.stage(doc.id,doc,randomUUID());doc=store.flush(doc.id);
  expect(()=>store.removeCitation(doc.id,cid)).toThrow('Remova a marca');expect(usedReferences(doc)).toHaveLength(1);
  const html=writingHtml(doc);expect(html).toContain('&lt;script&gt;');expect(html).not.toContain('<script>');expect(html).toContain('Livro sobre escrita');
  const zip=await JSZip.loadAsync(await docx(doc));const xml=await zip.file('word/document.xml')!.async('string');
  expect(xml).toContain('<w:b/>');expect(xml).toContain('<w:i/>');expect(xml).toContain('Silva, 2024, p. 12');expect(xml).toContain('<w:numPr>');expect(xml).toContain('Livro sobre escrita');
  for(const privateText of ['NOTA_PRIVADA','GUIA_PRIVADO','CONTEXTO_PRIVADO','SECAO_PRIVADA','FONTE_NAO_USADA']){expect(html).not.toContain(privateText);expect(xml).not.toContain(privateText);}
  doc=store.version(doc.id,'Com fontes');doc=store.removeCitation(doc.id,doc.citations[1].id);doc=store.restore(doc.id,doc.versions[0].id);expect(doc.citations).toHaveLength(2);
});
test('aponta frases longas, repetição e marcadores sem alterar o texto',()=>{
  const store=new AcademicWriting(root()),doc:WritingDocument=store.create(create);doc.sections[1].blocks=[block(('aprendizagem conhecimento contexto formação experiência ').repeat(30)+' [fonte pendente]')];const before=structuredClone(doc),issues=review(doc);
  expect(issues.map((i:{kind:string})=>i.kind)).toEqual(expect.arrayContaining(['paragraph','sentence','citation','repetition']));expect(words(doc)).toBeGreaterThan(120);expect(doc).toEqual(before);
});
