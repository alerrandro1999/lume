import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Download, FileJson, FolderOpen, GripVertical, LayoutGrid, Link2, LoaderCircle, Moon, Network, Pencil, Plus, Redo2, Search, Sun, Trash2, Undo2, Upload, X } from 'lucide-react';
import type { Theme } from './Hub';
import { Modal } from './ReadingTools';
import { plannerMaterialEvent } from './planner-types';
import { ConceptCanvas, ConceptKindIcon, type ConceptCanvasHandle } from './ConceptCanvas';
import { ConceptEdgeInspector, ConceptGuide, ConceptNodeInspector } from './ConceptInspector';
import { conceptError, useConceptEditor } from './useConceptEditor';
import { conceptDragType, conceptKinds, type ConceptColor, type ConceptDrag, type ConceptEdge, type ConceptKind, type ConceptMap, type ConceptNode, type ConceptSelection, type ConceptSourceOption, type ConceptSummary } from './concept-map-types';
import type { Point } from './concept-geometry';
import { researchSourceEvent, type ResearchSource } from './research-types';
import './concept-map.css';

const defaults: Record<ConceptKind, { title: string; color: ConceptColor }> = { idea: { title: 'Nova ideia', color: 'violet' }, book: { title: 'Título do livro', color: 'amber' }, author: { title: 'Nome do autor', color: 'blue' }, reference: { title: 'Referência', color: 'teal' } };
export function ConceptMapMark() { return <span className="concept-mark" aria-hidden="true"><Network size={27} strokeWidth={1.6} /></span>; }
function MapDialog({ kind, title, busy, error, close, submit }: { kind: 'create' | 'rename' | 'delete'; title: string; busy: boolean; error: string; close(): void; submit(title: string): void }) {
  const [value, setValue] = useState(kind === 'create' ? '' : title);
  return <Modal title={kind === 'create' ? 'Novo mapa conceitual' : kind === 'rename' ? 'Renomear mapa' : 'Excluir mapa'} close={close}><form className="concept-map-dialog" onSubmit={event => { event.preventDefault(); submit(value); }}>{kind === 'delete' ? <p>Excluir o mapa “{title}” e todas as suas conexões?</p> : <><label htmlFor="concept-map-name">Nome do mapa</label><input id="concept-map-name" autoComplete="off" required maxLength={160} value={value} disabled={busy} onChange={event => setValue(event.target.value)} placeholder="Ex.: Fundamentos da minha pesquisa" /></>}{error && <p className="concept-error" role="alert">{error}</p>}<div><button type="button" className="concept-button" disabled={busy} onClick={close}>Cancelar</button><button type="submit" disabled={busy || (kind !== 'delete' && !value.trim())} className={`concept-button ${kind === 'delete' ? 'concept-danger' : 'concept-primary'}`}>{kind === 'delete' ? 'Confirmar exclusão do mapa' : kind === 'create' ? 'Criar mapa' : 'Salvar nome'}</button></div></form></Modal>;
}

