import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { ReaderHandle, OutlineItem } from './PdfReader';
import type { AudiobookProgress, BookSession, EpubLocation, Flashcard, GlossaryEntry, LibraryEntry, LinkedAudiobook, LookupResult, ReadingMode, SelectionDraft, StudyData, StudySettings } from './types';
import type { ReadingTools } from './useReadingTools';
import { detectMargins, usePdfCrop } from './usePdfCrop';
export type StudyTab = 'rhythm' | 'lookup' | 'glossary' | 'cards' | 'export' | 'audio' | 'crop';
const words = (value: string) => value.match(/[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu)?.length || 0;
export const duration = (minutes: number) => minutes < 1 ? 'menos de 1 min' : minutes < 60 ? `${Math.ceil(minutes)} min` : `${Math.floor(minutes / 60)} h ${Math.ceil(minutes % 60)} min`;
const errorText = (error: unknown) => error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : 'Não foi possível concluir a ação.';
interface Options { entry: LibraryEntry | null; page: number; total: number; location: EpubLocation | null; reading: boolean; mode: ReadingMode; reader: RefObject<ReaderHandle | null>; tools: ReadingTools; outline: OutlineItem[] }
export function useStudy(options: Options) {
  const latest = useRef(options); latest.current = options;
  const [data, setData] = useState<StudyData | null>(null), [tab, setTab] = useState<StudyTab | null>(null);
  const [error, setError] = useState(''), [message, setMessage] = useState(''), [busy, setBusy] = useState(false);
  const [index, setIndex] = useState<{ counts: number[]; titles: string[]; complete: boolean; missing: number }>({ counts: [], titles: [], complete: false, missing: 0 });
  const [lookupText, setLookupText] = useState(''), [lookup, setLookup] = useState<{ result: LookupResult; term: string; kind: 'dictionary' | 'translate'; page: number; location?: string; quote: string } | null>(null);
  const [editor, setEditor] = useState<(Pick<Flashcard, 'front' | 'back' | 'page' | 'location'> & { id?: string }) | null>(null);
  const [audio, setAudio] = useState<AudiobookProgress>({ running: false, done: 0, total: 0, chapter: '' });
  const [audioPreparing, setAudioPreparing] = useState(false), [exportPath, setExportPath] = useState('');
  const [audioExports, setAudioExports] = useState<{ id: string; items: LinkedAudiobook[] } | null>(null);
  const [breakDue, setBreakDue] = useState(false), [breakEnd, setBreakEnd] = useState(0), [breakRemaining, setBreakRemaining] = useState(0), [goalReached, setGoalReached] = useState(false);
  const readingSeconds = useRef(0), nextBreak = useRef(0), audioGeneration = useRef(0), lookupGeneration = useRef(0);
  const dataRef = useRef(data); dataRef.current = data;
  const operational = useRef({ busy, tab, breakEnd, breakDue, audioPreparing }); operational.current = { busy, tab, breakEnd, breakDue, audioPreparing };
  const update = useCallback(async (action: (id: string) => Promise<StudyData>) => {
    const id = latest.current.entry?.id; if (!id) return;
    setBusy(true); setError(''); try { const value = await action(id); if (latest.current.entry?.id === id) setData(value); return true; } catch (error) { setError(errorText(error)); return false; } finally { setBusy(false); }
  }, []);
  useEffect(() => {
    const id = options.entry?.id; let canceled = false;
    setTab(null); setError(''); setMessage(''); setEditor(null); setData(null); setLookup(null); setExportPath(''); lookupGeneration.current++;
    if (id) window.lume.readStudy(id).then(value => { if (!canceled) setData(value); }).catch(error => { if (!canceled) setError(errorText(error)); });
    return () => { canceled = true; };
  }, [options.entry?.id]);
  useEffect(() => {
    const id = options.entry?.id;
    if (!id || (tab !== 'audio' && tab !== 'rhythm')) return;
    let stale = false;
    const refresh = () => {
      if (tab === 'audio') void window.lume.playerListExports(id).then(items => { if (!stale) setAudioExports({ id, items }); }).catch(error => { if (!stale) setError(errorText(error)); });
      else void window.lume.readStudy(id).then(value => { if (!stale) setData(value); }).catch(() => {});
    };
    refresh();
    const timer = tab === 'rhythm' ? window.setInterval(refresh, 5000) : undefined;
    return () => { stale = true; window.clearInterval(timer); };
  }, [options.entry?.id, tab, audio.running]);
  const readingRevision = options.tools.readingRevision;
  useEffect(() => {
    let canceled = false; const id = options.entry?.id;
    setIndex({ counts: [], titles: [], complete: false, missing: 0 });
    if (id && options.total) void (async () => {
      const counts: number[] = [], titles: string[] = []; let missing = 0;
      for (let page = 1; page <= options.total; page++) {
        const text = await latest.current.tools.getText(page); if (canceled || latest.current.entry?.id !== id) return;
        const count = text.paragraphs.reduce((sum, paragraph) => sum + words(paragraph.text), 0); counts.push(count); if (!count) missing++;
        titles.push(text.paragraphs.find(paragraph => paragraph.heading)?.text.slice(0, 120) || `${options.entry?.format === 'epub' ? 'Seção' : 'Página'} ${page}`);
        if (page % 20 === 0) { setIndex({ counts: [...counts], titles: [...titles], complete: false, missing }); await new Promise(resolve => setTimeout(resolve, 0)); }
      }
      if (!canceled) setIndex({ counts, titles, complete: true, missing });
    })().catch(error => { if (!canceled) setError(errorText(error)); });
    return () => { canceled = true; };
  }, [options.entry?.id, options.total, readingRevision]);

  useEffect(() => {
    const id = options.entry?.id; if (!id) return;
    let pending = 0, lastTick = Date.now(), lastActivity = Date.now(), session: BookSession | null = null;
    readingSeconds.current = 0; nextBreak.current = 0; setBreakDue(false); setBreakEnd(0); setGoalReached(false);
    const activity = () => { lastActivity = Date.now(); };
    for (const event of ['pointerdown', 'pointermove', 'keydown', 'wheel', 'lume-reading-activity']) window.addEventListener(event, activity, { passive: true, capture: true });
    const flush = () => {
      if (!pending || !session) return;
      const seconds = pending;
      pending = 0;
      const snapshot = { ...session };
      void window.lume.recordReading(id, seconds, undefined, snapshot).then(value => {
        if (latest.current.entry?.id !== id) return;
        setData(value);
        const goalKey = `lume-goal-${value.day}`;
        if (value.todaySeconds >= value.settings.goal * 60 && !localStorage.getItem(goalKey)) { setGoalReached(true); localStorage.setItem(goalKey, '1'); }
      }).catch(error => { if (latest.current.entry?.id === id) setError(errorText(error)); });
    };
    const timer = setInterval(() => {
      const now = Date.now(), elapsed = Math.min(2, Math.max(0, Math.round((now - lastTick) / 1000))); lastTick = now;
      const pause = operational.current.breakEnd > now;
      setBreakRemaining(Math.max(0, Math.ceil((operational.current.breakEnd - now) / 1000)));
      if (latest.current.reading && document.visibilityState === 'visible' && document.hasFocus() && now - lastActivity < 120000 && !pause && !operational.current.tab) {
        session ||= { id: crypto.randomUUID(), kind: 'reading', startedAt: now, seconds: 0 };
        session.seconds += elapsed;
        pending += elapsed; readingSeconds.current += elapsed;
        const settings = dataRef.current?.settings;
        if (settings?.reminders && readingSeconds.current >= (nextBreak.current || settings.breakEvery * 60) && !operational.current.breakDue) setBreakDue(true);
      } else { flush(); session = null; }
      if (pending >= 10) flush();
    }, 1000);
    return () => { clearInterval(timer); flush(); for (const event of ['pointerdown', 'pointermove', 'keydown', 'wheel', 'lume-reading-activity']) window.removeEventListener(event, activity, { capture: true }); };
  }, [options.entry?.id]);

  const totals = useMemo(() => {
    const totalWords = index.counts.reduce((sum, count) => sum + count, 0), current = index.counts[options.page - 1] || 0;
    const fraction = options.location ? Math.min(1, (options.location.displayedPage - 1) / Math.max(1, options.location.displayedTotal)) : 0;
    const before = index.counts.slice(0, options.page - 1).reduce((sum, count) => sum + count, 0);
    let sectionRemaining = current * (1 - fraction), sectionLabel = options.location ? 'nesta seção' : 'nesta página';
    const chapters = options.outline.filter(item => item.depth === 0 && item.page).sort((a, b) => a.page! - b.page!);
    let chapter = -1; chapters.forEach((item, index) => { if (item.page! <= options.page) chapter = index; });
    if (!options.location && chapter >= 0) { sectionRemaining = index.counts.slice(options.page - 1, (chapters[chapter + 1]?.page || options.total + 1) - 1).reduce((sum, value) => sum + value, 0); sectionLabel = `em ${chapters[chapter].title}`; }
    return { totalWords, current, offset: before + current * fraction, remaining: options.location?.atEnd ? 0 : Math.max(0, totalWords - before - current * fraction), sectionRemaining, sectionLabel };
  }, [index, options.page, options.location, options.outline, options.total]);
  const pace = useRef<{ offset: number; seconds: number } | null>(null);
  useEffect(() => { const reset = () => { pace.current = null; }; window.addEventListener('lume-reading-jump', reset); return () => window.removeEventListener('lume-reading-jump', reset); }, []);
  useEffect(() => { pace.current = null; }, [options.entry?.id]);
  useEffect(() => {
    if (!index.complete || !options.reading || !data?.settings.autoPace || options.tools.speech.status !== 'idle') { pace.current = null; return; }
    const point = { offset: totals.offset, seconds: readingSeconds.current }, previous = pace.current;
    if (!previous || point.offset < previous.offset || point.offset - previous.offset > Math.max(1200, totals.current * 2)) { pace.current = point; return; }
    const elapsed = point.seconds - previous.seconds, count = point.offset - previous.offset;
    if (elapsed >= 10 && count >= 20) { pace.current = point; const id = options.entry?.id; if (id) void window.lume.recordReading(id, 0, { words: count, seconds: elapsed }).then(value => { if (latest.current.entry?.id === id) setData(value); }).catch(() => {}); }
  }, [totals.offset, index.complete, options.reading, options.tools.speech.status]);
  const calibrated = !!data && data.settings.autoPace && data.book.samples >= 3 && data.book.paceSeconds >= 30;
  const wpm = calibrated && data ? Math.round(data.book.paceWords / data.book.paceSeconds * 60) : data?.settings.wpm || 200;
  usePdfCrop(data?.book.crop, options.entry?.format !== 'epub' && options.mode !== 'text');
  useEffect(() => window.lume?.onAudiobookProgress(progress => setAudio(progress)), []);
  useEffect(() => () => { audioGeneration.current++; void window.lume?.cancelAudiobook().catch(() => {}); }, []);

  async function consult(kind: 'dictionary' | 'translate', from: string, to: string) {
    const ticket = ++lookupGeneration.current;
    const { page, location, tools } = latest.current;
    const term = lookupText.trim();
    const selection = tools.selection;
    setBusy(true); setError(''); setLookup(null);
    try {
      const point = selection
        ? { page: selection.page, location: selection.location || await latest.current.reader.current?.selectionCfi?.(selection), quote: selection.quote }
        : { page, location: location?.cfi, quote: '' };
      if (ticket !== lookupGeneration.current) return;
      const result = await window.lume.lookup({ text: term, kind, from, to });
      if (ticket === lookupGeneration.current) setLookup({ result, kind, term, ...point });
    } catch (error) { if (ticket === lookupGeneration.current) setError(errorText(error)); }
    finally { if (ticket === lookupGeneration.current) setBusy(false); }
  }
  function glossaryCard(entry: GlossaryEntry) {
    setEditor({ front: entry.term, back: entry.meaning, page: entry.page, location: entry.location });
    setError('');
    setTab('cards');
  }
  async function saveLookup(meaning: string) {
    if (!lookup || !meaning.trim()) return;
    const { term, quote, page, location, kind } = lookup;
    const saved = await update(id => window.lume.saveGlossary(id, { term, quote, page, location, meaning: meaning.trim().slice(0, 12000), source: kind === 'dictionary' ? 'Wikcionário' : 'MyMemory' }));
    if (saved) setMessage('Consulta salva no glossário.');
  }
  async function newCard(selection?: SelectionDraft, back?: string) {
    const source = selection || latest.current.tools.selection;
    const location = source?.location || (source ? await latest.current.reader.current?.selectionCfi?.(source) : latest.current.reader.current?.location?.()?.cfi);
    setEditor({ front: '', back: back || source?.quote || '', page: source?.page || latest.current.page, location }); setError(''); setTab('cards');
  }
  async function exportAnnotations(format: 'md' | 'pdf') {
    if (!options.entry) return; setBusy(true); setError(''); setMessage('');
    try { const result = await window.lume.exportNotes(options.entry.id, format); if (result) { setExportPath(result); setMessage('Anotações exportadas.'); } } catch (error) { setError(errorText(error)); } finally { setBusy(false); }
  }
  async function linkAudiobook() {
    const id = latest.current.entry?.id;
    if (!id) return;
    setBusy(true); setError('');
    try {
      const items = await window.lume.playerLinkExport(id);
      if (items && latest.current.entry?.id === id) setAudioExports({ id, items });
    } catch (error) { setError(errorText(error)); }
    finally { setBusy(false); }
  }
  async function exportAudio(scope: 'current' | 'book', voice: string) {
    const id = latest.current.entry?.id; if (!id || audioPreparing || audio.running) return;
    const ticket = ++audioGeneration.current; setAudioPreparing(true); setError(''); setMessage(''); latest.current.tools.speech.stop();
    try {
      const groups: { title: string; start: number; end: number }[] = [];
      const total = latest.current.total;
      if (scope === 'current') groups.push({ title: index.titles[latest.current.page - 1] || `Trecho ${latest.current.page}`, start: latest.current.page, end: latest.current.page });
      else if (latest.current.entry?.format === 'epub') for (let page = 1; page <= total; page++) groups.push({ title: index.titles[page - 1] || `Seção ${page}`, start: page, end: page });
      else {
        const starts = latest.current.outline.filter(item => item.depth === 0 && item.page).sort((a, b) => a.page! - b.page!).filter((item, index, items) => !index || item.page !== items[index - 1].page);
        if (starts.length) { if (starts[0].page !== 1) groups.push({ title: 'Introdução', start: 1, end: starts[0].page! - 1 }); starts.forEach((item, index) => groups.push({ title: item.title, start: item.page!, end: (starts[index + 1]?.page || total + 1) - 1 })); }
        else for (let page = 1; page <= total; page++) groups.push({ title: `Página ${page}`, start: page, end: page });
      }
      const chapters: { title: string; text: string }[] = [];
      for (const group of groups) {
        let text = ''; for (let page = group.start; page <= group.end; page++) { const content = await latest.current.tools.getText(page); if (ticket !== audioGeneration.current || latest.current.entry?.id !== id) return; text += content.paragraphs.map(paragraph => paragraph.text).join('\n\n') + '\n\n'; }
        chapters.push({ title: group.title.slice(0, 300), text: text.trim() });
      }
      if (!chapters.some(chapter => chapter.text)) throw new Error('Não há texto para narrar neste trecho. Em PDFs digitalizados, use Reconhecer texto.');
      setAudioPreparing(false); setAudio({ running: true, done: 0, total: 1, chapter: 'Preparando arquivos…' });
      const result = await window.lume.exportAudiobook(id, chapters, voice);
      if (result) {
        const items = await window.lume.playerListExports(id);
        if (latest.current.entry?.id === id) setAudioExports({ id, items });
        if (latest.current.entry?.id === id) {
          setExportPath(result);
          setMessage('Audiobook salvo com arquivos WAV e playlist.');
        }
      }
    } catch (error) { setError(errorText(error)); } finally { setAudioPreparing(false); setAudio(previous => ({ ...previous, running: false })); }
  }
  return {
    data, tab, setTab, error, setError, message, busy, index, totals, wpm, calibrated, readingSeconds,
    lookupText, setLookupText, lookupResult: lookup?.result, consult, saveLookup, glossaryCard, editor, setEditor, newCard, update,
    saveCard: async () => { if (editor && await update(id => window.lume.saveCard(id, editor))) setEditor(null); },
    exportAnnotations, exportAudio, linkAudiobook, audio, audioPreparing, exportPath,
    audioExports: audioExports?.id === options.entry?.id ? audioExports?.items || [] : [],
    open: (next: StudyTab) => { setError(''); setMessage(''); setTab(next); if (next === 'lookup') { setLookupText(latest.current.tools.selection?.quote || ''); setLookup(null); } },
    saveSettings: async (settings: StudySettings) => { setBusy(true); setError(''); try { const saved = await window.lume.saveStudySettings(settings); setData(previous => previous ? { ...previous, settings: saved } : previous); nextBreak.current = readingSeconds.current + saved.breakEvery * 60; setMessage('Preferências salvas.'); } catch (error) { setError(errorText(error)); } finally { setBusy(false); } },
    autoCrop: async () => { setBusy(true); setError(''); try { const image = await latest.current.reader.current!.image(latest.current.page); const value = await detectMargins(image.data); await update(id => window.lume.saveCrop(id, value)); } catch (error) { setError(errorText(error)); } finally { setBusy(false); } },
    cancelAudio: () => { audioGeneration.current++; setAudioPreparing(false); void window.lume.cancelAudiobook(); },
    breakDue, breakRemaining, breakEnd, goalReached, dismissGoal: () => setGoalReached(false),
    startBreak: () => { setBreakDue(false); setBreakRemaining((data?.settings.breakDuration || 5) * 60); setBreakEnd(Date.now() + (data?.settings.breakDuration || 5) * 60000); nextBreak.current = readingSeconds.current + (data?.settings.breakEvery || 25) * 60; },
    postponeBreak: () => { setBreakDue(false); setBreakEnd(0); nextBreak.current = readingSeconds.current + 300; },
    dismissBreak: () => { setBreakDue(false); setBreakEnd(0); nextBreak.current = readingSeconds.current + (data?.settings.breakEvery || 25) * 60; },
  };
}
export type StudyTools = ReturnType<typeof useStudy>;
