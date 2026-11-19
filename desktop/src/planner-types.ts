export const plannerKinds = { task: 'Tarefa', exam: 'Prova', assignment: 'Trabalho', reading: 'Leitura', review: 'Revisão' } as const;
export const plannerPriorities = { high: 'Alta', medium: 'Média', low: 'Baixa' } as const;
export const plannerColors = { sage: 'Verde', amber: 'Âmbar', blue: 'Azul', purple: 'Lilás', rose: 'Rosa' } as const;
export type PlannerKind = keyof typeof plannerKinds;
export type PlannerPriority = keyof typeof plannerPriorities;
export interface PlannerCourseDraft { name: string; teacher: string; color: keyof typeof plannerColors }
export interface PlannerCourse extends PlannerCourseDraft { id: string }
export interface PlannerMaterial { kind: 'book' | 'lesson' | 'review'; id: string; recordId?: string }
export interface PlannerMaterialOption extends PlannerMaterial { title: string }
export interface PlannerTaskDraft {
  title: string;
  courseId: string;
  kind: PlannerKind;
  priority: PlannerPriority;
  dueDate: string;
  time: string;
  notes: string;
  material: PlannerMaterial | null;
}
export interface PlannerTask extends PlannerTaskDraft { id: string; status: 'pending' | 'done'; completedOn: string }
export interface PlannerData { version: 1; courses: PlannerCourse[]; tasks: PlannerTask[]; goals: Record<string, number> }
export interface PlannerApi {
  read(): Promise<PlannerData>;
  saveCourse(id: string | null, value: PlannerCourseDraft): Promise<PlannerData>;
  removeCourse(id: string): Promise<PlannerData>;
  saveTask(id: string | null, value: PlannerTaskDraft): Promise<PlannerData>;
  completeTask(id: string, completed: boolean): Promise<PlannerData>;
  removeTask(id: string): Promise<PlannerData>;
  saveGoal(week: string, target: number): Promise<PlannerData>;
  materials(): Promise<PlannerMaterialOption[]>;
}
export const plannerMaterialEvent = 'lume-planner-open-material';
