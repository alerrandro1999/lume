import { CONCEPT_HEIGHT, CONCEPT_WIDTH, type ConceptNode, type ConceptPort } from './concept-map-types';
export interface Point { x: number; y: number }
export interface ConceptView extends Point { zoom: number }
export const clampZoom = (zoom: number) => Math.max(.2, Math.min(2, zoom));
export function nodePort(node: ConceptNode, port: ConceptPort): Point {
  return { x: node.x + (port === 'left' ? 0 : port === 'right' ? CONCEPT_WIDTH : CONCEPT_WIDTH / 2), y: node.y + (port === 'top' ? 0 : port === 'bottom' ? CONCEPT_HEIGHT : CONCEPT_HEIGHT / 2) };
}
export function conceptCurve(from: Point, to: Point, fromPort: ConceptPort, toPort: ConceptPort) {
  const bend = Math.max(60, Math.min(220, Math.hypot(to.x - from.x, to.y - from.y) / 2));
  const offset = (point: Point, port: ConceptPort) => ({ x: point.x + (port === 'right' ? bend : port === 'left' ? -bend : 0), y: point.y + (port === 'bottom' ? bend : port === 'top' ? -bend : 0) });
  const a = offset(from, fromPort), b = offset(to, toPort);
  return { path: `M ${from.x} ${from.y} C ${a.x} ${a.y}, ${b.x} ${b.y}, ${to.x} ${to.y}`, label: { x: (from.x + 3 * a.x + 3 * b.x + to.x) / 8, y: (from.y + 3 * a.y + 3 * b.y + to.y) / 8 } };
}
export function fitConcept(nodes: ConceptNode[], width: number, height: number): ConceptView {
  if (!nodes.length) return { x: Math.max(30, width / 2 - CONCEPT_WIDTH / 2), y: Math.max(30, height / 2 - CONCEPT_HEIGHT / 2), zoom: 1 };
  const minX = Math.min(...nodes.map(node => node.x)), minY = Math.min(...nodes.map(node => node.y));
  const contentWidth = Math.max(...nodes.map(node => node.x + CONCEPT_WIDTH)) - minX;
  const contentHeight = Math.max(...nodes.map(node => node.y + CONCEPT_HEIGHT)) - minY;
  const zoom = clampZoom(Math.min(1, (width - 100) / contentWidth, (height - 100) / contentHeight));
  return { x: (width - contentWidth * zoom) / 2 - minX * zoom, y: (height - contentHeight * zoom) / 2 - minY * zoom, zoom };
}
