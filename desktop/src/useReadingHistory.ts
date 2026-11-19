import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { ReaderHandle } from './PdfReader';
export interface ReadingPoint { page: number; location?: string }
export function useReadingHistory(id: string | undefined, reader: RefObject<ReaderHandle | null>, snapshot: () => ReadingPoint) {
  const latest = useRef(snapshot); latest.current = snapshot;
  const previous = useRef<ReadingPoint[]>([]), next = useRef<ReadingPoint[]>([]);
  const [counts, setCounts] = useState({ previous: 0, next: 0 });
  const publish = () => setCounts({ previous: previous.current.length, next: next.current.length });
  useEffect(() => { previous.current = []; next.current = []; publish(); }, [id]);
  const capture = useCallback(() => {
    window.dispatchEvent(new Event('lume-reading-jump'));
    const point = latest.current(), last = previous.current.at(-1);
    if (last?.page !== point.page || last?.location !== point.location) previous.current = [...previous.current.slice(-49), point];
    next.current = []; publish();
  }, []);
  const go = (point: ReadingPoint) => { window.dispatchEvent(new Event('lume-reading-jump')); if (point.location) reader.current?.destination(point.location); else reader.current?.page(point.page); };
  return { ...counts, capture, back: () => { const point = previous.current.pop(); if (point) { next.current.push(latest.current()); go(point); publish(); } }, forward: () => { const point = next.current.pop(); if (point) { previous.current.push(latest.current()); go(point); publish(); } } };
}