export function ConceptMapWorkspace({ visible, activate, onOpenHub, theme, toggleTheme }: { visible: boolean; activate(): void; onOpenHub(): void; theme: Theme; toggleTheme(): void }) {
  const api = window.lume.conceptMaps;
  const [maps, setMaps] = useState<ConceptSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [selection, setSelection] = useState<ConceptSelection>(null);
  const [query, setQuery] = useState('');
  const [sourceKind, setSourceKind] = useState('all');
  const [sources, setSources] = useState<ConceptSourceOption[]>([]);
  const [sourceError, setSourceError] = useState('');
  const [sourceLoading, setSourceLoading] = useState(false);
  const [linking, setLinking] = useState<string | null>(null);
  const [dialog, setDialog] = useState<'create' | 'rename' | 'delete' | null>(null);
  const [exporting, setExporting] = useState(false);
  const canvas = useRef<ConceptCanvasHandle>(null);
  const search = useRef<HTMLInputElement>(null);
  const editor = useConceptEditor(api, map => setMaps(previous => [map, ...previous.filter(item => item.id !== map.id)]));
  const map = editor.map;
  const node = selection?.kind === 'node' ? map?.nodes.find(item => item.id === selection.id) : undefined;
  const edge = selection?.kind === 'edge' ? map?.edges.find(item => item.id === selection.id) : undefined;
  const shownSources = sources.filter(item => sourceKind === 'all' || item.kind === sourceKind);
  useEffect(() => {
    const receive = (event: Event) => {
      const source = (event as CustomEvent<ResearchSource>).detail;
      if (source.kind !== 'map') return;
      activate();
      if (dialog) { setError('Feche o diálogo aberto antes de trocar de mapa.'); return; }
      void perform(async () => { const next = await api.open(source.id); setMaps(await api.list()); selectMap(next); setLoaded(true); });
    };
    window.addEventListener(researchSourceEvent, receive);
    return () => window.removeEventListener(researchSourceEvent, receive);
  });
  useEffect(() => {
    if (!visible) return;
    document.title = 'Mapas Conceituais';
    if (loaded) return;
    let live = true;
    void api.list().then(async items => { const first = items[0] ? await api.open(items[0].id) : null; if (live) { setMaps(items); editor.open(first); setLoaded(true); setError(''); } }).catch(error => { if (live) setError(conceptError(error)); });
    return () => { live = false; };
  }, [visible, loaded, api]);
  useEffect(() => {
    if (!visible) return;
    let live = true; setSourceLoading(true);
    const timer = window.setTimeout(() => { void api.sources(query).then(items => { if (live) { setSources(items); setSourceError(''); } }).catch(error => { if (live) setSourceError(conceptError(error)); }).finally(() => { if (live) setSourceLoading(false); }); }, query ? 180 : 0);
    return () => { live = false; window.clearTimeout(timer); };
  }, [visible, query, api]);
  useEffect(() => { if (selection && !(selection.kind === 'node' ? map?.nodes : map?.edges)?.some(item => item.id === selection.id)) { setSelection(null); setLinking(null); } }, [map, selection]);
  async function perform(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setError(''); setStatus(''); setExporting(false);
    try { await editor.flush(); await work(); } catch (error) { setError(conceptError(error)); }
    finally { setBusy(false); }
  }
  function selectMap(next: ConceptMap) { editor.open(next); setSelection(null); setLinking(null); setStatus(''); setError(''); }
  function commit(next: ConceptMap) { editor.commit(next); setStatus(''); setError(''); }
  function select(value: ConceptSelection) { setSelection(value); setLinking(null); }
  function add(value: ConceptDrag, point: Point) {
    const current = editor.current.current;
    if (!current || busy || current.nodes.length >= 500) { if (current?.nodes.length === 500) setError('Este mapa já tem 500 blocos.'); return; }
    const kind = value.kind, preset = defaults[kind]; if (!preset) return;
    const node: ConceptNode = { id: crypto.randomUUID(), kind, color: preset.color, title: value.title?.slice(0, 180) || preset.title, notes: value.notes?.slice(0, 6000) || '', x: Math.max(-100000, Math.min(100000, Math.round(point.x / 8) * 8)), y: Math.max(-100000, Math.min(100000, Math.round(point.y / 8) * 8)), source: value.source ?? null };
    commit({ ...current, nodes: [...current.nodes, node] }); setSelection({ kind: 'node', id: node.id }); setLinking(null);
  }
  function addAtCenter(value: ConceptDrag) {
    const center = canvas.current?.center() ?? { x: 0, y: 0 };
    const nodes = editor.current.current?.nodes ?? [];
    let point = center;
    placement: for (let radius = 0; radius < 30; radius++) {
      for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
        const candidate = { x: center.x + dx * 264, y: center.y + dy * 172 };
        if (!nodes.some(node => candidate.x + 240 > node.x && candidate.x < node.x + 240 && candidate.y + 148 > node.y && candidate.y < node.y + 148)) { point = candidate; break placement; }
      }
    }
    add(value, point);
  }
  function updateNode(id: string, patch: Partial<ConceptNode>) { const current = editor.current.current; if (current) commit({ ...current, nodes: current.nodes.map(node => node.id === id ? { ...node, ...patch, id } : node) }); }
  function updateEdge(id: string, patch: Partial<ConceptEdge>) { const current = editor.current.current; if (current) commit({ ...current, edges: current.edges.map(edge => edge.id === id ? { ...edge, ...patch, id } : edge) }); }
  function removeSelection() {
    const current = editor.current.current; if (!current || !selection) return;
    commit(selection.kind === 'node' ? { ...current, nodes: current.nodes.filter(node => node.id !== selection.id), edges: current.edges.filter(edge => edge.from !== selection.id && edge.to !== selection.id) } : { ...current, edges: current.edges.filter(edge => edge.id !== selection.id) });
    setSelection(null); setLinking(null);
  }
  function connect(from: string, to: string, fromPort: ConceptEdge['fromPort'], toPort: ConceptEdge['toPort']) {
    const current = editor.current.current; if (!current || from === to) return;
    if (current.edges.length >= 1500) { setError('Este mapa já tem 1.500 conexões.'); return; }
    if (current.edges.some(edge => edge.from === from && edge.to === to)) { setStatus('Esses blocos já estão conectados nessa direção. Selecione a seta para editar.'); return; }
    const edge: ConceptEdge = { id: crypto.randomUUID(), from, to, fromPort, toPort, label: '', color: 'slate', style: 'solid' };
    commit({ ...current, edges: [...current.edges, edge] }); setSelection({ kind: 'edge', id: edge.id }); setLinking(null);
  }
  function useSource(item: ConceptSourceOption) {
    if (linking) { updateNode(linking, { source: item.source }); setLinking(null); setStatus('Material vinculado ao bloco.'); }
    else addAtCenter({ kind: item.kind, title: item.title, notes: item.subtitle, source: item.source });
  }
  function sourceDrag(event: React.DragEvent, value: ConceptDrag) { event.dataTransfer.setData(conceptDragType, JSON.stringify(value)); event.dataTransfer.effectAllowed = 'copy'; }
  function exportMap(format: 'json' | 'svg') { if (map) void perform(async () => { const file = await api.export(map.id, format); if (file) setStatus(format === 'svg' ? 'Imagem do mapa exportada.' : 'Mapa editável exportado.'); }); }
  function submitDialog(title: string) {
    void perform(async () => {
      if (dialog === 'create') { const next = await api.create(title); setMaps(await api.list()); selectMap(next); }
      if (dialog === 'rename' && map) commit({ ...map, title: title.trim() });
      if (dialog === 'delete' && map) { const next = await api.remove(map.id); setMaps(next); editor.open(next[0] ? await api.open(next[0].id) : null); setSelection(null); setLinking(null); }
      setDialog(null);
    });
  }
  return <div className="concept-workspace" onKeyDown={event => {
    if (!map || !(event.ctrlKey || event.metaKey)) return;
    if (event.key.toLowerCase() === 's') { event.preventDefault(); if (editor.phase === 'error') editor.retry(); return; }
    if ((event.target as HTMLElement).closest('input, textarea, select') || dialog || busy) return;
    if (event.key.toLowerCase() === 'z') { event.preventDefault(); if (event.shiftKey) editor.redo(); else editor.undo(); }
    if (event.key.toLowerCase() === 'y') { event.preventDefault(); editor.redo(); }
  }}>
    <div className="concept-shell" inert={!!dialog || busy}>
      <header className="concept-header"><button className="hub-return" onClick={() => void perform(async () => { onOpenHub(); })}><LayoutGrid size={15} />Aplicativos</button><span className="concept-app-name"><Network size={19} />Mapas Conceituais</span><div className="concept-header-name">{map && <button title="Renomear mapa" onClick={() => { setError(''); setDialog('rename'); }}>{map.title}<Pencil size={12} /></button>}</div><button className="concept-icon-button" aria-label={theme === 'light' ? 'Ativar tema escuro' : 'Ativar tema claro'} onClick={toggleTheme}>{theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}</button></header>
      <div className="concept-subheader"><span className="concept-save-state" role="status">{map && (editor.phase === 'saving' ? <><LoaderCircle className="concept-spinner" size={13} />Salvando…</> : editor.phase === 'error' ? <><span className="concept-unsaved-dot" />Alterações não salvas<button onClick={editor.retry}>Tentar salvar</button></> : <><Check size={14} />Salvo neste computador</>)}</span><span className="concept-general-status" aria-live="polite">{status}</span><div className="concept-history-controls"><button className="concept-icon-button" disabled={!editor.historySize.undo} aria-label="Desfazer alteração" title="Desfazer (Ctrl+Z)" onClick={editor.undo}><Undo2 size={16} /></button><button className="concept-icon-button" disabled={!editor.historySize.redo} aria-label="Refazer alteração" title="Refazer (Ctrl+Shift+Z)" onClick={editor.redo}><Redo2 size={16} /></button></div><div className="concept-export-menu"><button className="concept-button" disabled={!map} aria-expanded={exporting} onClick={() => setExporting(value => !value)}><Download size={14} />Exportar<ChevronDown size={12} /></button>{exporting && <div className="concept-export-options"><button onClick={() => exportMap('svg')}><Download size={14} />Imagem SVG</button><button onClick={() => exportMap('json')}><FileJson size={14} />Mapa editável (JSON)</button><button onClick={() => setExporting(false)}>Fechar opções</button></div>}</div></div>
      {!dialog && (error || editor.error) && <div className="concept-error" role="alert">{error || editor.error}</div>}
      <div className="concept-layout"><aside className="concept-sidebar" aria-label="Mapas e materiais"><div className="concept-map-library"><div><span><FolderOpen size={14} />Meus mapas</span><button className="concept-icon-button" disabled={!loaded} aria-label="Novo mapa conceitual" onClick={() => { setError(''); setDialog('create'); }}><Plus size={16} /></button></div><select aria-label="Selecionar mapa" disabled={!maps.length} value={map?.id ?? ''} onChange={event => { const id = event.target.value; void perform(async () => selectMap(await api.open(id))); }}>{!maps.length && <option value="">Nenhum mapa criado</option>}{maps.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select><div className="concept-map-library-actions"><button onClick={() => void perform(async () => { const next = await api.import(); if (next) { setMaps(await api.list()); selectMap(next); setStatus('Mapa importado.'); } })}><Upload size={12} />Importar</button><button disabled={!map} className="concept-danger" aria-label="Excluir mapa atual" onClick={() => { setError(''); setDialog('delete'); }}><Trash2 size={12} /></button></div></div>
        <section className="concept-palette"><h2>Adicione ao quadro</h2><p>Arraste um bloco ou clique para criar.</p><div>{(Object.keys(conceptKinds) as ConceptKind[]).map(kind => <button key={kind} disabled={!map} draggable={!!map} onDragStart={event => sourceDrag(event, { kind })} className={`concept-palette-card concept-color-${defaults[kind].color}`} onClick={() => addAtCenter({ kind })}><ConceptKindIcon kind={kind} size={18} /><span>{conceptKinds[kind]}</span><GripVertical size={12} /></button>)}</div></section>
        <section className="concept-sources"><div className="concept-sources-heading"><h2>Fontes do seu hub</h2><Link2 size={13} /></div><p>Livros, autores e referências já cadastrados.</p>{linking && <div className="concept-link-prompt"><span>Escolha a fonte para vincular ao bloco.</span><button className="concept-icon-button" aria-label="Cancelar vínculo de material" onClick={() => setLinking(null)}><X size={13} /></button></div>}<label className="concept-source-search"><Search size={14} /><input ref={search} aria-label="Buscar livros, autores e referências" type="search" maxLength={200} value={query} onChange={event => setQuery(event.target.value)} placeholder="Título ou autor…" /></label><select aria-label="Filtrar tipos de fonte" value={sourceKind} onChange={event => setSourceKind(event.target.value)}><option value="all">Todos os materiais</option><option value="book">Livros</option><option value="author">Autores</option><option value="reference">Referências</option></select><div className="concept-source-list" aria-label="Materiais disponíveis">{sourceError ? <p className="concept-error">{sourceError}</p> : sourceLoading ? <p className="concept-sources-empty">Buscando materiais…</p> : shownSources.length ? shownSources.map(item => <button key={item.key} disabled={!map} draggable={!!map && !linking} onDragStart={event => sourceDrag(event, { kind: item.kind, title: item.title, notes: item.subtitle, source: item.source })} className={`concept-source-card concept-color-${defaults[item.kind].color} ${linking ? 'is-linking' : ''}`} aria-label={`${linking ? 'Vincular' : 'Adicionar'} ${conceptKinds[item.kind]} ${item.title}`} onClick={() => useSource(item)}><span><ConceptKindIcon kind={item.kind} size={13} />{conceptKinds[item.kind]}</span><strong>{item.title}</strong><small>{item.subtitle}</small></button>) : <p className="concept-sources-empty">{query || sourceKind !== 'all' ? 'Nenhum material encontrado. Tente outro título ou autor.' : 'Seus livros e referências aparecerão aqui depois de cadastrados no Leitor e na Bancada. Você já pode criar blocos livremente.'}</p>}</div></section>
      </aside>
      {map ? <><ConceptCanvas key={map.id} ref={canvas} map={map} selection={selection} select={select} add={add} move={(id, point) => updateNode(id, { x: Math.max(-100000, Math.min(100000, point.x)), y: Math.max(-100000, Math.min(100000, point.y)) })} connect={connect} remove={removeSelection} />{node ? <ConceptNodeInspector key={node.id} node={node} update={patch => updateNode(node.id, patch)} remove={removeSelection} close={() => select(null)} link={() => { setLinking(node.id); setSourceKind('all'); setQuery(''); search.current?.focus(); }} openSource={() => void perform(async () => { if (node.source) { const source = await api.resolve(node.source); window.dispatchEvent(new CustomEvent(plannerMaterialEvent, { detail: source })); } })} focus={id => canvas.current?.focusNode(id)} /> : edge ? <ConceptEdgeInspector edge={edge} map={map} update={patch => updateEdge(edge.id, patch)} remove={removeSelection} close={() => select(null)} reverse={() => { if (map.edges.some(item => item.id !== edge.id && item.from === edge.to && item.to === edge.from)) { setError('Já existe uma seta na direção inversa.'); return; } updateEdge(edge.id, { from: edge.to, to: edge.from, fromPort: edge.toPort, toPort: edge.fromPort }); }} /> : <ConceptGuide map={map} select={id => { select({ kind: 'node', id }); canvas.current?.focusNode(id); }} />}</> : <main className="concept-welcome"><ConceptMapMark /><p className="concept-eyebrow">Conecte ideias. Amplie seu olhar.</p><h1>Seu conhecimento,<br />visto de outro jeito.</h1><p>Um espaço para relacionar conceitos, organizar autores e encontrar conexões entre as suas leituras.</p><button className="concept-button concept-primary" disabled={!loaded} onClick={() => { setError(''); setDialog('create'); }}><Plus size={16} />Criar meu primeiro mapa</button><small>{loaded ? 'Comece com um tema e deixe as ideias se conectarem.' : 'Carregando seus mapas…'}</small></main>}
      </div>
    </div>
    {dialog && <MapDialog kind={dialog} title={map?.title ?? ''} busy={busy} error={error} close={() => { if (!busy) { setDialog(null); setError(''); } }} submit={submitDialog} />}
  </div>;
}
