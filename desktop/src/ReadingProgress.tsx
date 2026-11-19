import { BookmarkCheck, Check, LoaderCircle, TriangleAlert } from 'lucide-react';
import type { EpubLocation, ReadingMode } from './types';
import { pageRange, percentage } from './reading';

export type SaveStatus = 'saving' | 'saved' | 'error';

interface Props {
  page: number;
  total: number;
  savedPage: number;
  status: SaveStatus;
  mode: ReadingMode;
  disabled: boolean;
  onJump(page: number): void;
  epub?: EpubLocation | null;
  onProgress?(progress: number): void;
}

export function ReadingProgress({ page, total, savedPage, status, mode, disabled, onJump, epub, onProgress }: Props) {
  if (epub) {
    const percent = epub.atEnd ? 100 : Math.min(99, Math.round(epub.progress * 100));
    return <footer className="book-progress epub-progress" aria-label="Progresso da leitura">
      <div className="progress-summary"><div className="current-position"><BookmarkCheck size={17} /><strong className="epub-chapter-title" title={epub.title}>{epub.title}</strong><span className="epub-page-info">Página {epub.displayedPage} de {epub.displayedTotal} nesta seção</span></div><strong className="progress-percent">{percent}% <span>do livro</span></strong></div>
      <input className="position-slider" type="range" min={0} max={1000} step={1} value={Math.round(epub.progress * 1000)} disabled={disabled} aria-label="Posição no EPUB" aria-valuetext={`${percent}% do livro, ${epub.title}`} style={{ background: `linear-gradient(to right, var(--accent) ${epub.progress * 100}%, var(--line) 0)` }} onChange={event => onProgress?.(Number(event.target.value) / 1000)} />
      <div className={`position-saved ${status}`} role="status">{status === 'saving' ? <><LoaderCircle size={12} className="spinner" />Salvando trecho…</> : status === 'error' ? <><TriangleAlert size={12} />Não foi possível salvar a posição</> : <><Check size={13} /><span>Trecho salvo. Retomada automática ao reabrir.</span></>}<span className="navigation-hint">Seção {epub.chapter} de {epub.chapters} · a paginação acompanha o tamanho da fonte</span></div>
    </footer>;
  }
  const [first, last] = pageRange(page, total, mode);
  const percent = percentage(last, total);
  return <footer className="book-progress" aria-label="Progresso da leitura">
    <div className="progress-summary">
      <div className="current-position"><BookmarkCheck size={17} /><strong>{last > first ? `Páginas ${first}–${last}` : `Página ${page}`} <span>de {total || '—'}</span></strong>{last > first && <span className="spread-range">Páginas {first}–{last} em exibição</span>}</div>
      <strong className="progress-percent">{percent}% <span>do livro</span></strong>
    </div>
    <input className="position-slider" type="range" min={1} max={Math.max(1, total)} value={last}
      disabled={disabled || total < 2} aria-label="Ir para uma página"
      aria-valuetext={`${last > first ? `Páginas ${first} a ${last}` : `Página ${page}`} de ${total}, ${percent}% do livro`}
      style={{ background: `linear-gradient(to right, var(--accent) ${total > 1 ? (last - 1) / (total - 1) * 100 : 100}%, var(--line) 0)` }}
      onChange={event => onJump(Number(event.target.value))} />
    <div className={`position-saved ${status}`} role="status">
      {status === 'saving' ? <><LoaderCircle size={12} className="spinner" />Salvando posição…</>
        : status === 'error' ? <><TriangleAlert size={12} />Não foi possível salvar a posição</>
        : <><Check size={13} /><span>Você parou na página {savedPage}. Retomada automática ao reabrir.</span></>}
      <span className="navigation-hint">{mode === 'scroll' ? 'Role para ler ou use as setas ← →' : 'Vire as páginas pelas setas ← → ou deslize para o lado'}</span>
    </div>
  </footer>;
}
