import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { Bold, Italic, List, ListOrdered, Quote, Heading2, Pilcrow, BookOpen } from 'lucide-react';
import type { WritingBlock, WritingCitation, WritingRun } from './writing-types';

const escape = (value: string) => value.replace(/[&<>"']/g,c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
function blockHtml(blocks: WritingBlock[], citations: WritingCitation[]) {
  let output = '', list = '';
  for (const block of blocks) {
    const tag = block.type === 'bullet' ? 'ul' : block.type === 'number' ? 'ol' : '';
    if (list && list !== tag) { output += `</${list}>`; list = ''; } if (tag && !list) { output += `<${tag}>`; list = tag; }
    const element = tag ? 'li' : block.type === 'heading' ? 'h2' : block.type === 'quote' ? 'blockquote' : 'p';
    output += `<${element} data-writing-block="${escape(block.id)}">${block.runs.map(run => { let value = run.citationId ? `<span contenteditable="false" data-writing-citation="${escape(run.citationId)}">${escape(citations.find(c => c.id === run.citationId)?.label || '')}</span>` : escape(run.text).replace(/\n/g,'<br>'); if (run.bold) value = `<strong>${value}</strong>`; if (run.italic) value = `<em>${value}</em>`; return value; }).join('') || '<br>'}</${element}>`;
  }
  return output + (list ? `</${list}>` : '') || '<p><br></p>';
}
function serialize(root: HTMLElement, citations: WritingCitation[], identities: WeakMap<Node,string>, anchors: Map<string,Node[]>): WritingBlock[] {
  const blocks: WritingBlock[] = [], used = new Set<string>();
  const structural = 'p,div,ul,ol,li,h1,h2,h3,blockquote';
  const formatting = (node: HTMLElement, bold: boolean, italic: boolean) => ({bold: node.style.fontWeight ? node.style.fontWeight === 'bold' || Number(node.style.fontWeight) >= 600 : bold || ['B','STRONG'].includes(node.tagName), italic: node.style.fontStyle ? node.style.fontStyle === 'italic' : italic || ['I','EM'].includes(node.tagName)});
  const inline = (node: Node, bold = false, italic = false): WritingRun[] => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ? [{text:node.textContent.replace(/\u00a0/g,' ').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,''),bold,italic,citationId:''}] : [];
    if (!(node instanceof HTMLElement)) return [];
    const cid = node.dataset.writingCitation;
    if (cid && citations.some(c => c.id === cid)) return [{text:'',bold,italic,citationId:cid}];
    if (node.tagName === 'BR') return [{text:'\n',bold,italic,citationId:''}];
    if (['SCRIPT','STYLE','IMG','IFRAME','OBJECT'].includes(node.tagName)) return [];
    ({bold,italic} = formatting(node,bold,italic));
    return Array.from(node.childNodes).flatMap(child => inline(child,bold,italic));
  };
  anchors.clear();
  const add = (nodes: Node[], type: WritingBlock['type'], bold = false, italic = false) => {
    const node = nodes[0]; if (!node) return;
    let id = (node instanceof HTMLElement ? node.dataset.writingBlock : '') || identities.get(node);
    if (!id || used.has(id)) id = crypto.randomUUID(); used.add(id); identities.set(node,id); if (node instanceof HTMLElement) node.dataset.writingBlock = id; anchors.set(id,nodes);
    const runs = nodes.flatMap(node => inline(node,bold,italic)); if (runs.length === 1 && runs[0].text === '\n') runs[0].text = '';
    const merged: WritingRun[] = []; for (const run of runs) { const last = merged.at(-1); if (last && !run.citationId && !last.citationId && last.bold === run.bold && last.italic === run.italic) last.text += run.text; else merged.push(run); }
    blocks.push({id,type,runs:merged});
  };
  const visit = (node: HTMLElement, type: WritingBlock['type'] = 'paragraph', bold = false, italic = false) => {
    if (['UL','OL'].includes(node.tagName)) { Array.from(node.children).forEach(child => {if(child instanceof HTMLElement)visit(child,node.tagName === 'UL'?'bullet':'number',bold,italic);}); return; }
    type = ['H1','H2','H3'].includes(node.tagName) ? 'heading' : node.tagName === 'BLOCKQUOTE' ? 'quote' : type;
    const children = Array.from(node.childNodes), hasBlocks = children.some(child => child instanceof HTMLElement && (child.matches(structural) || child.querySelector(structural)));
    if (node !== root && !hasBlocks) { add([node],type,bold,italic); return; }
    ({bold,italic}=formatting(node,bold,italic));
    let group: Node[] = [];
    const flush = () => {if(group.length){add(group,type,bold,italic);group=[];}};
    for (const child of children) { if(child instanceof HTMLElement && (child.matches(structural) || child.querySelector(structural))){flush();visit(child,type,bold,italic);}else group.push(child); }
    flush();
  };
  visit(root); return blocks;
}
export interface WritingEditorHandle { insertCitation(citation: WritingCitation): void; insertText(value: string): void; focusBlock(id: string): void; remember(): void }
export const WritingEditor = forwardRef<WritingEditorHandle, {sectionId: string; reset: number; blocks: WritingBlock[]; citations: WritingCitation[]; disabled: boolean; change(blocks: WritingBlock[]): void; cite(): void}>(function WritingEditor({sectionId,reset,blocks,citations,disabled,change,cite},ref) {
  const root = useRef<HTMLDivElement>(null), selection = useRef<Range | null>(null), latest = useRef({citations,change}); latest.current = {citations,change};
  const identities = useRef(new WeakMap<Node,string>()), anchors = useRef(new Map<string,Node[]>());
  useEffect(() => { if (root.current) root.current.innerHTML = blockHtml(blocks,citations); selection.current = null; identities.current=new WeakMap();anchors.current.clear(); },[sectionId,reset]); // DOM remains stable while typing to preserve the caret and native undo.
  function remember() { const current = window.getSelection(); if (root.current && current?.rangeCount && root.current.contains(current.anchorNode) && root.current.contains(current.focusNode)) selection.current = current.getRangeAt(0).cloneRange(); }
  function restore() { const node = root.current; if (!node) return; node.focus(); const current = window.getSelection(); if (!current) return; const range = selection.current; if (range && node.contains(range.startContainer) && node.contains(range.endContainer)) { current.removeAllRanges(); current.addRange(range); } else { const end = document.createRange(); const last = Array.from(node.querySelectorAll('p,div,li,h2,blockquote')).at(-1); end.selectNodeContents(last || node); end.collapse(false); current.removeAllRanges(); current.addRange(end); } }
  function emit() { if (root.current) latest.current.change(serialize(root.current,latest.current.citations,identities.current,anchors.current)); remember(); }
  function command(name: string, value?: string) { restore(); document.execCommand(name,false,value); emit(); }
  useImperativeHandle(ref,() => ({remember,insertText(value) { command('insertText',value); },insertCitation(citation) {
    restore(); const current = window.getSelection(); if (!current?.rangeCount || !root.current) return;
    const range = current.getRangeAt(0); range.collapse(false); const span = document.createElement('span'); span.contentEditable = 'false'; span.dataset.writingCitation = citation.id; span.textContent = citation.label;
    const before = document.createRange(); before.selectNodeContents(root.current); before.setEnd(range.startContainer,range.startOffset); const preceding = before.toString();
    const space = document.createTextNode(' '), fragment = document.createDocumentFragment(); if (preceding && !/\s$/u.test(preceding)) fragment.append(document.createTextNode(' ')); fragment.append(span,space); range.insertNode(fragment); range.setStartAfter(space); range.collapse(true); current.removeAllRanges(); current.addRange(range); emit();
  },focusBlock(id) { const block = Array.from(root.current?.querySelectorAll<HTMLElement>('[data-writing-block]') || []).find(node => node.dataset.writingBlock === id), nodes = anchors.current.get(id); if (block || nodes?.length) { const target = block || nodes![0].parentElement; target?.scrollIntoView({block:'center',behavior:'smooth'}); root.current?.focus(); const range = document.createRange(); if(block)range.selectNodeContents(block);else{range.setStartBefore(nodes![0]);range.setEndAfter(nodes!.at(-1)!);} const current = window.getSelection(); current?.removeAllRanges(); current?.addRange(range); remember(); } }}));
  const commands = [{name:'Negrito',Icon:Bold,command:'bold'},{name:'Itálico',Icon:Italic,command:'italic'},{name:'Parágrafo',Icon:Pilcrow,command:'formatBlock',value:'p'},{name:'Subtítulo',Icon:Heading2,command:'formatBlock',value:'h2'},{name:'Lista com marcadores',Icon:List,command:'insertUnorderedList'},{name:'Lista numerada',Icon:ListOrdered,command:'insertOrderedList'},{name:'Citação em bloco',Icon:Quote,command:'formatBlock',value:'blockquote'}];
  return <><div className="writing-toolbar" role="toolbar" aria-label="Formatação do texto">{commands.map(item => <button key={item.name} type="button" title={item.name} aria-label={item.name} disabled={disabled} onMouseDown={event => event.preventDefault()} onClick={() => command(item.command,item.value)}><item.Icon size={16}/></button>)}<i/><button type="button" disabled={disabled} onMouseDown={event => event.preventDefault()} onClick={() => { remember(); cite(); }}><BookOpen size={15}/>Citar fonte</button></div><div ref={root} className="writing-editable" contentEditable={!disabled} suppressContentEditableWarning role="textbox" aria-label="Texto da seção" aria-multiline="true" lang="pt-BR" spellCheck onInput={emit} onMouseUp={remember} onKeyUp={remember} onBlur={remember} onPaste={event => { event.preventDefault(); command('insertText',event.clipboardData.getData('text/plain')); }} onDrop={event => event.preventDefault()} data-placeholder="Comece a escrever. Use o roteiro ao lado para organizar as ideias."/></>;
});
