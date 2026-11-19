import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { BookOpen, FileText, Hand, Lightbulb, Link2, Maximize2, Minus, MousePointer2, Plus, UserRound, X } from 'lucide-react';
import { clampZoom, conceptCurve, fitConcept, nodePort, type ConceptView, type Point } from './concept-geometry';
import { CONCEPT_HEIGHT, CONCEPT_WIDTH, conceptDragType, conceptKinds, conceptPortNames, type ConceptDrag, type ConceptKind, type ConceptMap, type ConceptNode, type ConceptPort, type ConceptSelection } from './concept-map-types';

export const ConceptKindIcon = ({ kind, size = 15 }: { kind: ConceptKind; size?: number }) => kind === 'book' ? <BookOpen size={size} /> : kind === 'author' ? <UserRound size={size} /> : kind === 'reference' ? <FileText size={size} /> : <Lightbulb size={size} />;
const portList: ConceptPort[] = ['top', 'right', 'bottom', 'left'];
const colors = ['violet', 'blue', 'teal', 'amber', 'rose', 'slate'];
type Gesture = { kind: 'node'; id: string; start: Point; initial: Point; point: Point } | { kind: 'pan'; start: Point; view: ConceptView } | { kind: 'connect'; from: string; port: ConceptPort; start: Point; moved: boolean };
export interface ConceptCanvasHandle { center(): Point; fit(): void; focusNode(id: string): void }
interface Props {
  map: ConceptMap; selection: ConceptSelection; select(value: ConceptSelection): void;
  move(id: string, point: Point): void; add(value: ConceptDrag, point: Point): void;
  connect(from: string, to: string, fromPort: ConceptPort, toPort: ConceptPort): void; remove(): void;
}

