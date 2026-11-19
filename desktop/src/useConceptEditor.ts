import { useRef, useState } from 'react';
import type { ConceptMap, ConceptMapApi, ConceptSummary } from './concept-map-types';

export const conceptError = (error: unknown) => error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : 'Não foi possível salvar o mapa.';
export function useConceptEditor(api: ConceptMapApi, saved: (map: ConceptSummary) => void) {
  const [map, setMap] = useState<ConceptMap | null>(null);
  const current = useRef<ConceptMap | null>(null);
  const [phase, setPhase] = useState<'saved' | 'saving' | 'error'>('saved');
  const [error, setError] = useState('');
  const [historySize, setHistorySize] = useState({ undo: 0, redo: 0 });
  const past = useRef<ConceptMap[]>([]), future = useRef<ConceptMap[]>([]);
  const version = useRef(0), failure = useRef('');
  const pending = useRef(new Set<Promise<void>>());
  const onSaved = useRef(saved); onSaved.current = saved;
  function history() { setHistorySize({ undo: past.current.length, redo: future.current.length }); }
  function open(next: ConceptMap | null) {
    current.current = next; setMap(next); past.current = []; future.current = []; history();
    version.current++; failure.current = ''; setError(''); setPhase('saved');
  }
  function persist(next: ConceptMap) {
    const revision = ++version.current;
    setPhase('saving'); setError(''); failure.current = '';
    const operation = api.save(next.id, next).then(result => {
      if (revision !== version.current) return;
      setPhase('saved'); failure.current = '';
      onSaved.current({ id: result.id, title: result.title, updatedAt: result.updatedAt, nodeCount: result.nodes.length, edgeCount: result.edges.length });
    }).catch(error => {
      if (revision !== version.current) return;
      failure.current = conceptError(error); setError(failure.current); setPhase('error');
    });
    pending.current.add(operation);
    void operation.finally(() => pending.current.delete(operation));
    return operation;
  }
  function commit(next: ConceptMap, record = true) {
    if (!current.current || next.id !== current.current.id) return;
    if (record) { past.current = [...past.current.slice(-49), current.current]; future.current = []; history(); }
    current.current = next; setMap(next); void persist(next);
  }
  function undo() {
    const previous = past.current.pop();
    if (!previous || !current.current) return;
    future.current.push(current.current); history(); commit(previous, false);
  }
  function redo() {
    const next = future.current.pop();
    if (!next || !current.current) return;
    past.current.push(current.current); history(); commit(next, false);
  }
  async function flush() { await Promise.all([...pending.current]); if (failure.current) throw new Error(failure.current); }
  function retry() { if (current.current) void persist(current.current); }
  return { map, current, phase, error, open, commit, undo, redo, historySize, flush, retry };
}
