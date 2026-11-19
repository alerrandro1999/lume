export const bibliographyStages = [
  ['pending', 'Para triar'],
  ['screen_excluded', 'Excluídas na triagem'],
  ['awaiting_text', 'Aguardando texto completo'],
  ['not_retrieved', 'Texto não recuperado'],
  ['awaiting_assessment', 'Texto recuperado · a avaliar'],
  ['full_excluded', 'Excluídas após leitura'],
  ['included', 'Incluídas'],
] as const;

export type BibliographyStage = typeof bibliographyStages[number][0];
export type BibliographyExport = 'evidence' | 'prisma';
export type BibliographyOrigin = { source: string; kind: 'database' | 'register' };
export interface BibliographySettings { title: string; question: string; includeCriteria: string; excludeCriteria: string }
export interface BibliographySummary { id: string; title: string; recordCount: number; updatedAt: number }
export interface BibliographyFlow {
  counts: Record<BibliographyStage, number>;
  database: number;
  register: number;
  identified: number;
  duplicates: number;
  invalid: number;
  screened: number;
  reportsSought: number;
  reportsNotRetrieved: number;
  reportsAssessed: number;
  articlesIncluded: number;
  studiesIncluded: number | null;
  studyKeysMissing: number;
  fullTextReasons: { reason: string; count: number }[];
}
export interface BibliographySource extends BibliographyOrigin { name: string; identified: number; duplicates: number; invalid: number; added: number; importedAt: number }
export interface BibliographyProject extends BibliographySummary, BibliographySettings { flow: BibliographyFlow; sources: BibliographySource[] }
export interface EvidenceRecord {
  studyKey: string;
  design: string;
  population: string;
  intervention: string;
  comparison: string;
  outcomes: string;
  results: string;
  limitations: string;
}
export interface BibliographyRecordHeader { id: string; title: string; authors: string; year: string; journal: string; status: BibliographyStage; doi: string }
export interface BibliographyDecision { status: BibliographyStage; reason: string; notes: string; evidence: EvidenceRecord }
export interface BibliographyRecord extends BibliographyRecordHeader, BibliographyDecision { url: string; abstract: string; source: string; decidedAt?: number }
export interface BibliographyFilter { stage: BibliographyStage | ''; query: string; page: number }
export interface BibliographyPage { page: number; total: number; pageSize: number; rows: BibliographyRecordHeader[] }
export interface BibliographyImportReport { added: number; duplicates: number; invalid: number; repeated: string[]; duplicateExamples: string[]; errors: { file: string; detail: string }[] }

export interface BibliographyApi {
  list(): Promise<BibliographySummary[]>;
  create(title: string): Promise<BibliographyProject>;
  open(id: string): Promise<BibliographyProject>;
  configure(id: string, value: BibliographySettings): Promise<BibliographyProject>;
  references(id: string, filter: BibliographyFilter): Promise<BibliographyPage>;
  reference(id: string, recordId: string): Promise<BibliographyRecord>;
  update(id: string, recordId: string, value: BibliographyDecision): Promise<{ project: BibliographyProject; record: BibliographyRecord }>;
  importReferences(id: string, origin: BibliographyOrigin): Promise<{ project: BibliographyProject; report: BibliographyImportReport } | null>;
  openSource(id: string, recordId: string): Promise<void>;
  export(id: string, format: BibliographyExport): Promise<string | null>;
}
