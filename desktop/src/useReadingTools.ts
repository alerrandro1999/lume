import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { ReaderHandle } from './PdfReader';
import type { Annotation, LibraryEntry, MarkColor, NormalizedRect, Notebook, PageImage, PageReviewUpdate, PageText, ReadingMode, SelectionDraft } from './types';
import { applyReadingOrder, pdfReadingPage } from './text-extraction';
import { cropPageImage, ocrInReadingOrder } from './ocr-review';
import { currentSelection } from './selection';
import { useNarrator } from './useNarrator';

export interface Comfort { size: number; font: 'Georgia' | 'Segoe UI' | 'Arial'; lineHeight: number; width: number; paper: 'light' | 'sepia' | 'dark'; ruler: boolean }
export type ToolPanel = 'notes' | 'bookmarks' | 'comfort' | 'ocr' | null;
export interface TextMatch { page: number; paragraph: string; start: number; end: number; cfi?: string }
const EMPTY: Notebook = { annotations: [], bookmarks: [], ocrPages: {} };
const errorText = (error: unknown) => error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : 'Não foi possível concluir esta ação.';
function readComfort(): Comfort {
  const fallback: Comfort = { size: 20, font: 'Georgia', lineHeight: 1.8, width: 65, paper: 'light', ruler: false };
  try {
    const saved = JSON.parse(localStorage.getItem('lume-comfort') || '{}');
    return { size: Math.min(40, Math.max(16, Number(saved.size) || 20)), font: ['Georgia', 'Segoe UI', 'Arial'].includes(saved.font) ? saved.font : 'Georgia', lineHeight: Math.min(2.4, Math.max(1.2, Number(saved.lineHeight) || 1.8)), width: Math.min(90, Math.max(40, Number(saved.width) || 65)), paper: ['light', 'sepia', 'dark'].includes(saved.paper) ? saved.paper : 'light', ruler: saved.ruler === true };
  } catch { return fallback; }
}

interface Options { visible: boolean; entry: LibraryEntry | null; page: number; total: number; mode: ReadingMode; reader: RefObject<ReaderHandle | null>; changeMode(mode: ReadingMode): void; onError(message: string): void; beforeNavigate?(): void }

