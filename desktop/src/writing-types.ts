export const writingKinds = { summary: 'Resumo', review: 'Resenha', report: 'Relatório de estágio', article: 'Artigo', project: 'Projeto de pesquisa', chapter: 'Capítulo de TCC' } as const;
export type WritingKind = keyof typeof writingKinds;
export interface WritingRun { text: string; bold: boolean; italic: boolean; citationId: string }
export interface WritingBlock { id: string; type: 'paragraph' | 'heading' | 'bullet' | 'number' | 'quote'; runs: WritingRun[] }
export interface WritingSection { id: string; title: string; guide: string; notes: string; include: boolean; blocks: WritingBlock[] }
export interface WritingSource { kind: 'book' | 'review'; id: string; recordId?: string }
export interface WritingReference { source: WritingSource; title: string; authors: string; year: string; journal: string; doi: string; url: string }
export interface WritingCitation extends WritingReference { id: string; label: string; locator: string }
export interface WritingContext { projectId: string; projectTitle: string; topic: string; problem: string; objective: string; methodology: string; mapId: string; mapTitle: string }
export interface WritingDraft { title: string; type: WritingKind; author: string; course: string; goal: number; context: WritingContext; sections: WritingSection[] }
export interface WritingVersion { id: string; label: string; createdAt: string; snapshot: WritingDraft & { citations: WritingCitation[] } }
export interface WritingDocument extends WritingDraft { id: string; updatedAt: string; citations: WritingCitation[]; versions: WritingVersion[] }
export interface WritingSummary { id: string; title: string; type: WritingKind; updatedAt: string; words: number }
export interface WritingIssue { sectionId: string; blockId: string; section: string; kind: string; message: string; excerpt: string }
export interface WritingSaved { id: string; token: string; state: 'saved' | 'error'; message?: string }
export interface WritingOptions { projects: {id: string; title: string}[]; maps: {id: string; title: string}[] }
export interface WritingCreate { title: string; type: WritingKind; author: string; course: string; goal: number; projectId: string; mapId: string }
export interface WritingApi {
  list(): Promise<WritingSummary[]>; open(id: string): Promise<WritingDocument>; create(value: WritingCreate): Promise<WritingDocument>; remove(id: string): Promise<void>;
  stage(id: string, value: WritingDraft, token: string): Promise<void>; flush(id: string): Promise<WritingDocument>; options(): Promise<WritingOptions>; sources(query: string): Promise<WritingReference[]>;
  citation(id: string, source: WritingSource, value: {label: string; locator: string}): Promise<WritingDocument>; removeCitation(id: string, citationId: string): Promise<WritingDocument>; openSource(source: WritingSource): Promise<WritingSource>;
  version(id: string, label: string): Promise<WritingDocument>; restore(id: string, versionId: string): Promise<WritingDocument>; removeVersion(id: string, versionId: string): Promise<WritingDocument>;
  review(id: string): Promise<WritingIssue[]>; export(id: string, format: 'pdf' | 'docx'): Promise<string | null>; onSaved(callback: (state: WritingSaved) => void): () => void;
}
export const writingWordCount = (value: string) => (value.match(/[\p{L}\p{N}]+(?:['’‐-][\p{L}\p{N}]+)*/gu) || []).length;
export const writingBlockText = (block: WritingBlock, citations: WritingCitation[]) => block.runs.map(run => run.citationId ? citations.find(c => c.id === run.citationId)?.label || '' : run.text).join('');
export const writingSectionWords = (section: WritingSection, citations: WritingCitation[]) => section.blocks.reduce((sum, block) => sum + writingWordCount(writingBlockText(block,citations)),0);
export const writingWords = (doc: {sections: WritingSection[]; citations: WritingCitation[]}) => doc.sections.reduce((sum,section) => sum + writingSectionWords(section,doc.citations),0);
