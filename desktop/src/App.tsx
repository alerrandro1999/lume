import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { plannerMaterialEvent, type PlannerMaterial } from './planner-types';
import {
  ArrowDownToLine, ArrowRight, BookOpen, BookmarkCheck, ChevronDown, ChevronLeft, ChevronRight,
  Clock3, FileText, FolderOpen, Keyboard, LayoutGrid, LibraryBig, List, LoaderCircle, LockKeyhole,
  Moon, PanelLeftClose, PanelLeftOpen, Plus, RotateCw, Search, Sun, Trash2, X,
} from 'lucide-react';
import { type OutlineItem, type ReaderHandle } from './PdfReader';
import { UnifiedReader } from './UnifiedReader';
import type { EpubLocation, LibraryEntry, OpenedPdf, ReadingMode } from './types';
import { ReadingProgress, type SaveStatus } from './ReadingProgress';
import { pageRange, percentage, readMode, readZoom } from './reading';
import { useReadingTools } from './useReadingTools';
import { ExitFocus, SelectionBar, ToolBar, ToolDialogs, ToolPanel } from './ReadingTools';
import { TextReader } from './TextReader';
import { SpeechBar } from './SpeechBar';
import { useReadingHistory } from './useReadingHistory';
import { useStudy } from './useStudy';
import { ReadingReminders, StudyPanel, StudyStrip } from './StudyPanel';
import { LibraryFilters, LibraryOrganizationDialog, useLibraryTools } from './LibraryTools';
import { WorkspacePanel, type WorkspaceTab } from './WorkspacePanel';
import { AudioPlayer } from './AudioPlayer';
import { useFloatingPlayer } from './useFloatingPlayer';
import { useMediaControls } from './useMediaControls';
import { Comparison } from './Comparison';
import { Thumbnails } from './Thumbnails';
import type { LibraryHit } from './types';
import './workspace.css';
import { UpdatesPanel, useUpdates } from './UpdatesPanel';
import type { Theme } from './Hub';
import { LessonCards } from './LessonCards';
import lumeLogo from '../resources/branding/lume.svg?no-inline';