export function useReadingTools(options: Options) {
  const latest = useRef(options);
  latest.current = options;
  const [stored, setStored] = useState<{ id: string; value: Notebook }>({ id: '', value: EMPTY });
  const notebook = stored.id === options.entry?.id ? stored.value : EMPTY;
  const notebookRef = useRef(notebook);
  notebookRef.current = notebook;
  const [panel, setPanel] = useState<ToolPanel>(null);
  const [comfort, setComfort] = useState<Comfort>(readComfort);
  const [focus, setFocus] = useState(false);
  const [pageText, setPageText] = useState<PageText | null>(null);
  const [reviewPage, setReviewPage] = useState<number | null>(null);
  const [loadingText, setLoadingText] = useState(false);
  const [selection, setSelection] = useState<SelectionDraft | null>(null);
  const [markColor, setMarkColor] = useState<MarkColor>('yellow');
  const [noteEditor, setNoteEditor] = useState<(SelectionDraft & { id?: string; note: string; color: MarkColor }) | null>(null);
  const [bookmarkEditor, setBookmarkEditor] = useState<{ id?: string; page: number; label: string; location?: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [textMatch, setTextMatch] = useState<TextMatch | null>(null);
  const [searchState, setSearchState] = useState({ current: 0, total: 0, scanning: false });
  const searchRef = useRef<{ query: string; hits: TextMatch[]; index: number }>({ query: '', hits: [], index: -1 });
  const searchGeneration = useRef(0);
  const ocrGeneration = useRef(0);
  const ocrJob = useRef('');
  const [ocrState, setOcrState] = useState({ running: false, page: 0, total: 0, completed: 0, progress: 0, message: '' });
  const [pdfExport, setPdfExport] = useState<{ id: string; pending: boolean; message: string } | null>(null);
  const readingRevision = JSON.stringify(notebook.readingOrder ?? {}) + Object.entries(notebook.ocrPages).map(([page, value]) => `${page}:${value.reviewedAt || value.createdAt}`).join('|');
  async function exportSearchablePdf() {
    const id = options.entry?.id, reader = options.reader.current;
    if (!id || !reader || pdfExport?.pending) return;
    setPdfExport({ id, pending: true, message: '' });
    try {
      const { addOcrText } = await import('./searchable-pdf');
      const { data } = await window.lume.readBookContent(id);
      const pages: Notebook['ocrPages'] = {};
      for (const [number, ocr] of Object.entries(notebook.ocrPages)) {
        if (latest.current.entry?.id !== id) return;
        const { text, margins } = await pdfReadingPage(Number(number), options.total, notebook, page => reader.text(page));
        pages[number] = ocrInReadingOrder(Number(number), ocr, applyReadingOrder(text.paragraphs, margins, notebook.readingOrder?.[number]));
      }
      if (latest.current.entry?.id !== id) return;
      const output = await addOcrText(data, pages);
      if (latest.current.entry?.id !== id) return;
      const destination = await window.lume.saveSearchablePdf(id, output);
      setPdfExport({ id, pending: false, message: destination ? `PDF pesquisável salvo em ${destination}` : '' });
    } catch (error) {
      setPdfExport({ id, pending: false, message: errorText(error) });
    }
  }

  const getText = useCallback(async (page: number): Promise<PageText> => {
    const { reader, entry, total } = latest.current, openReader = reader.current;
    if (!openReader) throw new Error('Abra um livro para ler seu texto.');
    if (entry?.format === 'epub') return openReader.text(page);
    const snapshot = notebookRef.current;
    const { text, margins } = await pdfReadingPage(page, total, snapshot, number => openReader.text(number));
    return { ...text, paragraphs: applyReadingOrder(text.paragraphs, margins, snapshot.readingOrder?.[page]) };
  }, []);
  const speech = useNarrator({ id: options.entry?.id, page: options.page, total: options.total, unit: options.entry?.format === 'epub' ? 'Seção' : 'Página', getText, navigate: page => { if (latest.current.entry?.format !== 'epub' || latest.current.page !== page) latest.current.reader.current?.page(page); }, startParagraph: () => latest.current.entry?.format === 'epub' ? latest.current.reader.current?.currentParagraph?.() : undefined, onError: message => { if (/reconhec|sem texto|não tem texto/i.test(message) && latest.current.entry?.format !== 'epub') setPanel('ocr'); else latest.current.onError(message); } });

  useEffect(() => {
    let canceled = false;
    const id = options.entry?.id;
    setSelection(null); setPanel(null); setNoteEditor(null); setBookmarkEditor(null); setPageText(null); setReviewPage(null);
    setPdfExport(null);
    searchGeneration.current++;
    searchRef.current = { query: '', hits: [], index: -1 };
    setTextMatch(null); setSearchState({ current: 0, total: 0, scanning: false });
    ocrGeneration.current++; ocrJob.current = '';
    void window.lume?.cancelOcr().catch(() => {});
    setOcrState({ running: false, page: 0, total: 0, completed: 0, progress: 0, message: '' });
    if (id) window.lume.readNotebook(id).then(value => { if (!canceled) setStored({ id, value }); }).catch(error => { if (!canceled) options.onError(errorText(error)); });
    return () => { canceled = true; };
  }, [options.entry?.id]);

  useEffect(() => {
    let canceled = false;
    if (!options.entry || options.total < 1) return;
    setLoadingText(true);
    getText(options.page).then(text => { if (!canceled) setPageText(text); }).catch(error => { if (!canceled) { setPageText(null); options.onError(errorText(error)); } }).finally(() => { if (!canceled) setLoadingText(false); });
    return () => { canceled = true; };
  }, [options.entry?.id, options.page, options.total, readingRevision, getText]);

  useEffect(() => { try { localStorage.setItem('lume-comfort', JSON.stringify(comfort)); } catch { /* Settings still work in memory. */ } }, [comfort]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (!latest.current.visible || !latest.current.entry) return;
      if (event.key === 'F8') { event.preventDefault(); setFocus(value => !value); setPanel(null); }
      if (event.key === 'Escape' && focus) { event.preventDefault(); setFocus(false); }
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [focus]);
  useEffect(() => window.lume?.onOcrProgress(progress => {
    if (progress.jobId !== ocrJob.current) return;
    const recognizing = progress.status === 'recognizing text';
    setOcrState(previous => ({ ...previous, progress: recognizing ? progress.progress : 0, message: recognizing ? 'Reconhecendo as palavras…' : 'Preparando o reconhecimento…' }));
  }), []);
  useEffect(() => () => { ocrGeneration.current++; void window.lume?.cancelOcr().catch(() => {}); }, []);

  async function update(action: (id: string) => Promise<Notebook>) {
    const id = latest.current.entry?.id;
    if (!id) return false;
    setSaving(true);
    try {
      const value = await action(id);
      if (latest.current.entry?.id === id) { notebookRef.current = value; setStored({ id, value }); }
      return true;
    } catch (error) { latest.current.onError(errorText(error)); return false; }
    finally { setSaving(false); }
  }

  function clearSelection() { setSelection(null); window.getSelection()?.removeAllRanges(); }
  async function saveHighlight() {
    if (!selection) return;
    try {
      const location = selection.location || await latest.current.reader.current?.selectionCfi?.(selection);
      if (await update(id => window.lume.saveAnnotation(id, { ...selection, location, color: markColor, note: '' }))) { clearSelection(); setPanel('notes'); }
    } catch (error) { latest.current.onError(errorText(error)); }
  }
  async function saveNote() {
    if (!noteEditor) return;
    try {
      const location = noteEditor.location || await latest.current.reader.current?.selectionCfi?.(noteEditor);
      if (await update(id => window.lume.saveAnnotation(id, { ...noteEditor, location }))) { clearSelection(); setNoteEditor(null); setPanel('notes'); }
    } catch (error) { latest.current.onError(errorText(error)); }
  }
  async function saveBookmark() {
    if (!bookmarkEditor) return;
    if (await update(id => window.lume.saveBookmark(id, bookmarkEditor))) { setBookmarkEditor(null); setPanel('bookmarks'); }
  }

  const clearFind = useCallback(() => {
    searchGeneration.current++;
    searchRef.current = { query: '', hits: [], index: -1 };
    setTextMatch(null); setSearchState({ current: 0, total: 0, scanning: false });
  }, []);
  const find = useCallback(async (query: string, again = false, previous = false) => {
    const normalized = query.trim().toLocaleLowerCase('pt-BR');
    if (!normalized) { clearFind(); return; }
    const navigate = (match: TextMatch | undefined) => {
      if (!match) { setTextMatch(null); return; }
      latest.current.beforeNavigate?.();
      if (match.cfi && latest.current.entry?.format === 'epub') latest.current.reader.current?.destination(match.cfi);
      else latest.current.reader.current?.page(match.page);
      setTextMatch(match);
    };
    if (again && searchRef.current.query === normalized && searchRef.current.hits.length) {
      const current = searchRef.current;
      current.index = (current.index + (previous ? -1 : 1) + current.hits.length) % current.hits.length;
      setSearchState({ current: current.index + 1, total: current.hits.length, scanning: false });
      navigate(current.hits[current.index]);
      return;
    }
    const ticket = ++searchGeneration.current;
    const id = latest.current.entry?.id;
    const hits: TextMatch[] = [];
    setSearchState({ current: 0, total: 0, scanning: true });
    try {
      for (let page = 1; page <= latest.current.total && hits.length < 2000; page++) {
        const text = await getText(page);
        if (ticket !== searchGeneration.current || latest.current.entry?.id !== id) return;
        for (const paragraph of text.paragraphs) {
          const source = paragraph.text.toLocaleLowerCase('pt-BR');
          let start = source.indexOf(normalized);
          while (start !== -1 && hits.length < 2000) { hits.push({ page, paragraph: paragraph.id, start, end: start + normalized.length, cfi: paragraph.cfi }); start = source.indexOf(normalized, start + normalized.length); }
        }
      }
      if (ticket !== searchGeneration.current) return;
      const index = Math.max(0, hits.findIndex(hit => hit.page >= latest.current.page));
      searchRef.current = { query: normalized, hits, index };
      setSearchState({ current: hits.length ? index + 1 : 0, total: hits.length, scanning: false });
      navigate(hits[index]);
    } catch (error) { if (ticket === searchGeneration.current) { setSearchState({ current: 0, total: 0, scanning: false }); latest.current.onError(errorText(error)); } }
  }, [getText, clearFind]);

  async function recognize(all = false) {
    if (latest.current.entry?.format === 'epub') return;
    if (ocrState.running || !latest.current.entry) return;
    const id = latest.current.entry.id;
    const ticket = ++ocrGeneration.current;
    const first = all ? 1 : latest.current.page;
    const last = all ? latest.current.total : first;
    if (!all && (notebookRef.current.ocrPages[first]?.reviewedAt || notebookRef.current.readingOrder?.[first])) {
      setReviewPage(first);
      return;
    }
    let completed = 0;
    setPanel('ocr');
    setOcrState({ running: true, page: first, total: last - first + 1, completed: 0, progress: 0, message: 'Preparando a página…' });
    try {
      for (let page = first; page <= last; page++) {
        if (ticket !== ocrGeneration.current || latest.current.entry?.id !== id) return;
        if (all) {
          const native = await latest.current.reader.current!.text(page);
          if (notebookRef.current.ocrPages[page] || notebookRef.current.readingOrder?.[page] || native.paragraphs.map(item => item.text).join('').length > 25) {
            completed++; setOcrState(previous => ({ ...previous, page, completed, progress: 0 })); continue;
          }
        }
        setOcrState(previous => ({ ...previous, page, progress: 0, message: 'Preparando a página…' }));
        const image = await latest.current.reader.current!.image(page);
        if (ticket !== ocrGeneration.current) return;
        const jobId = crypto.randomUUID();
        ocrJob.current = jobId;
        await window.lume.recognizePage(id, page, image, jobId);
        if (ticket !== ocrGeneration.current) return;
        const value = await window.lume.readNotebook(id);
        if (ticket !== ocrGeneration.current || latest.current.entry?.id !== id) return;
        notebookRef.current = value;
        setStored({ id, value });
        completed++;
        setOcrState(previous => ({ ...previous, completed, progress: 0 }));
      }
      if (ticket === ocrGeneration.current) {
        latest.current.changeMode('text');
        setOcrState(previous => ({ ...previous, running: false, progress: 1, message: 'Reconhecimento concluído. O texto está pronto para ler, buscar e ouvir.' }));
      }
    } catch (error) {
      if (ticket === ocrGeneration.current) { setOcrState(previous => ({ ...previous, running: false, message: errorText(error) })); latest.current.onError(errorText(error)); }
    }
  }
  async function cancelOcr() {
    ocrGeneration.current++; ocrJob.current = '';
    setOcrState(previous => ({ ...previous, running: false, message: 'Reconhecimento cancelado. As páginas concluídas foram preservadas.' }));
    await window.lume.cancelOcr();
  }

  const loadPageReview = useCallback(async (page: number) => {
    const { reader, entry, total } = latest.current, openReader = reader.current;
    if (!entry || !openReader) throw new Error('Abra um PDF para revisar a página.');
    const snapshot = notebookRef.current;
    const [{ text, margins }, image] = await Promise.all([
      pdfReadingPage(page, total, snapshot, number => openReader.text(number)),
      openReader.image(page),
    ]);
    return { id: entry.id, text, margins, image, layout: snapshot.readingOrder?.[page], ocr: snapshot.ocrPages[page] };
  }, []);

  async function recognizeArea(id: string, page: number, image: PageImage, selection: NormalizedRect) {
    const crop = await cropPageImage(image, selection);
    if (latest.current.entry?.id !== id) throw new Error('A página já foi fechada.');
    const result = await window.lume.recognizeArea(id, page, crop, crypto.randomUUID());
    return { result, region: crop.region };
  }

  async function savePageReview(id: string, page: number, change: PageReviewUpdate) {
    if (latest.current.entry?.id !== id) throw new Error('A página já foi fechada.');
    const value = await window.lume.savePageReview(id, page, change);
    if (latest.current.entry?.id !== id) return;
    if (speech.position.page === page) speech.stop();
    clearFind();
    clearSelection();
    notebookRef.current = value;
    setStored({ id, value });
    setReviewPage(null);
  }

  return {
    notebook, panel, setPanel, comfort, setComfort, focus, setFocus, pageText, loadingText, selection, markColor, setMarkColor,
    isEpub: options.entry?.format === 'epub', unit: options.entry?.format === 'epub' ? 'Seção' : 'Página',
    noteEditor, setNoteEditor, bookmarkEditor, setBookmarkEditor, saving, speech, textMatch, searchState, ocrState,
    exportSearchablePdf, pdfExport: pdfExport?.id === options.entry?.id ? pdfExport : null,
    reviewPage, setReviewPage, loadPageReview, recognizeArea, savePageReview, readingRevision,
    getText, find, clearFind, recognize, cancelOcr,
    togglePanel: (next: ToolPanel) => setPanel(current => current === next ? null : next),
    captureSelection: (root: HTMLElement) => { const draft = currentSelection(root, latest.current.page); if (draft) setSelection(draft); },
    acceptSelection: (draft: SelectionDraft) => setSelection(draft),
    clearSelection, saveHighlight, saveNote, saveBookmark,
    annotateSelection: () => { if (selection) setNoteEditor({ ...selection, note: '', color: markColor }); },
    newNote: () => setNoteEditor({ page: latest.current.page, quote: '', anchors: [], textAnchors: [], note: '', color: markColor, location: latest.current.reader.current?.location?.()?.cfi }),
    editNote: (annotation: Annotation) => setNoteEditor({ ...annotation }),
    removeNote: (id: string) => update(document => window.lume.removeAnnotation(document, id)),
    newBookmark: () => setBookmarkEditor({ page: latest.current.page, label: `${latest.current.entry?.format === 'epub' ? 'Seção' : 'Página'} ${latest.current.page}`, location: latest.current.reader.current?.location?.()?.cfi }),
    removeBookmark: (id: string) => update(document => window.lume.removeBookmark(document, id)),
    adjustText: (direction: number) => setComfort(previous => ({ ...previous, size: Math.max(16, Math.min(40, previous.size + direction * 2)) })),
  };
}

export type ReadingTools = ReturnType<typeof useReadingTools>;
