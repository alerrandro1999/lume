import { useEffect, useEffectEvent, useRef, useState } from 'react';
import type { NarrationPosition, PageText, SpeechVoice } from './types';
import { speechChunks } from './text-extraction';
import { useListeningSession } from './useListeningSession';

type Status = 'idle' | 'loading' | 'playing' | 'paused' | 'error';
interface Options { id?: string; total: number; page: number; getText(page: number): Promise<PageText>; navigate(page: number): void; onError(message: string): void; startParagraph?(): string | undefined; unit?: string }

export function useNarrator(options: Options) {
  const latest = useRef(options);
  latest.current = options;
  const audio = useRef<HTMLAudioElement>(null);
  const generation = useRef(0);
  const sourceUrl = useRef('');
  const cache = useRef(new Map<string, Promise<Uint8Array>>());
  const cursor = useRef<{ page: number; index: number; chunks: ReturnType<typeof speechChunks> } | null>(null);
  const stateRef = useRef<Status>('idle');
  const preparing = useRef(false);
  const endedWhilePreparing = useRef(false);
  const [status, setStatus] = useState<Status>('idle');
  const [visible, setVisible] = useState(false);
  const [voices, setVoices] = useState<SpeechVoice[]>([]);
  const [voice, setVoice] = useState(() => localStorage.getItem('lume-voice') || '');
  const voiceRef = useRef(voice);
  voiceRef.current = voice;
  const [rate, setRate] = useState(() => {
    const value = Number(localStorage.getItem('lume-speech-rate'));
    return value >= 0.5 && value <= 2 ? value : 1;
  });
  const rateRef = useRef(rate);
  rateRef.current = rate;
  const [spoken, setSpoken] = useState<{ page: number; paragraph: string; rects: ReturnType<typeof speechChunks>[number]['rects'] } | null>(null);
  const [position, setPosition] = useState({ page: 0, chunk: 0, total: 0, time: 0, duration: 0 });
  const [error, setError] = useState('');
  const [saved, setSaved] = useState<{ id: string; point: NarrationPosition } | null>(null);
  const checkpoint = useRef<{ id: string; point: NarrationPosition; source: string } | null>(null);
  const lastSave = useRef(0);
  const [sleep, setSleep] = useState<0 | 15 | 30 | 60 | 'page'>(0);
  const sleepRef = useRef(sleep);
  const sleepPage = useRef<number | null>(null);
  const [sleepFinished, setSleepFinished] = useState(false);
  const updateStatus = (next: Status) => { stateRef.current = next; setStatus(next); };
  useListeningSession(options.id, status === 'playing');

  function savePosition(final = false) {
    const mark = checkpoint.current, element = audio.current;
    if (!mark || !element || element.currentSrc !== mark.source || !Number.isFinite(element.duration)) return;
    const point = { ...mark.point, time: element.ended ? Math.max(0, element.duration - .02) : element.currentTime };
    if (final) window.lume.narrationCheckpoint(mark.id, point);
    else {
      setSaved({ id: mark.id, point });
      void window.lume.narrationPosition(mark.id, point).catch(() => {});
    }
  }

  const flushPosition = useEffectEvent(() => savePosition(true));
  useEffect(() => {
    const flush = () => flushPosition();
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  }, []);

  function changeSleep(value: typeof sleep) {
    sleepRef.current = value;
    sleepPage.current = value === 'page' ? cursor.current?.page ?? null : null;
    setSleep(value);
    setSleepFinished(false);
    void window.lume.narrationSleep(value === 'page' ? 0 : value).catch(() => {});
  }

  function pause() {
    audio.current?.pause();
    updateStatus('paused');
    savePosition();
  }
  function finishSleep() {
    pause();
    changeSleep(0);
    setSleepFinished(true);
  }
  function cancelSleepIfLeaving(page: number) {
    if (sleepRef.current !== 'page') return;
    if (sleepPage.current === null) sleepPage.current = page;
    else if (sleepPage.current !== page) changeSleep(0);
  }
  const onSleep = useEffectEvent(() => {
    if (typeof sleepRef.current === 'number' && sleepRef.current > 0) finishSleep();
  });
  useEffect(() => window.lume?.onNarrationSleep(() => onSleep()), []);

  useEffect(() => {
    let canceled = false;
    window.lume?.speechVoices().then(items => {
      if (canceled) return;
      setVoices(items);
      if (!items.some(item => item.name === voiceRef.current)) setVoice(items.find(item => item.language === 'pt-BR')?.name || items[0]?.name || '');
    }).catch(() => { if (!canceled) setError('Nenhuma voz local está disponível. Instale uma voz de fala nas configurações do Windows.'); });
    return () => { canceled = true; };
  }, []);

  function stop(keepTimer = false) {
    savePosition();
    generation.current++;
    preparing.current = false;
    endedWhilePreparing.current = false;
    audio.current?.pause();
    if (audio.current) { audio.current.removeAttribute('src'); audio.current.load(); }
    if (sourceUrl.current) { URL.revokeObjectURL(sourceUrl.current); sourceUrl.current = ''; }
    cache.current.clear();
    cursor.current = null;
    checkpoint.current = null;
    setSpoken(null);
    setPosition({ page: 0, chunk: 0, total: 0, time: 0, duration: 0 });
    updateStatus('idle');
    if (!keepTimer && (sleepRef.current || sleepFinished)) changeSleep(0);
    void window.lume?.cancelSpeech().catch(() => {});
  }

  useEffect(() => {
    stop();
    setVisible(false);
    setSaved(null);
    const id = options.id;
    let stale = false;
    if (id) void window.lume.narrationPosition(id).then(point => {
      if (!stale && point) setSaved(previous => previous?.id === id ? previous : { id, point });
    }).catch(() => {});
    return () => { stale = true; };
  }, [options.id]);
  useEffect(() => () => { generation.current++; audio.current?.pause(); if (sourceUrl.current) URL.revokeObjectURL(sourceUrl.current); void window.lume?.cancelSpeech().catch(() => {}); }, []);

  function bytes(page: number, index: number, text: string) {
    const key = `${voiceRef.current}:${page}:${index}`;
    if (!cache.current.has(key)) {
      const pending = window.lume.synthesizeSpeech(latest.current.id!, text, voiceRef.current);
      cache.current.set(key, pending);
      void pending.catch(() => {});
    }
    return cache.current.get(key)!;
  }

  async function playChunk(page: number, chunks: ReturnType<typeof speechChunks>, index: number, ticket: number, time = 0) {
    if (ticket !== generation.current) return;
    const chunk = chunks[index];
    audio.current?.pause();
    cancelSleepIfLeaving(page);
    cursor.current = { page, chunks, index };
    setPosition({ page, chunk: index + 1, total: chunks.length, time, duration: 0 });
    if (stateRef.current !== 'paused') updateStatus('loading');
    const data = await bytes(page, index, chunk.text);
    if (ticket !== generation.current || !audio.current) return;
    const paused = stateRef.current === 'paused';
    audio.current.pause();
    if (sourceUrl.current) URL.revokeObjectURL(sourceUrl.current);
    sourceUrl.current = URL.createObjectURL(new Blob([new Uint8Array(data).buffer], { type: 'audio/wav' }));
    checkpoint.current = { id: latest.current.id!, source: sourceUrl.current, point: { page, index, paragraph: chunk.paragraph, time: 0, voice: voiceRef.current } };
    lastSave.current = 0;
    audio.current.src = sourceUrl.current;
    if (time > 0) audio.current.currentTime = time;
    audio.current.playbackRate = rateRef.current;
    audio.current.preservesPitch = true;
    setSpoken({ page, paragraph: chunk.paragraph, rects: chunk.rects });
    if (!paused) await playLoaded(ticket);
    cache.current.delete(`${voiceRef.current}:${page}:${index}`);
    if (chunks[index + 1]) void bytes(page, index + 1, chunks[index + 1].text).catch(() => {});
  }

  async function playLoaded(ticket: number) {
    if (!audio.current) return;
    try { await audio.current.play(); }
    catch (error) {
      if (ticket !== generation.current || stateRef.current === 'paused') return;
      throw error;
    }
    if (ticket === generation.current && stateRef.current !== 'paused') updateStatus('playing');
  }

  function finishPreparation(ticket: number) {
    if (ticket !== generation.current) return;
    preparing.current = false;
    if (endedWhilePreparing.current) {
      endedWhilePreparing.current = false;
      if (audio.current?.ended) void advance(1, true);
    }
  }

  async function begin(page = latest.current.page, paragraph?: string, resume?: NarrationPosition) {
    if (!latest.current.id) return;
    stop(true);
    setVisible(true);
    setError('');
    const ticket = generation.current;
    preparing.current = true;
    updateStatus('loading');
    try {
      if (!voiceRef.current) throw new Error('Escolha uma voz do Windows para começar.');
      let text = await latest.current.getText(page);
      if (ticket !== generation.current) return;
      let chunks = speechChunks(text);
      while (!chunks.length && latest.current.unit === 'Seção' && page < latest.current.total) {
        text = await latest.current.getText(++page);
        if (ticket !== generation.current) return;
        chunks = speechChunks(text);
      }
      if (!chunks.length) throw new Error('Esta página não tem texto. Use “Reconhecer texto” para preparar a narração.');
      const requested = resume?.paragraph || paragraph || (!resume ? latest.current.startParagraph?.() : undefined);
      const exact = resume && page === resume.page && chunks[resume.index]?.paragraph === requested;
      const index = exact ? resume.index : requested ? Math.max(0, chunks.findIndex(item => item.paragraph === requested)) : 0;
      latest.current.navigate(page);
      await playChunk(page, chunks, index, ticket, exact && resume.voice === voiceRef.current ? resume.time : 0);
    } catch (error) { if (ticket === generation.current) fail(error); }
    finally { finishPreparation(ticket); }
  }

  function fail(error: unknown) {
    const message = error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : 'Não foi possível reproduzir este trecho.';
    setError(message);
    setSpoken(null);
    updateStatus('error');
    if (sleepRef.current) changeSleep(0);
    latest.current.onError(message);
  }

  async function advance(direction: 1 | -1 = 1, ended = false) {
    const current = cursor.current;
    if (!current) return;
    if (preparing.current) {
      if (ended) endedWhilePreparing.current = true;
      return;
    }
    if (direction === -1 && current.page === 1 && current.index === 0) {
      if (audio.current) { audio.current.currentTime = 0; savePosition(); }
      return;
    }
    const ticket = generation.current;
    savePosition();
    audio.current?.pause();
    preparing.current = true;
    try {
      const next = current.index + direction;
      if (next >= 0 && next < current.chunks.length) await playChunk(current.page, current.chunks, next, ticket);
      else if (ended && sleepRef.current === 'page' && sleepPage.current === current.page) finishSleep();
      else if (direction === 1 && current.page < latest.current.total) {
        if (stateRef.current !== 'paused') updateStatus('loading');
        let nextPage = current.page + 1;
        let text = await latest.current.getText(nextPage);
        if (ticket !== generation.current) return;
        let chunks = speechChunks(text);
        while (!chunks.length && latest.current.unit === 'Seção' && nextPage < latest.current.total) {
          text = await latest.current.getText(++nextPage);
          if (ticket !== generation.current) return;
          chunks = speechChunks(text);
        }
        latest.current.navigate(nextPage);
        if (!chunks.length) throw new Error(latest.current.unit === 'Seção' ? 'Não há mais texto disponível para narrar neste EPUB.' : `A página ${nextPage} precisa de reconhecimento de texto para continuar a narração.`);
        await playChunk(nextPage, chunks, 0, ticket);
      } else if (direction === -1 && current.page > 1) {
        const page = current.page - 1;
        const chunks = speechChunks(await latest.current.getText(page));
        if (ticket !== generation.current) return;
        if (!chunks.length) throw new Error('O trecho anterior não tem texto para narrar.');
        latest.current.navigate(page);
        await playChunk(page, chunks, chunks.length - 1, ticket);
      }
      else {
        audio.current?.pause();
        setSpoken(null);
        updateStatus('idle');
        if (sleepRef.current) changeSleep(0);
        if (ended && latest.current.id) {
          checkpoint.current = null;
          setSaved(null);
          void window.lume.narrationPosition(latest.current.id, null).catch(() => {});
        }
      }
    } catch (error) { if (ticket === generation.current) fail(error); }
    finally { finishPreparation(ticket); }
  }

  async function toggle() {
    if (sleepFinished) setSleepFinished(false);
    if (stateRef.current === 'playing' || stateRef.current === 'loading') pause();
    else if (stateRef.current === 'paused' && audio.current?.ended) {
      if (cursor.current?.page === latest.current.total && cursor.current.index === cursor.current.chunks.length - 1) {
        await begin(cursor.current.page, cursor.current.chunks[cursor.current.index].paragraph);
      } else {
        updateStatus('loading');
        await advance();
      }
    }
    else if (stateRef.current === 'paused' && preparing.current) updateStatus('loading');
    else if (stateRef.current === 'paused' && audio.current?.getAttribute('src')) {
      const ticket = generation.current;
      updateStatus('loading');
      try { await playLoaded(ticket); } catch (error) { if (ticket === generation.current) fail(error); }
    } else await begin();
  }

  const resumePoint = saved?.id === options.id ? saved?.point : undefined;
  return {
    audio, status, visible, voices, voice, rate, error, spoken, position, unit: options.unit || 'Página',
    begin, toggle, advance, stop: () => stop(), pause, sleep, sleepFinished, changeSleep, resumePoint,
    resume: () => { if (resumePoint) return begin(resumePoint.page, undefined, resumePoint); },
    show: () => setVisible(true),
    close: () => { stop(); setVisible(false); },
    chooseVoice: (value: string) => { stop(); setVoice(value); try { localStorage.setItem('lume-voice', value); } catch { /* Keep in memory. */ } },
    changeRate: (value: number) => { setRate(value); if (audio.current) audio.current.playbackRate = value; try { localStorage.setItem('lume-speech-rate', String(value)); } catch { /* Keep in memory. */ } },
    timeUpdate: () => {
      const element = audio.current;
      if (!element || element.currentSrc !== checkpoint.current?.source || !Number.isFinite(element.duration)) return;
      const { currentTime: time, duration } = element;
      setPosition(previous => ({ ...previous, time, duration }));
      if (Date.now() - lastSave.current >= 4000) { lastSave.current = Date.now(); savePosition(); }
    },
    seek: (value: number) => { if (audio.current && Number.isFinite(audio.current.duration)) { audio.current.currentTime = Math.max(0, Math.min(value, audio.current.duration)); savePosition(); } },
  };
}

export type Narrator = ReturnType<typeof useNarrator>;