const message = (error: unknown) => error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : 'Ocorreu um erro ao abrir este documento.';
const displayName = (name: string) => name.replace(/\.(pdf|epub)$/i, '');
const bookName = (entry: LibraryEntry) => entry.title || displayName(entry.name);
const progressPercent = (entry: LibraryEntry) => entry.format === 'epub' && entry.epubLocation ? entry.epubLocation.atEnd ? 100 : Math.min(99, Math.round(entry.epubLocation.progress * 100)) : percentage(entry.page, entry.totalPages);
const fileSize = (bytes: number) => bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`;

function IconButton({ label, children, className = '', ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string; children: ReactNode }) {
  return <button className={`icon-button ${className}`} aria-label={label} title={label} {...props}>{children}</button>;
}

export function App({ visible, activate, onOpenHub, theme, toggleTheme }: {
  visible: boolean; activate(): void; onOpenHub(): void; theme: Theme; toggleTheme(): void;
}) {
  const reader = useRef<ReaderHandle>(null);
  const activeRef = useRef<LibraryEntry | null>(null);
  const busy = useRef(false);
  const request = useRef(0);
  const saveQueue = useRef(Promise.resolve());
  const saveRevision = useRef(0);
  const modeBeforeOpen = useRef<ReadingMode | null>(null);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const passwordInput = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const [recent, setRecent] = useState<LibraryEntry[]>([]);
  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab | null>(null);
  const updates = useUpdates();
  const [updatesOpened, setUpdatesOpened] = useState(false);
  const [lessonCardsOpened, setLessonCardsOpened] = useState(false);
  const [playerOpened, setPlayerOpened] = useState(false);
  const [exportRequest, setExportRequest] = useState<{ directory: string } | null>(null);
  const [mediaSource, setMediaSource] = useState<'file' | 'narration' | null>(null);
  const [tabs, setTabs] = useState<string[]>(() => { try { const value = JSON.parse(localStorage.getItem('lume-open-tabs') || '[]'); return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string').slice(0, 30) : []; } catch { return []; } });
  const [comparison, setComparison] = useState<string | null>(null);
  const [thumbnails, setThumbnails] = useState(false);
  const pendingHit = useRef<LibraryHit | null>(null);
  const modalGate = useRef(false);
  modalGate.current = !!workspaceTab || playerOpened || updatesOpened || lessonCardsOpened;
  const [active, setActive] = useState<LibraryEntry | null>(null);
  const [epubLocation, setEpubLocation] = useState<EpubLocation | null>(null);
  const [libraryView, setLibraryView] = useState(true);
  const [sidebar, setSidebar] = useState(true);
  const [sideTab, setSideTab] = useState<'recent' | 'outline'>('recent');
  const [outline, setOutline] = useState<OutlineItem[]>([]);
  const [page, setPage] = useState(1);
  const [pageDraft, setPageDraft] = useState('1');
  const [totalPages, setTotalPages] = useState(0);
  const [scale, setScale] = useState(1);
  const [zoomMode, setZoomMode] = useState('page-fit');
  const [readingMode, setReadingMode] = useState<ReadingMode>(readMode);
  const readingModeRef = useRef(readingMode);
  readingModeRef.current = readingMode;
  const [savedPage, setSavedPage] = useState(1);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved');
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState('');
  const [importNotice, setImportNotice] = useState('');
  const [dragging, setDragging] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState({ current: 0, total: 0 });
  const [password, setPassword] = useState<{ update: (value: string) => void; incorrect: boolean } | null>(null);
  const [passwordValue, setPasswordValue] = useState('');
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const reading = active !== null && !libraryView;
  const isEpub = active?.format === 'epub';
  const [firstPage, lastPage] = pageRange(page, totalPages, isEpub ? 'single' : readingMode);
  const canPrevious = isEpub ? !epubLocation?.atStart : firstPage > 1;
  const canNext = isEpub ? !epubLocation?.atEnd : lastPage < totalPages;
  const resume = recent.find(entry => entry.totalPages > 0);

  useEffect(() => {
    if (visible) document.title = reading && active ? `${bookName(active)} — Lume` : 'Lume Leitor';
  }, [visible, reading, active]);
  useEffect(() => {
    if (!window.lume) { setError('Abra o Lume pelo aplicativo desktop. Execute o atalho Iniciar Lume ou o comando de desenvolvimento.'); return; }
    window.lume.listRecent().then(items => { setRecent(items); setTabs(ids => ids.filter(id => items.some(item => item.id === id))); }).catch(error => setError(message(error)));
  }, []);
  useEffect(() => { try { localStorage.setItem('lume-open-tabs', JSON.stringify(tabs)); } catch { /* Tabs remain available for this session. */ } }, [tabs]);
  useEffect(() => { setPageDraft(String(page)); }, [page]);
  useEffect(() => { if (!importNotice) return; const timer = setTimeout(() => setImportNotice(''), 8000); return () => clearTimeout(timer); }, [importNotice]);
  useEffect(() => {
    if (searchOpen) searchInput.current?.focus();
  }, [searchOpen]);
  useEffect(() => { if (password) passwordInput.current?.focus(); }, [password]);
  useEffect(() => {
    try { localStorage.setItem('lume-reading-mode', readingMode); } catch { /* Keep the selected mode in memory. */ }
  }, [readingMode]);

  const rememberPage = useCallback((next: number) => {
    setPage(next);
    const entry = activeRef.current;
    if (busy.current || !entry || !entry.totalPages || entry.format === 'epub') return;
    const savedPosition = pageRange(next, entry.totalPages, readingModeRef.current)[1];
    if (entry.page === savedPosition) return;
    entry.page = savedPosition;
    const revision = ++saveRevision.current;
    setSaveStatus('saving');
    setRecent(items => items.map(item => item.id === entry.id ? { ...item, page: savedPosition } : item));
    saveQueue.current = saveQueue.current.then(() => window.lume.saveProgress(entry.id, savedPosition, entry.totalPages))
      .then(() => {
        if (revision === saveRevision.current && activeRef.current?.id === entry.id) {
          setSavedPage(savedPosition);
          setSaveStatus('saved');
        }
      })
      .catch(() => {
        if (revision === saveRevision.current) setSaveStatus('error');
        setError('Não foi possível salvar sua posição de leitura. Verifique o espaço e as permissões da pasta de dados.');
      });
  }, []);

  const rememberEpubLocation = useCallback((id: string, location: EpubLocation) => {
    const entry = activeRef.current;
    if (busy.current || !entry || entry.id !== id || entry.format !== 'epub') return;
    if (entry.epubLocation && JSON.stringify(entry.epubLocation) === JSON.stringify(location)) return;
    entry.page = location.chapter; entry.totalPages = location.chapters; entry.epubLocation = location;
    setPage(location.chapter); setEpubLocation(location);
    setRecent(items => items.map(item => item.id === id ? { ...item, page: location.chapter, totalPages: location.chapters, epubLocation: location } : item));
    const revision = ++saveRevision.current;
    setSaveStatus('saving');
    saveQueue.current = saveQueue.current.then(() => window.lume.saveEpubProgress(id, location)).then(() => {
      if (revision === saveRevision.current && activeRef.current?.id === id) { setSavedPage(location.chapter); setSaveStatus('saved'); }
    }).catch(() => { if (revision === saveRevision.current) setSaveStatus('error'); setError('Não foi possível salvar a posição do EPUB.'); });
  }, []);

  const history = useReadingHistory(active?.id, reader, () => ({ page: reader.current?.location?.()?.chapter || activeRef.current?.page || 1, location: reader.current?.location?.()?.cfi }));
  const tools = useReadingTools({ visible, entry: active, page, total: totalPages, mode: readingMode, reader, changeMode: setReadingMode, onError: setError, beforeNavigate: history.capture });
  const speech = tools.speech;
  const study = useStudy({ entry: active, page, total: totalPages, location: epubLocation, reading: visible && reading && !opening && !workspaceTab && !playerOpened && !updatesOpened && !['playing', 'loading'].includes(speech.status), mode: readingMode, reader, tools, outline });
  useMediaControls('narration', mediaSource === 'narration' && speech.visible && !['idle', 'error'].includes(speech.status), active ? bookName(active) : 'Lume', 'Leitura em voz alta', speech.status === 'playing' || speech.status === 'loading', play => {
    if (play && speech.status === 'paused' || !play && (speech.status === 'playing' || speech.status === 'loading')) void speech.toggle();
  });
  const narrationFloating = useFloatingPlayer({
    source: 'narration',
    title: active ? bookName(active) : '',
    detail: speech.sleepFinished ? 'Temporizador concluído' : speech.position.page ? `${speech.unit} ${speech.position.page} · trecho ${speech.position.chunk} de ${speech.position.total}` : 'Leitura em voz alta',
    position: Math.floor(speech.position.time * 10) / 10,
    duration: speech.position.duration,
    playing: speech.status === 'playing' || speech.status === 'loading',
    loading: speech.status === 'loading',
    canSkip: speech.status === 'playing' || speech.status === 'paused',
    error: speech.error,
  }, (command, time) => {
    if (command === 'toggle') void speech.toggle();
    else if (command === 'seek' && time !== undefined) speech.seek(time);
    else if (command === 'rewind' || command === 'forward') void speech.advance(command === 'rewind' ? -1 : 1);
  }, () => {
    activate();
    setLibraryView(false);
    speech.show();
  });
  useEffect(() => {
    if (narrationFloating.active && (!reading || !speech.visible)) {
      void window.lume.closeFloatingPlayer('narration').catch(() => {});
    }
  }, [narrationFloating.active, reading, speech.visible]);
  const library = useLibraryTools(recent, updated => setRecent(items => items.map(item => item.id === updated.id ? updated : item)));
  const navigate = (number: number, location?: string) => { history.capture(); if (location) reader.current?.destination(location); else reader.current?.page(number); };
  const hasOcr = Object.keys(tools.notebook.ocrPages).length > 0;
  const hasReadingOrder = Object.keys(tools.notebook.readingOrder ?? {}).length > 0;
  const findMatches = isEpub || readingMode === 'text' ? tools.searchState : matches;
  function findDocument(again = false, previous = false) {
    history.capture();
    if (isEpub || readingMode === 'text' || (hasOcr || hasReadingOrder) && query.trim()) {
      if (!isEpub && readingMode !== 'text') setReadingMode('text');
      void tools.find(query, again, previous);
    } else reader.current?.find(query, again, previous);
  }
  useEffect(() => { if (libraryView) tools.speech.stop(); }, [libraryView]);
  useEffect(() => {
    if (speech.status === 'playing' || speech.status === 'loading') {
      setMediaSource('narration');
      window.dispatchEvent(new Event('lume-pause-audio'));
    }
  }, [speech.status]);

  const open = useCallback(async (operation: () => Promise<OpenedPdf | null>) => {
    if (busy.current || modalGate.current) return;
    busy.current = true;
    const ticket = ++request.current;
    modeBeforeOpen.current = readingModeRef.current;
    let committed = false;
    setOpening(true);
    setError('');
    setImportNotice('');
    tools.speech.stop();
    void tools.cancelOcr().catch(() => {});
    try {
      await saveQueue.current;
      const source = await operation();
      if (!source || ticket !== request.current) return;
      if (source.entry.format === 'epub' && readingModeRef.current === 'text') setReadingMode('single');
      setLibraryView(false);
      setSearchOpen(false);
      setQuery('');
      tools.clearFind();
      setMatches({ current: 0, total: 0 });
      const result = await reader.current!.open(source);
      if (ticket !== request.current) return;
      const startPage = result.page;
      const savedPosition = pageRange(startPage, result.pages, source.entry.format === 'epub' ? 'single' : readingModeRef.current)[1];
      const metadata = result.metadata ? await window.lume.saveBookMetadata(source.entry.id, result.metadata) : source.entry;
      if (ticket !== request.current) return;
      const entry = { ...source.entry, ...metadata, totalPages: result.pages, page: savedPosition, epubLocation: result.epubLocation };
      activeRef.current = entry;
      committed = true;
      setActive(entry);
      setTabs(items => items.includes(entry.id) ? items : [...items, entry.id].slice(-30));
      setComparison(current => current === entry.id ? null : current);
      setEpubLocation(result.epubLocation || null);
      setTotalPages(result.pages);
      setPage(startPage);
      setOutline(result.outline);
      setZoomMode(readZoom(readingModeRef.current));
      setSaveStatus('saving');
      saveRevision.current++;
      await (result.epubLocation ? window.lume.saveEpubProgress(entry.id, result.epubLocation) : window.lume.saveProgress(entry.id, savedPosition, result.pages)).catch(error => { setSaveStatus('error'); throw error; });
      setSavedPage(savedPosition);
      setSaveStatus('saved');
      setRecent(await window.lume.listRecent());
      if (source.importStatus) setImportNotice(source.importStatus === 'copied' ? 'Livro copiado para o app. O arquivo original foi preservado.' : source.importStatus === 'duplicate' ? 'Este livro já está guardado no app. Sua posição e anotações foram mantidas.' : 'Livro aberto sem copiar. Mantenha o arquivo na pasta original.');
    } catch (error) {
      if (ticket === request.current) {
        const detail = message(error);
        setError(/ENOENT/.test(detail) ? 'Arquivo não encontrado. Use “Importar livro” para localizá-lo ou recuperar a cópia.' : /password/i.test(detail) ? 'Não foi possível desbloquear este PDF.' : detail);
        if (!activeRef.current) setLibraryView(true);
      }
    } finally {
      if (ticket === request.current) {
        if (!committed && modeBeforeOpen.current) setReadingMode(modeBeforeOpen.current);
        modeBeforeOpen.current = null;
        busy.current = false;
        setOpening(false);
        setPassword(null);
        setPasswordValue('');
        const hit = pendingHit.current;
        pendingHit.current = null;
        if (committed && hit && hit.id === activeRef.current?.id) {
          if (hit.cfi) reader.current?.destination(hit.cfi); else reader.current?.page(hit.page);
        }
      }
    }
  }, []);

  const choosePdf = useCallback(() => void open(() => window.lume.chooseBook()), [open]);
  const chooseExternal = useCallback(() => void open(() => window.lume.chooseBook('external')), [open]);
  const openRecent = (entry: LibraryEntry) => {
    if (entry.id === activeRef.current?.id) { setLibraryView(false); return; }
    void open(() => window.lume.openRecent(entry.id));
  };
  const cancelOpen = () => {
    if (modeBeforeOpen.current) setReadingMode(modeBeforeOpen.current);
    modeBeforeOpen.current = null;
    request.current++;
    reader.current?.cancelLoading();
    busy.current = false;
    setOpening(false);
    setPassword(null);
    setPasswordValue('');
    if (!activeRef.current) setLibraryView(true);
  };
  const closeSearch = () => {
    setSearchOpen(false);
    setQuery('');
    setMatches({ current: 0, total: 0 });
    reader.current?.clearFind();
    tools.clearFind();
  };

  useEffect(() => window.lume?.onOpenRequest(() => { activate(); choosePdf(); }), [choosePdf, activate]);
  useEffect(() => window.lume?.onExternalOpenRequest(() => { activate(); chooseExternal(); }), [chooseExternal, activate]);
  useEffect(() => {
    const receive = (event: Event) => {
      const material = (event as CustomEvent<PlannerMaterial>).detail;
      if (material.kind !== 'book') return;
      activate();
      void open(() => window.lume.openRecent(material.id));
    };
    window.addEventListener(plannerMaterialEvent, receive);
    return () => window.removeEventListener(plannerMaterialEvent, receive);
  }, [activate, open]);
  useEffect(() => {
    if (!reading || !searchOpen) return;
    const timer = setTimeout(() => {
      if (query.trim()) history.capture();
      setMatches({ current: 0, total: 0 });
      if (isEpub || readingMode === 'text' || (hasOcr || hasReadingOrder) && query.trim()) {
        if (!isEpub && readingMode !== 'text') setReadingMode('text');
        void tools.find(query);
      } else reader.current?.find(query);
    }, 180);
    return () => clearTimeout(timer);
  }, [query, searchOpen, reading, readingMode, hasOcr, hasReadingOrder, isEpub, tools.find, tools.readingRevision]);
  useEffect(() => {
    if (!visible) return;
    const keydown = (event: KeyboardEvent) => {
      if (study.tab || library.editing || workspaceTab || playerOpened || updatesOpened || lessonCardsOpened || tools.reviewPage !== null) return;
      const modifier = event.ctrlKey || event.metaKey;
      const editing = /INPUT|TEXTAREA|SELECT/.test((event.target as HTMLElement).tagName);
      if (modifier && event.key.toLowerCase() === 'f' && reading) {
        event.preventDefault(); setSearchOpen(true); searchInput.current?.focus();
      } else if (event.key === 'Escape') {
        if (password) cancelOpen();
        else if (shortcutsOpen) setShortcutsOpen(false);
        else closeSearch();
      } else if (reading && !editing && !password && !opening && !shortcutsOpen) {
        if (event.altKey && event.key === 'ArrowLeft') { event.preventDefault(); history.back(); return; }
        if (event.altKey && event.key === 'ArrowRight') { event.preventDefault(); history.forward(); return; }
        if (event.key === 'ArrowRight' || event.key === 'PageDown') { event.preventDefault(); reader.current?.turn(1); }
        if (event.key === 'ArrowLeft' || event.key === 'PageUp') { event.preventDefault(); reader.current?.turn(-1); }
        if (event.key === 'Home' && modifier) { event.preventDefault(); history.capture(); if (isEpub) reader.current?.goToProgress?.(0); else reader.current?.page(1); }
        if (event.key === 'End' && modifier) { event.preventDefault(); history.capture(); if (isEpub) reader.current?.goToProgress?.(1); else reader.current?.page(totalPages); }
        if (modifier && (event.key === '+' || event.key === '=')) { event.preventDefault(); if (isEpub || readingMode === 'text') tools.adjustText(1); else { reader.current?.zoom(1); setZoomMode('custom'); } }
        if (modifier && event.key === '-') { event.preventDefault(); if (isEpub || readingMode === 'text') tools.adjustText(-1); else { reader.current?.zoom(-1); setZoomMode('custom'); } }
        if (modifier && event.key === '0') { event.preventDefault(); reader.current?.scale('page-width'); setZoomMode('page-width'); }
      }
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  });

  const removeRecent = async (entry: LibraryEntry) => {
    try {
      setRecent(await window.lume.removeRecent(entry.id));
      setTabs(items => items.filter(id => id !== entry.id));
      if (comparison === entry.id) setComparison(null);
      if (entry.id === activeRef.current?.id) {
        activeRef.current = null;
        reader.current?.close();
        setActive(null);
        setLibraryView(true);
        setOutline([]);
      }
    } catch (error) { setError(message(error)); }
  };

  const refresh = useCallback(async () => { setRecent(await window.lume.listRecent()); }, []);
  const prepare = async () => { tools.speech.stop(); await tools.cancelOcr(); window.dispatchEvent(new Event('lume-pause-audio')); await saveQueue.current; };
  const closeTabs = (ids: string[]) => {
    setTabs(items => items.filter(id => !ids.includes(id)));
    if (comparison && ids.includes(comparison)) setComparison(null);
    if (activeRef.current && ids.includes(activeRef.current.id)) { tools.speech.stop(); activeRef.current = null; reader.current?.close(); setActive(null); setLibraryView(true); setOutline([]); }
  };
  const closeTab = (id: string) => {
    const remaining = tabs.filter(item => item !== id);
    const wasActive = activeRef.current?.id === id;
    closeTabs([id]);
    if (wasActive) { const next = recent.find(entry => entry.id === remaining.at(-1)); if (next) openRecent(next); }
  };
  const jump = (hit: LibraryHit) => {
    if (hit.id === activeRef.current?.id) { setLibraryView(false); navigate(hit.page, hit.cfi); }
    else { const entry = recent.find(entry => entry.id === hit.id); if (entry) { pendingHit.current = hit; modalGate.current = false; openRecent(entry); } }
  };
  const blockingModal = !!study.tab || !!library.editing || !!workspaceTab || playerOpened || updatesOpened || lessonCardsOpened || tools.reviewPage !== null;

  return <div className={`app ${sidebar ? '' : 'sidebar-hidden'} ${tools.focus && reading ? 'focus-mode' : ''}`}
    onDragEnter={event => {
      event.preventDefault();
      if (Array.from(event.dataTransfer.types).includes('Files')) { dragDepth.current++; setDragging(true); }
    }}
    onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; }}
    onDragLeave={event => { event.preventDefault(); if (--dragDepth.current <= 0) { dragDepth.current = 0; setDragging(false); } }}
    onDrop={event => {
      event.preventDefault(); dragDepth.current = 0; setDragging(false);
      const file = event.dataTransfer.files[0];
      if (file) {
        if (!/\.(pdf|epub)$/i.test(file.name)) { setError('Escolha um livro PDF ou EPUB.'); return; }
        void open(() => window.lume.openDroppedBook(file));
      }
    }}>
    <aside className="library-sidebar" aria-label="Biblioteca" inert={blockingModal}>
      <button className="brand" onClick={() => setLibraryView(true)} aria-label="Lume, ir para biblioteca">
        <img className="brand-mark" src={lumeLogo} width={34} height={34} alt="" />
        <span className="brand-name">lume<span className="brand-dot">.</span></span>
      </button>
      <button className="open-button" aria-label="Importar livro" onClick={choosePdf} disabled={opening}><Plus size={18} /><span>Importar livro</span><kbd>Ctrl O</kbd></button>
      <button className="external-open-button" onClick={chooseExternal} disabled={opening} title="Abrir o arquivo na pasta original, sem criar uma cópia · Ctrl + Shift + O"><FolderOpen size={14} />Abrir sem copiar</button>
      <div className="nav-label">SEU ESPAÇO</div>
      <button className={`nav-item ${libraryView ? 'selected' : ''}`} onClick={() => setLibraryView(true)}><LibraryBig size={18} /><span>Biblioteca</span><span className="nav-count">{recent.length}</span></button>
      {active && <button className={`nav-item ${!libraryView ? 'selected' : ''}`} onClick={() => setLibraryView(false)}><BookOpen size={18} /><span>Leitura atual</span><span className="live-dot" /></button>}
      <div className="library-utilities"><button onClick={() => setWorkspaceTab('import')}>Importar em lote</button><button onClick={() => setWorkspaceTab('search')}>Busca global</button><button onClick={() => setWorkspaceTab('backup')}>Backup</button><button onClick={() => setWorkspaceTab('storage')}>Armazenamento</button><button className="audio-library-button" onClick={() => { tools.speech.stop(); setPlayerOpened(true); }}>♫ Player de audiobooks</button><button onClick={() => setLessonCardsOpened(true)}>Cartões de aulas</button></div>
      <div className="side-divider" />
      <div className="side-tabs">
        <button className={sideTab === 'recent' ? 'current' : ''} onClick={() => setSideTab('recent')}><Clock3 size={14} /> Recentes</button>
        {active && <button className={sideTab === 'outline' ? 'current' : ''} onClick={() => setSideTab('outline')}><List size={14} /> Sumário</button>}
      </div>
      <div className="side-content">
        {sideTab === 'recent' || !active ? recent.length ? recent.map(entry =>
          <button key={entry.id} className={`recent-item ${reading && active?.id === entry.id ? 'active' : ''}`} onClick={() => openRecent(entry)} title={entry.path} disabled={opening}>
            <span className="recent-icon">{entry.format === 'epub' ? <BookOpen size={18} strokeWidth={1.5} /> : <FileText size={18} strokeWidth={1.5} />}</span><span className="recent-info"><span className="recent-name">{bookName(entry)}</span><span className="recent-meta">{entry.totalPages ? entry.format === 'epub' ? `${progressPercent(entry)}% · ${entry.epubLocation?.title || `Seção ${entry.page}`}` : `Parou na pág. ${entry.page} · ${progressPercent(entry)}%` : fileSize(entry.size)}</span></span>
          </button>) : <div className="side-empty"><FileText size={24} strokeWidth={1.3} /><p>Suas próximas leituras<br />começam aqui.</p></div>
          : outline.length ? outline.map((item, index) => <button key={index} className="outline-item" style={{ paddingLeft: 12 + Math.min(item.depth, 4) * 12 }} onClick={() => { setLibraryView(false); history.capture(); reader.current?.destination(item.destination); }}>{item.title}</button>)
          : <div className="side-empty"><List size={24} strokeWidth={1.3} /><p>Este livro não possui<br />um sumário incorporado.</p></div>}
      </div>
      <div className="sidebar-footer"><span className="offline-dot" /><span>Sua biblioteca, no seu computador.</span><button className="version" aria-label={updates.title} onClick={() => setUpdatesOpened(true)}>{updates.state ? `v${updates.state.version}` : 'Sobre'}</button></div>
    </aside>

    <main className="main" inert={blockingModal}>
      <header className="topbar">
        <div className="breadcrumb"><button className="hub-return" type="button" onClick={onOpenHub} disabled={opening}><LayoutGrid size={15} />Aplicativos</button><IconButton label={sidebar ? 'Ocultar barra lateral' : 'Mostrar barra lateral'} onClick={() => setSidebar(value => !value)}>{sidebar ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}</IconButton><span className="breadcrumb-parent">Seu espaço</span><ChevronRight size={13} /><span>{reading ? 'Leitura' : 'Biblioteca'}</span></div>
        <div className="topbar-actions">
          <span className="local-label"><span />Leitura local</span>
          <span className="toolbar-divider" />
          {updates.canUpdate && <IconButton label="Atualizações do Lume" className={updates.state?.availableVersion ? 'update-badge' : ''} onClick={() => setUpdatesOpened(true)}><ArrowDownToLine size={18} /></IconButton>}
          <IconButton label="Atalhos de teclado" onClick={() => setShortcutsOpen(true)}><Keyboard size={18} /></IconButton>
          <IconButton label={theme === 'light' ? 'Ativar tema escuro' : 'Ativar tema claro'} onClick={toggleTheme}>{theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}</IconButton>
        </div>
      </header>
      {tabs.length > 0 && <div className="book-tabs" role="tablist" aria-label="Livros abertos">{tabs.map(id => { const entry = recent.find(item => item.id === id); return entry && <div className={`book-tab ${reading && active?.id === id ? 'selected' : ''}`} key={id}><button role="tab" aria-selected={reading && active?.id === id} title={bookName(entry)} disabled={opening} onClick={() => openRecent(entry)}>{bookName(entry)}</button><button aria-label={`Fechar aba ${bookName(entry)}`} disabled={opening} onClick={() => closeTab(id)}>×</button></div>; })}</div>}

      {error && <div className="error-banner" role="alert"><span>{error}</span><IconButton label="Fechar aviso" onClick={() => setError('')}><X size={16} /></IconButton></div>}

      <div className={`reader-space ${reading || opening && !libraryView ? 'visible' : ''}`}>
        <div className="document-header">
          <div className="document-heading"><span className="pdf-pill">{isEpub ? 'EPUB' : 'PDF'}</span><h1 title={active?.name}>{active ? bookName(active) : 'Abrindo livro…'}</h1></div>
          <div className="reading-mode-select"><BookOpen size={15} /><select aria-label="Modo de leitura" value={readingMode} disabled={opening} onChange={event => setReadingMode(event.target.value as ReadingMode)}>
            <option value="single">Página a página</option><option value="book">Livro aberto (2 páginas)</option><option value="scroll">Rolagem contínua</option>{!isEpub && <option value="text">Texto ajustável</option>}
          </select><ChevronDown size={12} /></div>
          <button className="text-button open-another" onClick={choosePdf} disabled={opening}><FolderOpen size={16} />Importar outro livro</button>
        </div>
        <div className="reader-toolbar" aria-label="Controles de leitura">
          <div className="toolbar-group"><IconButton label="Página anterior" disabled={!canPrevious || opening} onClick={() => reader.current?.turn(-1)}><ChevronLeft size={18} /></IconButton><form className="page-control" onSubmit={event => { event.preventDefault(); const value = Number(pageDraft); if (Number.isInteger(value) && value > 0) navigate(value); setPageDraft(String(Math.max(1, Math.min(value || page, totalPages)))); }}><input aria-label={isEpub ? 'Seção atual' : 'Página atual'} type="text" inputMode="numeric" value={pageDraft} onChange={event => setPageDraft(event.target.value.replace(/\D/g, ''))} onBlur={() => setPageDraft(String(page))} disabled={opening} /><span>/ {totalPages || '—'}{isEpub ? ' seções' : ''}</span></form><IconButton label="Próxima página" disabled={!canNext || opening} onClick={() => reader.current?.turn(1)}><ChevronRight size={18} /></IconButton></div>
          {isEpub || readingMode === 'text' ? <div className="toolbar-group text-font-controls"><span className="text-size-caption">Fonte</span><IconButton label="Diminuir texto" className="text-size-button" disabled={opening || tools.comfort.size <= 16} onClick={() => tools.adjustText(-1)}><span aria-hidden="true">A<sup>−</sup></span></IconButton><span className="font-size-value" aria-live="polite">{tools.comfort.size}px</span><IconButton label="Aumentar texto" className="text-size-button" disabled={opening || tools.comfort.size >= 40} onClick={() => tools.adjustText(1)}><span aria-hidden="true">A<sup>+</sup></span></IconButton><button className="text-button font-options" onClick={() => tools.togglePanel('comfort')}>Fonte e espaçamento<ChevronDown size={12} /></button></div>
          : <div className="toolbar-group zoom-group"><span className="text-size-caption">Texto</span><IconButton label="Diminuir texto" title="Diminuir o texto reduzindo a página do PDF" className="text-size-button" disabled={opening || scale <= 0.25} onClick={() => reader.current?.zoom(-1)}><span aria-hidden="true">A<sup>−</sup></span></IconButton><div className="zoom-select"><select aria-label="Ajuste de zoom" value={zoomMode} onChange={event => { setZoomMode(event.target.value); reader.current?.scale(event.target.value); }} disabled={opening}><option value="page-width">Ajustar à largura</option><option value="page-fit">Página inteira</option><option value="0.75">75%</option><option value="1">100%</option><option value="1.25">125%</option><option value="1.5">150%</option><option value="2">200%</option>{!['page-width', 'page-fit', '0.75', '1', '1.25', '1.5', '2'].includes(zoomMode) && <option value={zoomMode}>{Math.round(scale * 100)}%</option>}</select><ChevronDown size={12} /></div><IconButton label="Aumentar texto" title="Aumentar o texto ampliando a página do PDF" className="text-size-button" disabled={opening || scale >= 5} onClick={() => reader.current?.zoom(1)}><span aria-hidden="true">A<sup>+</sup></span></IconButton><span className="toolbar-divider" /><IconButton label="Girar página" disabled={opening} onClick={() => reader.current?.rotate()}><RotateCw size={17} /></IconButton></div>}
          <button className={`search-button ${searchOpen ? 'active' : ''}`} onClick={() => searchOpen ? closeSearch() : setSearchOpen(true)} disabled={opening}><Search size={16} /><span>Buscar</span><kbd>Ctrl F</kbd></button>
        </div>
        <ToolBar tools={tools} disabled={opening} openStudy={() => study.open('rhythm')} />
        <div className="reader-extra-tools">{!isEpub && <button className={thumbnails ? 'selected' : ''} disabled={opening} onClick={() => setThumbnails(value => !value)}>Miniaturas</button>}<button disabled={opening || !recent.some(entry => entry.id !== active?.id)} className={comparison ? 'selected' : ''} onClick={() => setComparison(value => value ? null : recent.find(entry => entry.id !== active?.id)?.id || null)}>Comparar livros</button></div>
        <StudyStrip study={study} history={history} disabled={opening} />
        <ReadingReminders study={study} />
        {speech.resumePoint && !speech.visible && <div className="study-strip">
          <button className="reading-estimate" onClick={() => void speech.resume()} disabled={opening}>Continuar ouvindo · {speech.unit.toLocaleLowerCase('pt-BR')} {speech.resumePoint.page}</button>
        </div>}
        <SpeechBar speech={speech} onFloat={() => void narrationFloating.open().catch(() => setError('Não foi possível abrir o player flutuante.'))} />
        {searchOpen && <form className="findbar" onSubmit={event => { event.preventDefault(); findDocument(true); }}><Search size={16} /><input ref={searchInput} aria-label="Buscar no documento" placeholder="Buscar no documento…" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && event.shiftKey) { event.preventDefault(); findDocument(true, true); } }} /><span className="match-count" role="status">{(isEpub || readingMode === 'text') && tools.searchState.scanning ? 'Buscando…' : query ? findMatches.total ? `${findMatches.current} de ${findMatches.total}` : 'Nenhum resultado' : 'Digite para buscar'}</span><IconButton label="Resultado anterior" disabled={!findMatches.total} onClick={() => findDocument(true, true)}><ChevronLeft size={16} /></IconButton><IconButton label="Próximo resultado" disabled={!findMatches.total} onClick={() => findDocument(true)}><ChevronRight size={16} /></IconButton><IconButton label="Fechar busca" onClick={closeSearch}><X size={16} /></IconButton></form>}
        <div className={`reading-workbench ${comparison ? 'comparing' : ''}`} data-paper={tools.comfort.paper}>
        {thumbnails && !isEpub && active && !opening && <Thumbnails key={active.id} id={active.id} reader={reader} page={page} total={totalPages} navigate={navigate} close={() => setThumbnails(false)} />}
        <div className={`canvas-area ${readingMode !== 'scroll' ? 'paged-reading' : ''} ${readingMode === 'text' ? 'text-mode' : ''}`}
          onMouseUp={event => tools.captureSelection(event.currentTarget)}
          onKeyUp={event => { if (event.shiftKey) tools.captureSelection(event.currentTarget); }}
          onPointerMove={event => { if (tools.comfort.ruler) event.currentTarget.style.setProperty('--ruler-y', `${event.clientY - event.currentTarget.getBoundingClientRect().top}px`); }}
          onTouchStart={event => { if (event.touches.length === 1) touchStart.current = { x: event.touches[0].clientX, y: event.touches[0].clientY }; else touchStart.current = null; }}
          onTouchEnd={event => {
            const start = touchStart.current; touchStart.current = null;
            const end = event.changedTouches[0];
            const container = document.getElementById('pdf-container');
            if (!start || !end || readingMode === 'scroll' || opening || !container || container.scrollWidth > container.clientWidth + 2) return;
            const dx = end.clientX - start.x;
            if (Math.abs(dx) > 65 && Math.abs(end.clientY - start.y) < 45) reader.current?.turn(dx < 0 ? 1 : -1);
          }}>
          <UnifiedReader ref={reader} mode={readingMode} comfort={tools.comfort} annotations={tools.notebook.annotations} ocrPages={tools.notebook.ocrPages} spoken={tools.speech.spoken} searchMatch={tools.textMatch} onPage={rememberPage} onEpubLocation={rememberEpubLocation} onSelection={tools.acceptSelection} onScale={(next, value) => { setScale(next); setZoomMode(value); }} onMatches={(current, total) => setMatches({ current, total })} onPassword={(update, incorrect) => { setPassword({ update, incorrect }); setPasswordValue(''); }} onRenderError={setError} />
          {readingMode === 'text' && <TextReader tools={tools} page={page} onOriginal={() => setReadingMode('single')} />}
          {tools.comfort.ruler && <div className="ruler-mask" aria-hidden="true"><div className="reading-ruler" /></div>}
          <SelectionBar tools={tools} consult={() => study.open('lookup')} card={() => void study.newCard().catch(error => study.setError(String(error)))} />
          <ExitFocus tools={tools} />
          {readingMode !== 'scroll' && <><button className="page-turn previous" aria-label="Virar para a página anterior" title="Página anterior (←)" disabled={!canPrevious || opening} onClick={() => reader.current?.turn(-1)}><ChevronLeft size={24} /></button><button className="page-turn next" aria-label="Virar para a próxima página" title="Próxima página (→)" disabled={!canNext || opening} onClick={() => reader.current?.turn(1)}><ChevronRight size={24} /></button></>}
        </div>
        {comparison && active && <Comparison key={comparison} id={comparison} entries={recent} primaryId={active.id} comfort={tools.comfort} choose={setComparison} close={() => { setComparison(null); void refresh(); }} />}
        <ToolPanel tools={tools} page={page} mode={readingMode} navigate={navigate} textMode={() => setReadingMode('text')} />
        </div>
        <ReadingProgress page={page} total={totalPages} savedPage={savedPage} status={saveStatus} mode={readingMode} disabled={opening} epub={epubLocation} onJump={number => navigate(number)} onProgress={progress => { history.capture(); reader.current?.goToProgress?.(progress); }} />
      </div>

      {libraryView && <section className="library-view">
        <div className="library-heading"><div><div className="eyebrow">UM TEMPO PARA LER</div><h1>Sua próxima página<br />começa aqui<span>.</span></h1><p>Um espaço tranquilo para seus livros.<br />Abra um PDF ou EPUB e continue de onde parou.</p></div><div className="hero-illustration" aria-hidden="true"><div className="paper paper-back" /><div className="paper paper-front"><span className="paper-label">UM MUNDO EM CADA PÁGINA</span><div className="paper-book"><BookOpen size={46} strokeWidth={1} /></div><span className="paper-title">Boas<br /><em>leituras.</em></span><div className="paper-lines"><i /><i /><i /></div><span className="paper-page">01</span></div><span className="paper-spark">✳</span></div></div>
        {resume && <button className="resume-reading" onClick={() => openRecent(resume)} disabled={opening}><span className="resume-icon"><BookmarkCheck size={24} strokeWidth={1.5} /></span><span className="resume-copy"><span className="eyebrow">SEU MARCADOR ESTÁ AQUI</span><strong>{bookName(resume)}</strong><span>{resume.format === 'epub' ? `Trecho salvo em ${resume.epubLocation?.title || `Seção ${resume.page}`} · ${progressPercent(resume)}% do livro` : `Você parou na página ${resume.page} de ${resume.totalPages} · ${progressPercent(resume)}% do livro`}</span></span><span className="resume-cta">Continuar leitura<ArrowRight size={17} /></span></button>}
        <button className="drop-zone" onClick={choosePdf} disabled={opening}><span className="drop-icon"><ArrowDownToLine size={22} strokeWidth={1.5} /></span><span className="drop-copy"><strong>Abra espaço para uma boa leitura</strong><span>Arraste um PDF ou EPUB para guardar uma cópia no app</span></span><span className="drop-cta">Importar livro<ArrowRight size={16} /></span></button>
        <LibraryFilters library={library} /><div className="section-heading"><h2>Sua biblioteca</h2><span>{recent.length ? `${recent.length} ${recent.length === 1 ? 'livro' : 'livros'}` : 'Seus livros recentes'}</span></div>
        {recent.length ? <div className="document-grid">{library.filtered.map(entry => <article className="document-card" key={entry.id}><button className="document-card-main" onClick={() => openRecent(entry)} disabled={opening}><div className="document-cover">{entry.hasCover ? <><img className="actual-cover" src={`lume://app/covers/${entry.id}`} alt={`Capa de ${bookName(entry)}`} /><span className="cover-format">{entry.format === 'epub' ? 'EPUB' : 'PDF'}</span></> : <><span>{entry.format === 'epub' ? 'EPUB' : 'PDF'}</span>{entry.format === 'epub' ? <BookOpen size={34} strokeWidth={1} /> : <FileText size={34} strokeWidth={1} />}<div className="cover-lines"><i /><i /><i /></div><span>{entry.totalPages ? `${entry.totalPages} ${entry.format === 'epub' ? 'SEÇÕES' : 'PÁGINAS'}` : fileSize(entry.size)}</span></>}{entry.totalPages > 0 && <span className="cover-bookmark"><BookmarkCheck size={12} />{entry.format === 'epub' ? 'Trecho salvo' : `Pág. ${entry.page}`}</span>}</div><div className="card-info"><h3 title={entry.name}>{bookName(entry)}</h3>{entry.author && <span className="card-author">{entry.author}</span>}<small className={`book-storage ${entry.storage === "managed" ? "managed" : "external"}`}>{entry.storage === "managed" ? "Salvo no app" : "Arquivo externo"}</small><span>{entry.totalPages ? entry.format === 'epub' ? `Seção ${entry.page} de ${entry.totalPages}` : `Parou na página ${entry.page} de ${entry.totalPages}` : 'Pronto para ler'}<ArrowRight size={14} /></span><div className="card-progress"><span style={{ width: `${progressPercent(entry)}%` }} /></div>{entry.totalPages > 0 && <span className="card-percent">{progressPercent(entry)}% do livro</span>}</div></button><div className="library-card-actions"><button aria-label={`${entry.favorite ? "Desfavoritar" : "Favoritar"} ${bookName(entry)}`} disabled={library.saving} onClick={() => void library.favorite(entry)}>{entry.favorite ? "★" : "☆"} Favorito</button>{entry.storage !== "managed" && <button disabled={opening} aria-label={`Guardar ${bookName(entry)} no app`} onClick={() => void open(() => window.lume.importExisting(entry.id))}>Guardar no app</button>}<button aria-label={`Organizar ${bookName(entry)}`} onClick={() => library.edit(entry)}>Organizar</button></div><IconButton label={`Remover ${entry.name} da lista`} className="remove-document" onClick={() => void removeRecent(entry)}><Trash2 size={14} /></IconButton></article>)}{!library.filtered.length && <div className="filtered-empty"><p>Nenhum livro corresponde aos filtros.</p><button className="inline-action" onClick={library.reset}>Mostrar todos os livros</button></div>}</div> : <div className="empty-library"><span className="empty-icon"><BookOpen size={24} strokeWidth={1.2} /></span><div><h3>Sua biblioteca está esperando a primeira história</h3><p>Os livros que você abrir aparecerão aqui, com sua posição de leitura salva.</p></div></div>}
        <div className="library-note"><LockKeyhole size={13} />Seus livros e anotações ficam neste computador. Consultas on-line enviam apenas o trecho escolhido.</div>
      </section>}

      {opening && !password && <div className="loading-overlay" role="status"><LoaderCircle className="spinner" size={30} /><h2>Preparando sua leitura</h2><p>Carregando o livro…</p><button className="text-button" onClick={cancelOpen}>Cancelar</button></div>}
    </main>

    {dragging && <div className="drag-overlay"><div><ArrowDownToLine size={40} /><h2>Solte seu PDF ou EPUB aqui</h2><p>Uma nova leitura está prestes a começar.</p></div></div>}
    {password && <div className="modal-backdrop"><form className="modal" role="dialog" aria-modal="true" aria-labelledby="password-title" onSubmit={event => { event.preventDefault(); password.update(passwordValue); setPassword(null); setPasswordValue(''); }}><span className="modal-icon"><LockKeyhole size={24} /></span><h2 id="password-title">Este PDF está protegido</h2><p>{password.incorrect ? 'A senha não está correta. Tente novamente.' : 'Digite a senha do documento para começar a leitura.'}</p><label htmlFor="pdf-password">Senha do PDF</label><input ref={passwordInput} id="pdf-password" type="password" autoComplete="off" value={passwordValue} onChange={event => setPasswordValue(event.target.value)} required /><div className="modal-actions"><button type="button" className="secondary-button" onClick={cancelOpen}>Cancelar</button><button className="primary-button" type="submit">Abrir documento<ArrowRight size={16} /></button></div></form></div>}
    {shortcutsOpen && <div className="modal-backdrop" onClick={() => setShortcutsOpen(false)}><section className="modal shortcuts-modal" role="dialog" aria-modal="true" aria-labelledby="shortcuts-title" onClick={event => event.stopPropagation()}><div className="modal-heading"><h2 id="shortcuts-title">No seu ritmo, pelo teclado</h2><IconButton label="Fechar atalhos" onClick={() => setShortcutsOpen(false)}><X size={18} /></IconButton></div><p>Pequenos atalhos para não interromper a leitura.</p>{[['Importar livro', 'Ctrl + O'], ['Abrir sem copiar', 'Ctrl + Shift + O'], ['Buscar no documento', 'Ctrl + F'], ['Página anterior / próxima', '← / →'], ['Aumentar / diminuir zoom', 'Ctrl + / Ctrl −'], ['Ajustar à largura', 'Ctrl + 0'], ['Primeira / última página', 'Ctrl + Home / End'], ['Tela cheia', 'F11'], ['Fechar busca ou janela', 'Esc']].map(([label, key]) => <div className="shortcut-row" key={label}><span>{label}</span><kbd>{key}</kbd></div>)}</section></div>}
    {importNotice && <div className="import-notice" role="status"><BookmarkCheck size={16} /><span>{importNotice}</span><button className="icon-button" aria-label="Fechar confirmação de importação" onClick={() => setImportNotice('')}><X size={14} /></button></div>}
    <ToolDialogs tools={tools} />
    <StudyPanel study={study} entry={active} page={page} tools={tools} navigate={point => navigate(point.page, point.location)} onOcr={() => { study.setTab(null); tools.setPanel('ocr'); }}
      onPlayExport={directory => { study.setTab(null); setExportRequest({ directory }); setPlayerOpened(true); }} />
    <LibraryOrganizationDialog library={library} />
    <WorkspacePanel tab={workspaceTab} setTab={setWorkspaceTab} entries={recent} refresh={refresh} prepare={prepare} deleted={closeTabs} jump={jump} />
    <AudioPlayer opened={playerOpened} open={() => { activate(); setPlayerOpened(true); }} close={() => setPlayerOpened(false)} stopNarration={speech.stop} exportRequest={exportRequest}
      mediaActive={mediaSource === 'file'} onPlayback={() => setMediaSource('file')} />
    {updatesOpened && <UpdatesPanel model={updates} prepare={prepare} close={() => setUpdatesOpened(false)} />}
    {lessonCardsOpened && <LessonCards close={() => setLessonCardsOpened(false)} />}
  </div>;
}
