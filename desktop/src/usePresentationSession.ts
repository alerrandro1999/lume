import { useEffect, useRef, useState } from 'react';
import type { PresentationApi, PresentationCheckpoint, PresentationProject, PresentationTake } from './presentation-types';

type Phase = 'running' | 'paused' | 'saving';
interface Session {
  take: PresentationTake;
  phase: Phase;
  clock: PresentationCheckpoint;
  anchor: number;
  stream?: MediaStream;
  recorder?: MediaRecorder;
  stopped?: Promise<void>;
  pending: { index: number; blob: Blob }[];
  nextChunk: number;
  writing: Promise<void> | null;
  finishing: Promise<void> | null;
}
export const presentationError = (error: unknown) => error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : 'Não foi possível concluir esta ação.';

export function usePresentationSession(api: PresentationApi, visible: boolean, saved: (projects: PresentationProject[], takeId: string) => void) {
  const active = useRef<Session | null>(null);
  const starting = useRef<Promise<void> | null>(null);
  const savedCallback = useRef(saved);
  const visibleNow = useRef(visible);
  visibleNow.current = visible;
  savedCallback.current = saved;
  const [view, setView] = useState<{ take: PresentationTake; phase: Phase; clock: PresentationCheckpoint; canResume: boolean } | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState('');

  function publish(session: Session) {
    const delta = session.phase === 'running' ? performance.now() - session.anchor : 0;
    const sectionMs = [...session.clock.sectionMs];
    sectionMs[session.clock.section] += delta;
    setView({ take: session.take, phase: session.phase, canResume: !session.recorder || session.recorder.state !== 'inactive', clock: { ...session.clock, durationMs: session.clock.durationMs + delta, sectionMs } });
  }

  function updateClock(session: Session, clock: PresentationCheckpoint) {
    session.clock = clock;
    session.anchor = performance.now();
    publish(session);
  }

  function flush(session: Session): Promise<void> {
    if (session.writing) return session.writing;
    const writing = (async () => {
      while (session.pending.length) {
        const chunk = session.pending[0];
        await api.append(session.take.id, chunk.index, new Uint8Array(await chunk.blob.arrayBuffer()));
        session.pending.shift();
      }
    })();
    session.writing = writing;
    writing.then(() => { session.writing = null; }, () => { session.writing = null; });
    return writing;
  }

  async function pause(paused: boolean) {
    const session = active.current;
    if (!session || session.phase === 'saving') return;
    const recorder = session.recorder;
    if (!paused && recorder?.state === 'inactive') return;
    if (recorder?.state === 'recording' && paused) { recorder.pause(); recorder.requestData(); }
    if (recorder?.state === 'paused' && !paused) recorder.resume();
    session.stream?.getAudioTracks().forEach(track => { track.enabled = !paused; });
    const delta = session.phase === 'running' ? performance.now() - session.anchor : 0;
    session.clock.durationMs += delta;
    session.clock.sectionMs[session.clock.section] += delta;
    session.phase = paused ? 'paused' : 'running';
    session.anchor = performance.now();
    publish(session);
    try { updateClock(session, await api.pause(session.take.id, paused)); }
    catch (error) { setError(presentationError(error)); }
  }

  async function finish() {
    const session = active.current;
    if (!session) return;
    if (session.finishing) return session.finishing;
    const finishing = (async () => {
      setError('');
      session.phase = 'saving';
      publish(session);
      try {
        updateClock(session, await api.pause(session.take.id, true));
        if (session.recorder?.state !== 'inactive') session.recorder?.stop();
        if (session.stopped) await session.stopped;
        session.stream?.getTracks().forEach(track => track.stop());
        await flush(session);
        const projects = await api.finish(session.take.id);
        active.current = null;
        setView(null);
        savedCallback.current(projects, session.take.id);
      } catch (error) {
        if (session.recorder && session.recorder.state !== 'inactive') session.recorder.stop();
        session.stream?.getTracks().forEach(track => track.stop());
        session.phase = 'paused';
        publish(session);
        setError(`${presentationError(error)} Tente finalizar novamente para salvar o ensaio.`);
      } finally { session.finishing = null; }
    })();
    session.finishing = finishing;
    return finishing;
  }

  async function start(project: PresentationProject, audio: boolean) {
    if (active.current || starting.current) return;
    setError('');
    setPreparing(true);
    const startOperation = (async () => {
      let session: Session | null = null;
      try {
        const take = await api.begin(project.id, audio);
        session = {
          take, phase: 'paused', clock: { durationMs: 0, sectionMs: take.sectionMs, section: 0 },
          anchor: performance.now(), pending: [], nextChunk: 0, writing: null, finishing: null,
        };
        active.current = session;
        if (audio) {
          const mimeType = ['audio/webm;codecs=opus', 'audio/webm'].find(type => MediaRecorder.isTypeSupported(type));
          if (!mimeType) throw new Error('A gravação de áudio está indisponível.');
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
          session.stream = stream;
          const recorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 96000 });
          session.recorder = recorder;
          session.stopped = new Promise(resolve => recorder.addEventListener('stop', () => resolve(), { once: true }));
          const capture = session;
          stream.getAudioTracks().forEach(track => track.addEventListener('ended', () => {
            if (capture.phase === 'saving') return;
            setError('O microfone foi desconectado. Finalize o ensaio para guardar os trechos capturados.');
            void pause(true);
          }));
          recorder.addEventListener('dataavailable', event => {
            if (!event.data.size) return;
            for (let offset = 0; offset < event.data.size; offset += 4 * 1024 * 1024) {
              capture.pending.push({ index: capture.nextChunk++, blob: event.data.slice(offset, offset + 4 * 1024 * 1024) });
            }
            void flush(capture).catch(error => {
              setError(`${presentationError(error)} Confira o espaço disponível e tente finalizar novamente.`);
              if (capture.phase === 'running') void pause(true);
            });
          });
          recorder.addEventListener('error', () => {
            setError('A gravação foi interrompida. Finalize o ensaio para guardar os trechos capturados.');
            void pause(true);
          });
          recorder.start(2000);
        }
        const clock = await api.pause(session.take.id, false);
        session.phase = 'running';
        updateClock(session, clock);
        publish(session);
        if (!visibleNow.current) await pause(true);
      } catch (error) {
        session?.stream?.getTracks().forEach(track => track.stop());
        if (session?.recorder && session.recorder.state !== 'inactive') session.recorder.stop();
        if (session) {
          try { await api.cancel(session.take.id); active.current = null; setView(null); }
          catch (cancelError) { session.phase = 'paused'; publish(session); setError(presentationError(cancelError)); return; }
        }
        const detail = error instanceof DOMException
          ? 'Confira se o microfone está conectado e se o Windows permite o acesso. Você também pode ensaiar com a opção de áudio desmarcada.'
          : presentationError(error);
        setError(detail);
      }
    })();
    starting.current = startOperation;
    try { await startOperation; }
    finally { starting.current = null; setPreparing(false); }
  }

  async function selectSection(index: number) {
    const session = active.current;
    if (!session || session.phase === 'saving') return;
    try { updateClock(session, await api.section(session.take.id, index)); }
    catch (error) { setError(presentationError(error)); }
  }

  const controls = useRef({ finish, pause });
  controls.current = { finish, pause };

  useEffect(() => {
    const tick = window.setInterval(() => { if (active.current) publish(active.current); }, 250);
    const checkpoint = window.setInterval(() => {
      const session = active.current;
      if (!session || session.phase !== 'running' || starting.current) return;
      void api.checkpoint(session.take.id).catch(error => {
        setError(presentationError(error));
        void controls.current.pause(true);
      });
    }, 5000);
    return () => { window.clearInterval(tick); window.clearInterval(checkpoint); };
  }, [api]);

  useEffect(() => api.onFinishRequest(() => {
    const pending = starting.current ?? Promise.resolve();
    void pending.then(() => controls.current.finish());
  }), [api]);

  useEffect(() => {
    if (!visible && active.current?.phase === 'running' && !starting.current) void controls.current.pause(true);
  }, [visible]);

  useEffect(() => () => {
    const session = active.current;
    if (session?.recorder?.state !== 'inactive') session?.recorder?.stop();
    session?.stream?.getTracks().forEach(track => track.stop());
  }, []);

  return { view, preparing, error, start, pause, finish, selectSection, clearError: () => setError('') };
}
