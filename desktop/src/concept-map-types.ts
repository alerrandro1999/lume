export const conceptKinds = { idea: 'Ideia', book: 'Livro', author: 'Autor', reference: 'Referência' } as const;
export const conceptColors = { violet: 'Violeta', blue: 'Azul', teal: 'Verde', amber: 'Âmbar', rose: 'Rosa', slate: 'Cinza' } as const;
export type ConceptKind = keyof typeof conceptKinds;
export type ConceptColor = keyof typeof conceptColors;
export type ConceptPort = 'top' | 'right' | 'bottom' | 'left';
export interface ConceptSource { kind: 'book' | 'review'; id: string; recordId?: string; title?: string }
export interface ConceptNode { id: string; kind: ConceptKind; title: string; notes: string; color: ConceptColor; x: number; y: number; source: ConceptSource | null }
export interface ConceptEdge { id: string; from: string; to: string; fromPort: ConceptPort; toPort: ConceptPort; label: string; style: 'solid' | 'dashed'; color: ConceptColor }
export interface ConceptDraft { title: string; nodes: ConceptNode[]; edges: ConceptEdge[] }
export interface ConceptMap extends ConceptDraft { id: string; updatedAt: string }
export interface ConceptSummary { id: string; title: string; nodeCount: number; edgeCount: number; updatedAt: string }
export interface ConceptSourceOption { key: string; kind: ConceptKind; title: string; subtitle: string; source: ConceptSource }
export interface ConceptMapApi {
  list(): Promise<ConceptSummary[]>;
  open(id: string): Promise<ConceptMap>;
  create(title: string): Promise<ConceptMap>;
  save(id: string, value: ConceptDraft): Promise<ConceptMap>;
  remove(id: string): Promise<ConceptSummary[]>;
  sources(query: string): Promise<ConceptSourceOption[]>;
  resolve(source: ConceptSource): Promise<ConceptSource>;
  import(): Promise<ConceptMap | null>;
  export(id: string, format: 'json' | 'svg'): Promise<string | null>;
}
export const CONCEPT_WIDTH = 224, CONCEPT_HEIGHT = 132;
export const conceptDragType = 'application/x-lume-concept';
export type ConceptDrag = { kind: ConceptKind; title?: string; notes?: string; source?: ConceptSource };
export type ConceptSelection = { kind: 'node' | 'edge'; id: string } | null;
export const conceptPortNames = { top: 'superior', right: 'direita', bottom: 'inferior', left: 'esquerda' } as const;
