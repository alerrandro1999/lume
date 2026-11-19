import { useEffect } from 'react';
import type { BookSession } from './types';

export function useListeningSession(bookId: string | undefined, playing: boolean) {
  useEffect(() => {
    if (!bookId || !playing) return;
    const started = performance.now();
    const session: BookSession = { id: crypto.randomUUID(), kind: 'listening', startedAt: Date.now(), seconds: 0 };
    const save = () => {
      const seconds = Math.floor((performance.now() - started) / 1000);
      if (seconds <= session.seconds) return;
      session.seconds = seconds;
      void window.lume.recordListening(bookId, session).catch(() => {});
    };
    const interval = window.setInterval(save, 5000);
    window.addEventListener('pagehide', save);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('pagehide', save);
      save();
    };
  }, [bookId, playing]);
}
