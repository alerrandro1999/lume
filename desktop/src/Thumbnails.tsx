import { useEffect, useRef, useState, type RefObject } from 'react';
import type { ReaderHandle } from './PdfReader';
function Thumbnail({ reader, page, selected, choose, cache }: { reader: RefObject<ReaderHandle | null>; page: number; selected: boolean; choose(): void; cache: Map<number, string> }) {
  const root = useRef<HTMLButtonElement>(null); const [url, setUrl] = useState(cache.get(page) || ''), [error, setError] = useState(false);
  useEffect(() => { let canceled = false; const observer = new IntersectionObserver(entries => { if (!entries.some(entry => entry.isIntersecting)) return; observer.disconnect(); if (cache.has(page)) { setUrl(cache.get(page)!); return; } void reader.current?.thumbnail?.(page).then(value => { if (!canceled) { if (cache.size >= 120) cache.delete(cache.keys().next().value!); cache.set(page, value); setUrl(value); } }).catch(() => { if (!canceled) setError(true); }); }, { rootMargin: '100px' }); if (root.current) observer.observe(root.current); return () => { canceled = true; observer.disconnect(); }; }, [page]);
  return <button ref={root} className={`thumbnail-item ${selected ? 'selected' : ''}`} aria-label={`Ir para página ${page} pela miniatura`} aria-current={selected ? 'page' : undefined} onClick={choose}>{url ? <img src={url} alt={`Miniatura da página ${page}`} /> : <span>{error ? 'Prévia indisponível' : 'Carregando…'}</span>}<small>Página {page}</small></button>;
}
export function Thumbnails({ id, reader, page, total, navigate, close }: { id: string; reader: RefObject<ReaderHandle | null>; page: number; total: number; navigate(page: number): void; close(): void }) {
  const [group, setGroup] = useState(Math.floor((page - 1) / 30)); const cache = useRef(new Map<number, string>());
  useEffect(() => { cache.current.clear(); setGroup(Math.floor((page - 1) / 30)); }, [id]);
  useEffect(() => { setGroup(Math.floor((page - 1) / 30)); }, [page]);
  const first = group * 30 + 1, last = Math.min(total, first + 29);
  return <aside className="thumbnail-panel" aria-label="Miniaturas das páginas"><header><strong>Miniaturas</strong><button onClick={close} aria-label="Fechar miniaturas">×</button></header><div className="thumbnail-range"><button disabled={group === 0} onClick={() => setGroup(group - 1)} aria-label="Miniaturas anteriores">←</button><small>{first}–{last} de {total}</small><button disabled={last >= total} onClick={() => setGroup(group + 1)} aria-label="Próximas miniaturas">→</button></div><div className="thumbnail-list">{Array.from({ length: Math.max(0, last - first + 1) }, (_, index) => first + index).map(number => <Thumbnail key={`${id}-${number}`} reader={reader} page={number} selected={number === page} choose={() => navigate(number)} cache={cache.current} />)}</div></aside>;
}