export const ConceptCanvas = forwardRef<ConceptCanvasHandle, Props>(function ConceptCanvas({ map, selection, select, move, add, connect, remove }, ref) {
  const root = useRef<HTMLDivElement>(null);
  const currentMap = useRef(map); currentMap.current = map;
  const [size, setSize] = useState({ width: 900, height: 600 });
  const [view, setViewState] = useState<ConceptView>({ x: 80, y: 80, zoom: 1 });
  const viewRef = useRef(view);
  function setView(next: ConceptView) { viewRef.current = next; setViewState(next); }
  const [tool, setTool] = useState<'select' | 'pan'>('select');
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<{ id: string; point: Point } | null>(null);
  const [wire, setWire] = useState<Point | null>(null);
  const [armed, setArmed] = useState<{ id: string; port: ConceptPort } | null>(null);
  const gesture = useRef<Gesture | null>(null);
  const space = useRef(false);
  const fitted = useRef(false);
  function local(clientX: number, clientY: number): Point {
    const box = root.current!.getBoundingClientRect(), camera = viewRef.current;
    return { x: (clientX - box.left - camera.x) / camera.zoom, y: (clientY - box.top - camera.y) / camera.zoom };
  }
  function fit() { if (root.current) setView(fitConcept(currentMap.current.nodes, root.current.clientWidth, root.current.clientHeight)); }
  function zoomAt(zoom: number, point: Point) {
    const previous = viewRef.current, next = clampZoom(zoom);
    setView({ zoom: next, x: point.x - (point.x - previous.x) * next / previous.zoom, y: point.y - (point.y - previous.y) * next / previous.zoom });
  }
  useImperativeHandle(ref, () => ({
    center: () => { const camera = viewRef.current; return { x: ((root.current?.clientWidth ?? 800) / 2 - camera.x) / camera.zoom - CONCEPT_WIDTH / 2, y: ((root.current?.clientHeight ?? 600) / 2 - camera.y) / camera.zoom - CONCEPT_HEIGHT / 2 }; },
    fit,
    focusNode: id => { const node = currentMap.current.nodes.find(item => item.id === id); if (node && root.current) { const zoom = viewRef.current.zoom; setView({ zoom, x: root.current.clientWidth / 2 - (node.x + CONCEPT_WIDTH / 2) * zoom, y: root.current.clientHeight / 2 - (node.y + CONCEPT_HEIGHT / 2) * zoom }); } },
  }));
  useEffect(() => {
    const element = root.current!;
    const observer = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      if (!width || !height) return;
      setSize({ width, height });
      if (!fitted.current) { fitted.current = true; setView(fitConcept(currentMap.current.nodes, width, height)); }
    });
    observer.observe(element);
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const box = element.getBoundingClientRect();
      if (event.shiftKey) setView({ ...viewRef.current, x: viewRef.current.x - event.deltaY, y: viewRef.current.y - event.deltaX });
      else zoomAt(viewRef.current.zoom * Math.exp(-event.deltaY * .0017), { x: event.clientX - box.left, y: event.clientY - box.top });
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => { observer.disconnect(); element.removeEventListener('wheel', wheel); };
  }, []);
  useEffect(() => { setArmed(null); setWire(null); setPreview(null); gesture.current = null; space.current = false; fitted.current = false; fit(); if (root.current?.clientWidth) fitted.current = true; }, [map.id]);

  function capture(event: ReactPointerEvent, value: Gesture) {
    if (event.button !== 0 && event.button !== 1) return;
    event.preventDefault(); event.stopPropagation();
    root.current?.setPointerCapture(event.pointerId); gesture.current = value; setDragging(true);
  }
  function nodeDown(event: ReactPointerEvent, node: ConceptNode) {
    if (event.button !== 0 && event.button !== 1) return;
    if (tool === 'pan' || space.current || event.button === 1) { capture(event, { kind: 'pan', start: { x: event.clientX, y: event.clientY }, view: { ...viewRef.current } }); return; }
    if (armed && armed.id !== node.id) { event.stopPropagation(); connect(armed.id, node.id, armed.port, 'left'); setArmed(null); setWire(null); return; }
    select({ kind: 'node', id: node.id });
    capture(event, { kind: 'node', id: node.id, start: { x: event.clientX, y: event.clientY }, initial: { x: node.x, y: node.y }, point: { x: node.x, y: node.y } });
    (event.currentTarget as HTMLElement).focus({ preventScroll: true });
  }
  function portDown(event: ReactPointerEvent, node: ConceptNode, port: ConceptPort) {
    if (event.button !== 0) return;
    if (armed && armed.id !== node.id) { event.preventDefault(); event.stopPropagation(); connect(armed.id, node.id, armed.port, port); setArmed(null); setWire(null); return; }
    select({ kind: 'node', id: node.id }); setArmed({ id: node.id, port }); setWire(nodePort(node, port));
    capture(event, { kind: 'connect', from: node.id, port, start: { x: event.clientX, y: event.clientY }, moved: false });
  }
  function portKeyboard(node: ConceptNode, port: ConceptPort) {
    if (armed && armed.id !== node.id) { connect(armed.id, node.id, armed.port, port); setArmed(null); setWire(null); }
    else { select({ kind: 'node', id: node.id }); setArmed({ id: node.id, port }); setWire(nodePort(node, port)); }
  }
  function pointerMove(event: ReactPointerEvent) {
    const active = gesture.current;
    if (!active) { if (armed) setWire(local(event.clientX, event.clientY)); return; }
    const delta = { x: event.clientX - active.start.x, y: event.clientY - active.start.y };
    if (active.kind === 'pan') setView({ ...active.view, x: active.view.x + delta.x, y: active.view.y + delta.y });
    if (active.kind === 'node') {
      const point = { x: Math.round(Math.max(-100000, Math.min(100000, active.initial.x + delta.x / viewRef.current.zoom)) / 8) * 8, y: Math.round(Math.max(-100000, Math.min(100000, active.initial.y + delta.y / viewRef.current.zoom)) / 8) * 8 };
      active.point = point; setPreview({ id: active.id, point });
    }
    if (active.kind === 'connect') { active.moved ||= Math.hypot(delta.x, delta.y) > 4; setWire(local(event.clientX, event.clientY)); }
  }
  function end(event: ReactPointerEvent) {
    const active = gesture.current;
    gesture.current = null; setDragging(false); setPreview(null);
    if (!active) return;
    if (active.kind === 'node' && (active.point.x !== active.initial.x || active.point.y !== active.initial.y)) move(active.id, active.point);
    if (active.kind === 'connect' && active.moved) {
      const element = document.elementFromPoint(event.clientX, event.clientY);
      const handle = element?.closest<HTMLElement>('[data-concept-port]');
      const card = element?.closest<HTMLElement>('[data-concept-node]');
      const id = handle?.dataset.nodeId ?? card?.dataset.conceptNode;
      if (id && id !== active.from) connect(active.from, id, active.port, (handle?.dataset.conceptPort as ConceptPort) || 'left');
      setArmed(null); setWire(null);
    }
    if (root.current?.hasPointerCapture(event.pointerId)) root.current.releasePointerCapture(event.pointerId);
  }
  function cancel() { gesture.current = null; setDragging(false); setPreview(null); setArmed(null); setWire(null); }
  const nodes = map.nodes.map(node => preview?.id === node.id ? { ...node, ...preview.point } : node);
  const fromNode = nodes.find(node => node.id === armed?.id);
  const previewCurve = fromNode && armed && wire ? conceptCurve(nodePort(fromNode, armed.port), wire, armed.port, 'left') : null;
  const minX = Math.min(0, ...nodes.map(node => node.x)) - 100, minY = Math.min(0, ...nodes.map(node => node.y)) - 100;
  const miniWidth = Math.max(500, ...nodes.map(node => node.x + CONCEPT_WIDTH)) - minX + 100;
  const miniHeight = Math.max(300, ...nodes.map(node => node.y + CONCEPT_HEIGHT)) - minY + 100;
  return <div ref={root} className={`concept-canvas ${tool === 'pan' ? 'concept-hand' : ''} ${dragging ? 'concept-dragging' : ''} ${armed ? 'concept-connecting' : ''}`} role="region" aria-label="Quadro do mapa conceitual" tabIndex={0}
    style={{ backgroundSize: `${24 * view.zoom}px ${24 * view.zoom}px`, backgroundPosition: `${view.x}px ${view.y}px` }}
    onPointerDown={event => { if (event.button !== 0 && event.button !== 1) return; setArmed(null); setWire(null); select(null); root.current?.focus(); capture(event, { kind: 'pan', start: { x: event.clientX, y: event.clientY }, view: { ...viewRef.current } }); }}
    onPointerMove={pointerMove} onPointerUp={end} onPointerCancel={cancel} onLostPointerCapture={() => { if (gesture.current) cancel(); }}
    onKeyDown={event => {
      if (event.key === 'Escape') cancel();
      if (event.code === 'Space' && event.target === event.currentTarget) { event.preventDefault(); space.current = true; }
      if (['Delete', 'Backspace'].includes(event.key)) { event.preventDefault(); remove(); }
    }} onKeyUp={event => { if (event.code === 'Space') space.current = false; }} onBlur={() => { space.current = false; }}
    onDragOver={event => { if (event.dataTransfer.types.includes(conceptDragType)) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; } }}
    onDrop={event => { event.preventDefault(); const data = event.dataTransfer.getData(conceptDragType); if (!data) return; try { const value = JSON.parse(data) as ConceptDrag; if (!(value.kind in conceptKinds)) return; const point = local(event.clientX, event.clientY); add(value, { x: point.x - CONCEPT_WIDTH / 2, y: point.y - CONCEPT_HEIGHT / 2 }); } catch { /* Ignora um arraste de outro aplicativo. */ } }}
    onDoubleClick={event => { if (event.target === root.current) { const point = local(event.clientX, event.clientY); add({ kind: 'idea' }, { x: point.x - CONCEPT_WIDTH / 2, y: point.y - CONCEPT_HEIGHT / 2 }); } }}>
    <div className="concept-board-toolbar" onPointerDown={event => event.stopPropagation()} aria-label="Ferramentas do quadro"><button aria-label="Selecionar e mover blocos" aria-pressed={tool === 'select'} onClick={() => setTool('select')}><MousePointer2 size={17} /></button><button aria-label="Mover o quadro" aria-pressed={tool === 'pan'} onClick={() => setTool('pan')}><Hand size={17} /></button><i /><button aria-label="Adicionar ideia ao centro" onClick={() => { const camera = viewRef.current; add({ kind: 'idea' }, { x: (size.width / 2 - camera.x) / camera.zoom - CONCEPT_WIDTH / 2, y: (size.height / 2 - camera.y) / camera.zoom - CONCEPT_HEIGHT / 2 }); }}><Plus size={17} /><span>Ideia</span></button></div>
    <div className="concept-world" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}>
      <svg className="concept-wires" width="1" height="1" aria-label="Conexões do mapa"><defs>{colors.map(color => <marker key={color} id={`concept-arrow-${color}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" style={{ fill: `var(--concept-${color})` }} /></marker>)}</defs>
        {map.edges.map(edge => {
          const from = nodes.find(node => node.id === edge.from), to = nodes.find(node => node.id === edge.to);
          if (!from || !to) return null;
          const curve = conceptCurve(nodePort(from, edge.fromPort), nodePort(to, edge.toPort), edge.fromPort, edge.toPort);
          const label = edge.label.length > 40 ? edge.label.slice(0, 39) + '…' : edge.label;
          const width = Math.max(38, label.length * 6.5 + 20);
          return <g key={edge.id} data-concept-edge={edge.id} role="button" tabIndex={0} aria-label={`Conexão de ${from.title} para ${to.title}${edge.label ? ': ' + edge.label : ''}`} className={`concept-edge concept-color-${edge.color} ${selection?.kind === 'edge' && selection.id === edge.id ? 'is-selected' : ''}`} onPointerDown={event => { event.stopPropagation(); select({ kind: 'edge', id: edge.id }); }} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select({ kind: 'edge', id: edge.id }); } }}>
            <title>{edge.label || 'Editar conexão'}</title><path className="concept-edge-hit" d={curve.path} /><path className="concept-edge-line" d={curve.path} strokeDasharray={edge.style === 'dashed' ? '7 5' : undefined} markerEnd={`url(#concept-arrow-${edge.color})`} />
            {label && <g className="concept-edge-caption" transform={`translate(${curve.label.x}, ${curve.label.y})`}><rect x={-width / 2} y={-13} width={width} height={26} rx={8} /><text textAnchor="middle" dominantBaseline="central">{label}</text></g>}
          </g>;
        })}
        {previewCurve && <path className="concept-wire-preview" d={previewCurve.path} />}
      </svg>
      {nodes.map(node => <div key={node.id} className={`concept-node concept-color-${node.color} ${selection?.kind === 'node' && selection.id === node.id ? 'is-selected' : ''} ${armed?.id === node.id ? 'is-connecting' : ''}`} data-concept-node={node.id} style={{ transform: `translate(${node.x}px, ${node.y}px)`, width: CONCEPT_WIDTH, height: CONCEPT_HEIGHT }}>
        <div className="concept-node-body" role="button" tabIndex={0} aria-label={`Bloco ${conceptKinds[node.kind]}: ${node.title}`} onPointerDown={event => nodeDown(event, node)} onKeyDown={event => {
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); if (armed && armed.id !== node.id) { connect(armed.id, node.id, armed.port, 'left'); setArmed(null); setWire(null); } else select({ kind: 'node', id: node.id }); }
          const directions: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
          const delta = directions[event.key];
          if (delta) { event.preventDefault(); move(node.id, { x: node.x + delta[0] * (event.shiftKey ? 32 : 8), y: node.y + delta[1] * (event.shiftKey ? 32 : 8) }); }
        }}><div className="concept-node-kind"><ConceptKindIcon kind={node.kind} size={13} /><span>{conceptKinds[node.kind]}</span>{node.source && <Link2 size={12} aria-label="Material vinculado" />}</div><strong title={node.title}>{node.title}</strong><p>{node.notes || (node.source ? node.source.title || 'Material do hub vinculado' : 'Selecione para escrever suas notas.')}</p></div>
        {portList.map(port => <button key={port} className={`concept-port concept-port-${port}`} aria-label={`Conectar ${node.title} pela ${conceptPortNames[port]}`} data-concept-port={port} data-node-id={node.id} onPointerDown={event => portDown(event, node, port)} onClick={event => { if (event.detail === 0) portKeyboard(node, port); }} />)}
      </div>)}
    </div>
    {!nodes.length && <div className="concept-canvas-empty" onPointerDown={event => event.stopPropagation()}><span><Lightbulb size={27} strokeWidth={1.5} /></span><h2>Uma ideia puxa a outra.</h2><p>Arraste um bloco da lateral para começar.<br />Depois, ligue os pontos para construir seu raciocínio.</p><button className="concept-button concept-primary" onClick={() => add({ kind: 'idea' }, { x: 0, y: 0 })}><Plus size={15} />Criar primeira ideia</button></div>}
    {armed && <div className="concept-connect-hint" onPointerDown={event => event.stopPropagation()} aria-live="polite"><Link2 size={14} /><span>Solte sobre outro bloco ou clique no destino.</span><button aria-label="Cancelar conexão" onClick={cancel}><X size={14} /></button></div>}
    <div className="concept-canvas-footer" onPointerDown={event => event.stopPropagation()}><div className="concept-zoom"><button aria-label="Diminuir zoom do mapa" onClick={() => zoomAt(view.zoom / 1.2, { x: size.width / 2, y: size.height / 2 })}><Minus size={15} /></button><span aria-label="Zoom do mapa">{Math.round(view.zoom * 100)}%</span><button aria-label="Aumentar zoom do mapa" onClick={() => zoomAt(view.zoom * 1.2, { x: size.width / 2, y: size.height / 2 })}><Plus size={15} /></button><i /><button aria-label="Enquadrar todo o mapa" onClick={fit}><Maximize2 size={15} /></button></div><small>{nodes.length} blocos · {map.edges.length} conexões</small></div>
    {nodes.length > 0 && <svg className="concept-minimap" role="img" aria-label="Visão geral do mapa" viewBox={`${minX} ${minY} ${miniWidth} ${miniHeight}`} preserveAspectRatio="none" onPointerDown={event => {
      event.stopPropagation(); const box = event.currentTarget.getBoundingClientRect();
      const x = minX + (event.clientX - box.left) / box.width * miniWidth, y = minY + (event.clientY - box.top) / box.height * miniHeight;
      setView({ ...viewRef.current, x: size.width / 2 - x * viewRef.current.zoom, y: size.height / 2 - y * viewRef.current.zoom });
    }}>{nodes.map(node => <rect key={node.id} x={node.x} y={node.y} width={CONCEPT_WIDTH} height={CONCEPT_HEIGHT} rx="14" fill={`var(--concept-${node.color})`} opacity=".7" />)}<rect className="concept-minimap-viewport" x={-view.x / view.zoom} y={-view.y / view.zoom} width={size.width / view.zoom} height={size.height / view.zoom} strokeWidth={Math.max(miniWidth, miniHeight) / 140} /></svg>}
  </div>;
});
