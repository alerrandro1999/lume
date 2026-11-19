import { ArrowUpRight, Boxes, LayoutGrid, Moon, Sun } from 'lucide-react';
import type { ReactNode } from 'react';
import './hub.css';

export type Theme = 'light' | 'dark';
export interface HubApp { id: string; name: string; description: string; icon: ReactNode }

export function Hub({ apps, openApp, theme, toggleTheme }: { apps: readonly HubApp[]; openApp(id: string): void; theme: Theme; toggleTheme(): void }) {
  return <div className="hub">
    <header className="hub-header">
      <span className="hub-brand"><LayoutGrid size={20} aria-hidden="true" /> Hub de aplicativos</span>
      <button className="icon-button" type="button" onClick={toggleTheme} aria-label={theme === 'light' ? 'Ativar tema escuro' : 'Ativar tema claro'}>
        {theme === 'light' ? <Moon size={19} /> : <Sun size={19} />}
      </button>
    </header>
    <main className="hub-main" aria-labelledby="hub-title">
      <h1 id="hub-title">Aplicativos</h1>
      <ul className="hub-grid" aria-label="Catálogo de aplicativos">
        {apps.map(app => <li key={app.id}>
          <button type="button" id={`hub-app-${app.id}`} className="hub-card hub-card-ready" onClick={() => openApp(app.id)} aria-label={`Abrir ${app.name}`} aria-describedby={`hub-description-${app.id}`}>
            <span className="hub-card-top">
              {app.icon}
              <span className="hub-open"><ArrowUpRight size={20} aria-hidden="true" /></span>
            </span>
            <span className="hub-card-name">{app.name}</span>
            <span id={`hub-description-${app.id}`} className="hub-card-description">{app.description}</span>
            <span className="hub-card-action">Abrir</span>
          </button>
        </li>)}
        {Array.from({ length: Math.max(0, 6 - apps.length) }, (_, index) => <li key={index}>
          <div className="hub-card hub-card-pending">
            <div className="hub-card-top"><span className="hub-pending-icon"><Boxes size={23} strokeWidth={1.4} aria-hidden="true" /></span></div>
            <span className="hub-card-name">Novo aplicativo</span>
            <span className="hub-pending-status">Em breve</span>
          </div>
        </li>)}
      </ul>
    </main>
  </div>;
}
