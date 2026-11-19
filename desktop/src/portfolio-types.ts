export const portfolioKinds = { education: 'Formação', experience: 'Experiência', project: 'Projeto', certificate: 'Curso ou certificação', activity: 'Atividade acadêmica' } as const;
export const portfolioSkillCategories = { technical: 'Técnica', interpersonal: 'Interpessoal', language: 'Idioma' } as const;
export const portfolioSkillLevels = { learning: 'Em desenvolvimento', practicing: 'Na prática', confident: 'Com autonomia' } as const;
export const portfolioExperienceTypes = { internship: 'Estágio', work: 'Trabalho', volunteer: 'Voluntariado', other: 'Outra experiência' } as const;
export interface PortfolioProfile { name: string; headline: string; course: string; institution: string; location: string; email: string; phone: string; linkedin: string; website: string; about: string; objective: string }
export interface PortfolioEntryDraft { kind: keyof typeof portfolioKinds; title: string; organization: string; role: string; start: string; end: string; current: boolean; summary: string; outcomes: string; skills: string; url: string; visible: boolean; featured: boolean; experienceType: keyof typeof portfolioExperienceTypes; supervisor: string; targetHours: number }
export interface PortfolioEntry extends PortfolioEntryDraft { id: string; sourceProjectId: string }
export interface PortfolioSkillDraft { name: string; category: keyof typeof portfolioSkillCategories; level: keyof typeof portfolioSkillLevels }
export interface PortfolioSkill extends PortfolioSkillDraft { id: string }
export interface PortfolioLogDraft { entryId: string; date: string; minutes: number; activity: string; learning: string }
export interface PortfolioLog extends PortfolioLogDraft { id: string }
export interface PortfolioEvidence { id: string; entryId: string; name: string; extension: string; size: number }
export interface PortfolioPreferences { theme: 'ocean' | 'violet' | 'forest'; showContacts: boolean; showSkills: boolean }
export interface PortfolioData { version: 1; profile: PortfolioProfile; preferences: PortfolioPreferences; entries: PortfolioEntry[]; skills: PortfolioSkill[]; logs: PortfolioLog[]; evidence: PortfolioEvidence[] }
export interface PortfolioApi {
  read(): Promise<PortfolioData>; profile(value: PortfolioProfile): Promise<PortfolioData>; preferences(value: PortfolioPreferences): Promise<PortfolioData>;
  entry(id: string | null, value: PortfolioEntryDraft): Promise<PortfolioData>; removeEntry(id: string): Promise<PortfolioData>; toggle(id: string, visible: boolean): Promise<PortfolioData>; move(id: string, delta: number): Promise<PortfolioData>;
  skill(id: string | null, value: PortfolioSkillDraft): Promise<PortfolioData>; removeSkill(id: string): Promise<PortfolioData>;
  log(id: string | null, value: PortfolioLogDraft): Promise<PortfolioData>; removeLog(id: string): Promise<PortfolioData>;
  projects(): Promise<{ id: string; title: string }[]>; importProject(id: string): Promise<PortfolioData>; openProject(id: string): Promise<string>;
  evidence(id: string): Promise<{ data: PortfolioData; added: number; errors: { name: string; detail: string }[] } | null>; removeEvidence(id: string): Promise<PortfolioData>; openEvidence(id: string): Promise<void>; openUrl(id: string): Promise<void>;
  preview(): Promise<string>; export(format: 'pdf' | 'html' | 'csv'): Promise<string | null>;
}
export const portfolioProjectEvent = 'lume-open-portfolio-project';
export const portfolioDuration = (minutes: number) => `${Math.floor(minutes / 60)} h${minutes % 60 ? ' ' + minutes % 60 + ' min' : ''}`;
