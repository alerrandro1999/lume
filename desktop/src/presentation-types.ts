export interface PresentationSection { title: string; notes: string; seconds: number }
export interface PresentationDraft { title: string; course: string; audience: string; sections: PresentationSection[] }
export const assessmentLabels = { clarity: 'Clareza', organization: 'Organização', knowledge: 'Domínio do conteúdo', pace: 'Ritmo' } as const;
export type PresentationAssessment = Record<keyof typeof assessmentLabels, number> & { notes: string };
export interface PresentationTake {
  id: string;
  createdAt: string;
  script: PresentationDraft;
  durationMs: number;
  sectionMs: number[];
  status: 'running' | 'paused' | 'finished' | 'interrupted';
  audio: boolean;
  audioUrl?: string | null;
  assessment: PresentationAssessment;
}
export interface PresentationProject extends PresentationDraft { id: string; updatedAt: string; takes: PresentationTake[] }
export interface PresentationCheckpoint { durationMs: number; section: number; sectionMs: number[] }
export interface PresentationApi {
  list(): Promise<PresentationProject[]>;
  save(id: string | null, value: PresentationDraft): Promise<PresentationProject[]>;
  remove(id: string): Promise<PresentationProject[]>;
  begin(id: string, audio: boolean): Promise<PresentationTake>;
  append(id: string, index: number, bytes: Uint8Array): Promise<void>;
  checkpoint(id: string): Promise<PresentationCheckpoint>;
  pause(id: string, paused: boolean): Promise<PresentationCheckpoint>;
  section(id: string, section: number): Promise<PresentationCheckpoint>;
  finish(id: string): Promise<PresentationProject[]>;
  cancel(id: string): Promise<PresentationProject[]>;
  assess(id: string, value: PresentationAssessment): Promise<PresentationProject[]>;
  removeTake(id: string): Promise<PresentationProject[]>;
  export(id: string, format: 'audio' | 'report'): Promise<string | null>;
  onFinishRequest(callback: () => void): () => void;
}

export function presentationTime(ms: number) {
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60).toString().padStart(2, '0')}:${(total % 60).toString().padStart(2, '0')}`;
}
