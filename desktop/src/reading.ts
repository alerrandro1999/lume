import type { ReadingMode } from './types';

export function readZoom(mode: ReadingMode): string {
  try {
    const saved = localStorage.getItem(`lume-zoom-${mode}`);
    if (saved === 'page-fit' || saved === 'page-width') return saved;
    if (saved && Number.isFinite(Number(saved)) && Number(saved) >= 0.25 && Number(saved) <= 5) return saved;
  } catch { /* Use the default if storage is unavailable. */ }
  return mode === 'scroll' ? 'page-width' : 'page-fit';
}

export function rememberZoom(mode: ReadingMode, value: string): void {
  try { localStorage.setItem(`lume-zoom-${mode}`, value); } catch { /* Zoom still works without storage. */ }
}

export function readMode(): ReadingMode {
  try {
    const saved = localStorage.getItem('lume-reading-mode');
    if (saved === 'book' || saved === 'single' || saved === 'scroll' || saved === 'text') return saved;
  } catch { /* Use the default if storage is unavailable. */ }
  return 'single';
}

export function percentage(page: number, total: number): number {
  if (total < 1) return 0;
  const position = Math.min(total, Math.max(1, page));
  // Keep 100% reserved for the last page, even in very long books.
  return position === total ? 100 : Math.min(99, Math.round(position / total * 100));
}

export function pageRange(page: number, total: number, mode: ReadingMode): [number, number] {
  if (mode !== 'book' || page === 1) return [page, page];
  const first = page % 2 === 0 ? page : page - 1;
  return [first, Math.min(first + 1, total)];
}
