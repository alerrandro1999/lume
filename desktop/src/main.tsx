import { createRoot } from 'react-dom/client';
import { useEffect, useLayoutEffect, useRef, useState, type ComponentProps, type ComponentType } from 'react';
import { App } from './App';
import { Hub, type HubApp, type Theme } from './Hub';
import { StudioMark, TranscriptionStudio } from './TranscriptionStudio';
import { BibliographyMark, BibliographyWorkspace } from './BibliographyWorkspace';
import { PlannerMark, PlannerWorkspace } from './PlannerWorkspace';
import { PresentationMark, PresentationWorkspace } from './PresentationWorkspace';
import { ConceptMapMark, ConceptMapWorkspace } from './ConceptMapWorkspace';
import { ResearchMark, ResearchWorkspace } from './ResearchWorkspace';
import { PortfolioMark, PortfolioWorkspace } from './PortfolioWorkspace';
import { WritingMark, WritingWorkspace } from './WritingWorkspace';
import lumeLogo from '../resources/branding/lume.svg?no-inline';
import './styles.css';
import './assistance.css';
import './epub.css';
import './study.css';

const apps: (HubApp & { View: ComponentType<ComponentProps<typeof App>> })[] = [
  { id: 'lume', name: 'Lume Leitor', description: 'Leia PDFs e EPUBs, faça anotações e ouça seus livros.', icon: <img src={lumeLogo} width={50} height={50} alt="" />, View: App },
  { id: 'transcription', name: 'Estúdio de Transcrição', description: 'Transforme gravações em texto, revise os trechos e exporte legendas.', icon: <StudioMark />, View: TranscriptionStudio },
  { id: 'bibliography', name: 'Bancada de Revisão Bibliográfica', description: 'Importe referências, faça a triagem e organize as evidências de uma revisão.', icon: <BibliographyMark />, View: BibliographyWorkspace },
  { id: 'planner', name: 'Planejador Acadêmico', description: 'Organize disciplinas, provas, trabalhos e leituras em uma agenda.', icon: <PlannerMark />, View: PlannerWorkspace },
  { id: 'presentation', name: 'Treino de Apresentação', description: 'Prepare seu roteiro, ensaie com cronômetro e ouça sua apresentação.', icon: <PresentationMark />, View: PresentationWorkspace },
  { id: 'concept-maps', name: 'Mapas Conceituais', description: 'Conecte ideias, livros, autores e referências em um quadro visual.', icon: <ConceptMapMark />, View: ConceptMapWorkspace },
  { id: 'research', name: 'Organizador de TCC e Projetos', description: 'Organize etapas, tarefas, orientações e materiais até a entrega do projeto.', icon: <ResearchMark />, View: ResearchWorkspace },
  { id: 'portfolio', name: 'Portfólio Acadêmico e de Estágio', description: 'Reúna formação, experiências, projetos e aprendizados em uma apresentação.', icon: <PortfolioMark />, View: PortfolioWorkspace },
  { id: 'writing', name: 'Oficina de Escrita Acadêmica', description: 'Escreva com roteiros, vincule fontes e revise cada etapa do seu trabalho.', icon: <WritingMark />, View: WritingWorkspace },
];
const activeAppKey = 'desktop-active-app';

function Desktop() {
  const [activeApp, setActiveApp] = useState(() => {
    try { return apps.find(app => app.id === sessionStorage.getItem(activeAppKey))?.id ?? null; } catch { return null; }
  });
  const [theme, setTheme] = useState<Theme>(() => {
    try { return localStorage.getItem('lume-theme') === 'dark' ? 'dark' : 'light'; } catch { return 'light'; }
  });
  const previous = useRef(activeApp);
  const toggleTheme = () => setTheme(value => value === 'light' ? 'dark' : 'light');

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('lume-theme', theme); } catch { /* Theme still works without persistence. */ }
  }, [theme]);

  useLayoutEffect(() => {
    try {
      if (activeApp) sessionStorage.setItem(activeAppKey, activeApp);
      else sessionStorage.removeItem(activeAppKey);
    } catch { /* Navigation still works without session storage. */ }
    if (!activeApp) document.title = 'Hub de aplicativos';
    if (previous.current !== activeApp) {
      const control = activeApp
        ? document.getElementById(`app-${activeApp}`)?.querySelector<HTMLButtonElement>('.hub-return')
        : document.getElementById(`hub-app-${previous.current}`);
      control?.focus();
    }
    previous.current = activeApp;
  }, [activeApp]);

  return <>
    {!activeApp && <Hub apps={apps} openApp={setActiveApp} theme={theme} toggleTheme={toggleTheme} />}
    {apps.map(({ id, View }) => <div key={id} id={`app-${id}`} className="app-surface" hidden={activeApp !== id}>
      <View visible={activeApp === id} activate={() => setActiveApp(id)} onOpenHub={() => setActiveApp(null)} theme={theme} toggleTheme={toggleTheme} />
    </div>)}
  </>;
}

createRoot(document.getElementById('root')!).render(<Desktop />);
