export const researchTypes = { tcc: 'TCC', research: 'Pesquisa', extension: 'Extensão', other: 'Outro projeto' } as const;
export const researchStates = { active: 'Em andamento', on_hold: 'Em pausa', completed: 'Concluído' } as const;
export const researchTaskStates = { todo: 'A fazer', doing: 'Em andamento', review: 'Em revisão', done: 'Concluída' } as const;
export const researchPriorities = { low: 'Baixa', medium: 'Média', high: 'Alta' } as const;
export type ResearchTaskState = keyof typeof researchTaskStates;
export interface ResearchSettings { title: string; type: keyof typeof researchTypes; status: keyof typeof researchStates; course: string; student: string; advisor: string; team: string; startDate: string; deadline: string }
export interface ResearchPlan { topic: string; problem: string; generalObjective: string; specificObjectives: string; methodology: string; notes: string }
export interface ResearchStageDraft { title: string; notes: string; deadline: string; status: ResearchTaskState }
export interface ResearchStage extends ResearchStageDraft { id: string }
export interface ResearchTaskDraft { title: string; notes: string; owner: string; dueDate: string; priority: keyof typeof researchPriorities; status: ResearchTaskState; stageId: string }
export interface ResearchTask extends ResearchTaskDraft { id: string; originMeetingId: string }
export interface ResearchMeetingDraft { date: string; advisor: string; notes: string; nextSteps: string; followupDue: string }
export interface ResearchMeeting extends ResearchMeetingDraft { id: string; taskIds: string[] }
export interface ResearchSource { kind: 'book' | 'lesson' | 'review' | 'map' | 'presentation'; id: string }
export interface ResearchSourceOption extends ResearchSource { title: string }
export type ResearchMaterialDraft = { kind: 'hub'; title: string; notes: string; url: ''; source: ResearchSource } | { kind: 'link'; title: string; notes: string; url: string; source: null };
export type ResearchMaterial = ResearchMaterialDraft & { id: string } | { id: string; kind: 'file'; title: string; name: string; notes: string; extension: string; size: number };
export interface ResearchProject extends ResearchSettings { id: string; updatedAt: string; plan: ResearchPlan; stages: ResearchStage[]; tasks: ResearchTask[]; meetings: ResearchMeeting[]; materials: ResearchMaterial[] }
export interface ResearchSummary { id: string; title: string; type: ResearchSettings['type']; status: ResearchSettings['status']; deadline: string; updatedAt: string; tasks: number; done: number }
export interface ResearchApi {
  list(): Promise<ResearchSummary[]>; open(id: string): Promise<ResearchProject>; create(value: ResearchSettings): Promise<ResearchProject>;
  settings(id: string, value: ResearchSettings): Promise<ResearchProject>; plan(id: string, value: ResearchPlan): Promise<ResearchProject>; remove(id: string): Promise<ResearchSummary[]>;
  stage(id: string, stageId: string | null, value: ResearchStageDraft): Promise<ResearchProject>; removeStage(id: string, stageId: string): Promise<ResearchProject>;
  task(id: string, taskId: string | null, value: ResearchTaskDraft): Promise<ResearchProject>; move(id: string, taskId: string, status: ResearchTaskState): Promise<ResearchProject>; removeTask(id: string, taskId: string): Promise<ResearchProject>;
  meeting(id: string, meetingId: string | null, value: ResearchMeetingDraft, createTasks: boolean): Promise<ResearchProject>; removeMeeting(id: string, meetingId: string): Promise<ResearchProject>;
  sources(): Promise<ResearchSourceOption[]>; material(id: string, value: ResearchMaterialDraft): Promise<ResearchProject>; files(id: string): Promise<{ project: ResearchProject; added: number; errors: { name: string; detail: string }[] } | null>;
  openMaterial(id: string, materialId: string): Promise<ResearchSource | null>; removeMaterial(id: string, materialId: string): Promise<ResearchProject>;
  export(id: string, format: 'md' | 'csv'): Promise<string | null>;
}
export const researchSourceEvent = 'lume-open-project-source';
export const researchTaskDrag = 'application/x-lume-research-task';
