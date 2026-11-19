import type { BibliographyApi } from './bibliography-types';
import type { PlannerApi } from './planner-types';
import type { PresentationApi } from './presentation-types';
import type { ConceptMapApi } from './concept-map-types';
import type { ResearchApi } from './research-types';
import type { PortfolioApi } from './portfolio-types';
import type { WritingApi } from './writing-types';

export type ReadingMode = 'book' | 'single' | 'scroll' | 'text';
export type BookFormat = 'pdf' | 'epub';
export interface EpubLocation {
  cfi: string;
  chapter: number;
  chapters: number;
  title: string;
  progress: number;
  displayedPage: number;
  displayedTotal: number;
  atStart: boolean;
  atEnd: boolean;
}
export interface BookMetadata { title: string; author: string; cover?: Uint8Array }

export interface NormalizedRect { x: number; y: number; width: number; height: number }
export interface PdfAnchor { page: number; rects: NormalizedRect[]; rotation?: number }
export interface TextAnchor { paragraph: string; start: number; end: number }
export type MarkColor = 'yellow' | 'green' | 'blue' | 'pink';
export interface Annotation {
  id: string;
  page: number;
  quote: string;
  note: string;
  color: MarkColor;
  anchors: PdfAnchor[];
  textAnchors: TextAnchor[];
  createdAt: string;
  location?: string;
}
export interface Bookmark { id: string; page: number; label: string; createdAt: string; location?: string }
export interface OcrWord { text: string; rect: NormalizedRect }
export interface OcrBlock { id: string; text: string; wordCount: number }
export interface OcrPage { text: string; confidence: number; words: OcrWord[]; createdAt: string; blocks?: OcrBlock[]; reviewedAt?: string }
export interface ReadingOrder { order: string[]; hidden: string[]; includeMargins: boolean }
export interface PageReviewUpdate { layout: ReadingOrder | null; ocr?: OcrPage; expectedRevision?: string }
export interface PageImage { data: Uint8Array; width: number; height: number; region?: NormalizedRect }
export interface Notebook { annotations: Annotation[]; bookmarks: Bookmark[]; ocrPages: Record<string, OcrPage>; readingOrder?: Record<string, ReadingOrder> }
export interface Paragraph { id: string; text: string; rects: NormalizedRect[]; heading?: boolean; cfi?: string }
export interface PageText { page: number; paragraphs: Paragraph[]; source: 'pdf' | 'ocr' | 'epub' }
export interface SelectionDraft { page: number; quote: string; anchors: PdfAnchor[]; textAnchors: TextAnchor[]; location?: string }
export interface SpeechVoice { name: string; language: string }
export interface OcrProgress { jobId: string; progress: number; status: string }
export interface Crop { top: number; bottom: number; left: number; right: number }
export interface Organization { favorite: boolean; status: 'reading' | 'finished' | 'wishlist'; collection: string; tags: string[] }
export interface StudySettings { goal: number; breakEvery: number; breakDuration: number; reminders: boolean; wpm: number; autoPace: boolean }
export interface Flashcard { id: string; front: string; back: string; page: number; location?: string; interval: number; reviews: number; due: number; createdAt: string }
export interface NarrationPosition { page: number; index: number; paragraph: string; time: number; voice: string }
export interface GlossaryDraft { term: string; meaning: string; quote: string; source: 'Wikcionário' | 'MyMemory'; page: number; location?: string }
export interface GlossaryEntry extends GlossaryDraft { id: string; createdAt: number }
export interface BookSession { id: string; kind: 'reading' | 'listening'; startedAt: number; seconds: number }
export interface StudyData {
  settings: StudySettings;
  day: string;
  todaySeconds: number;
  book: { seconds: number; listeningSeconds: number; sessions: BookSession[]; glossary: GlossaryEntry[]; paceWords: number; paceSeconds: number; samples: number; cards: Flashcard[]; crop: Crop };
}
export interface AudiobookProgress { running: boolean; done: number; total: number; chapter: string; path?: string; error?: string }
export interface LookupRequest { text: string; kind: 'dictionary' | 'translate'; from?: string; to?: string }
export interface LookupResult { text?: string; html?: string; source: string; url: string }
export interface UpdateState { revision: number; version: string; channel: 'direct' | 'store'; stage: 'unconfigured' | 'development' | 'store' | 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'error' | 'installing'; message: string; availableVersion: string | null; checkedAt: string | null; percent: number; transferred: number; total: number }
export interface WorkspaceProgress { kind: string; running: boolean; done: number; total: number; detail: string; cancellable?: boolean; error?: string }
export interface BatchResult { added: number; duplicates: number; failed: number; canceled: boolean; ignored: number; items: { name: string; status: string; id?: string; error?: string }[] }
export interface StorageFile { key: string; title: string; size: number; ids: string[]; archived: boolean; deletable: boolean }
export interface StorageInfo { root: string; total: number; active: number; archived: number; files: StorageFile[] }
export interface RestorePlan { id: string; createdAt: string; books: number; archived: number; audio: number; missing: number }
export interface SearchUnit { page: number; text: string; cfi?: string }
export interface LibraryHit { id: string; title: string; page: number; cfi?: string; kind: string; snippet: string }
export interface LibrarySearchResult { hits: LibraryHit[]; indexed: number; stale: number; truncated: boolean }
export interface AudioTrack { id: string; path: string; name: string; title: string; author: string; duration: number; position: number; rate: number; size: number; url: string; chapters: { title: string; start: number }[]; bookmarks: { id: string; label: string; time: number }[] }
export interface ExportedAudiobook {
  directory: string;
  bookId: string;
  title: string;
  chapters: string[];
  index: number;
  track: AudioTrack;
}
export interface LinkedAudiobook { directory: string; title: string; chapters: number; createdAt: number }
export type FloatingPlayerSource = 'file' | 'narration';
export interface FloatingPlayerState {
  source: FloatingPlayerSource;
  title: string;
  detail: string;
  position: number;
  duration: number;
  playing: boolean;
  loading?: boolean;
  canSkip?: boolean;
  error: string;
}
export type FloatingPlayerCommand = 'toggle' | 'rewind' | 'forward' | 'seek';
interface FloatingPlayerApi {
  read(): Promise<FloatingPlayerState | null>;
  command(command: FloatingPlayerCommand | 'close' | 'expand', position?: number): Promise<void>;
  onState(callback: (state: FloatingPlayerState) => void): () => void;
}

export interface LibraryEntry {
  id: string;
  path: string;
  name: string;
  size: number;
  page: number;
  totalPages: number;
  openedAt: string;
  format?: BookFormat;
  title?: string;
  author?: string;
  hasCover?: boolean;
  epubLocation?: EpubLocation;
  favorite?: boolean;
  status?: Organization['status'];
  collection?: string;
  tags?: string[];
  storage?: 'managed' | 'external';
  contentHash?: string;
  originalPath?: string;
}

export interface OpenedPdf { entry: LibraryEntry; data: Uint8Array; importStatus?: 'copied' | 'duplicate' | 'external' }

export type TranscriptionLanguage = 'pt' | 'en' | 'es' | 'auto';
export type TranscriptionQuality = 'fast' | 'accurate';
export type TranscriptionFormat = 'txt' | 'srt';
export interface TranscriptionSummary { id: string; name: string; duration: number; createdAt: number; segmentCount: number; course: string }
export interface TranscriptionSegment { startMs: number; endMs: number; text: string }
export type TranscriptionMarkCategory = 'important' | 'question' | 'example';
export interface TranscriptionMarkInput { category: TranscriptionMarkCategory; note: string; segmentIndex?: number }
export interface TranscriptionMark extends TranscriptionSegment { id: string; category: TranscriptionMarkCategory; note: string }
export interface TranscriptionProject extends TranscriptionSummary { audioUrl: string; language: string | null; segments: TranscriptionSegment[]; marks: TranscriptionMark[] }
export interface TranscriptionProgress { id: string; phase: 'preparing' | 'transcribing'; percent: number }
export interface TranscriptionRange { first: number; last: number }
export interface TranscriptionSuggestion extends TranscriptionRange { version: string; startMs: number; endMs: number; segments: TranscriptionSegment[] }
export interface LessonSource { projectId: string; startMs: number }
export interface LessonSearchHit extends TranscriptionSegment, LessonSource { lesson: string; course: string }
export interface LessonCardInput { front: string; back: string }
export interface LessonCard extends LessonSource, LessonCardInput { id: string; lesson: string; course: string; interval: number; reviews: number; due: number; available: boolean }
export type LessonGrade = 'again' | 'hard' | 'good' | 'easy';

export interface LumeApi {
  portfolio: PortfolioApi;
  writing: WritingApi;
  research: ResearchApi;
  conceptMaps: ConceptMapApi;
  presentations: PresentationApi;
  planner: PlannerApi;
  bibliography: BibliographyApi;
  transcriptionList(): Promise<TranscriptionSummary[]>;
  transcriptionOpen(id: string): Promise<TranscriptionProject>;
  transcriptionImport(): Promise<TranscriptionProject | null>;
  transcriptionStart(id: string, language: TranscriptionLanguage, quality?: TranscriptionQuality): Promise<TranscriptionProject | null>;
  transcriptionRetryRange(id: string, language: TranscriptionLanguage, quality: TranscriptionQuality, range: TranscriptionRange): Promise<TranscriptionSuggestion | null>;
  transcriptionApplyRange(id: string, suggestion: TranscriptionSuggestion): Promise<TranscriptionProject>;
  transcriptionOrganize(id: string, course: string): Promise<TranscriptionProject>;
  transcriptionSearch(query: string, course: string): Promise<LessonSearchHit[]>;
  transcriptionGlossary(id: string): Promise<string[]>;
  transcriptionSaveGlossary(id: string, text: string): Promise<string[]>;
  transcriptionMakeCard(id: string, markId: string, value: LessonCardInput): Promise<void>;
  transcriptionCards(): Promise<LessonCard[]>;
  transcriptionReviewCard(id: string, grade: LessonGrade): Promise<LessonCard[]>;
  transcriptionRemoveCard(id: string): Promise<LessonCard[]>;
  transcriptionExportAnki(): Promise<string | null>;
  transcriptionCancel(id: string): Promise<void>;
  transcriptionEdit(id: string, index: number, value: string): Promise<TranscriptionProject>;
  transcriptionSaveMark(id: string, markId: string | null, value: TranscriptionMarkInput): Promise<TranscriptionProject>;
  transcriptionRemoveMark(id: string, markId: string): Promise<TranscriptionProject>;
  transcriptionExport(id: string, format: TranscriptionFormat): Promise<string | null>;
  transcriptionRemove(id: string): Promise<TranscriptionSummary[] | null>;
  onTranscriptionProgress(callback: (progress: TranscriptionProgress) => void): () => void;
  updateStatus(): Promise<UpdateState>;
  checkUpdates(): Promise<UpdateState>;
  downloadUpdate(): Promise<UpdateState>;
  installUpdate(): Promise<UpdateState>;
  onUpdateState(callback: (state: UpdateState) => void): () => void;
  readBookContent(id: string): Promise<OpenedPdf>;
  saveSearchablePdf(id: string, bytes: Uint8Array): Promise<string | null>;
  describeBook(id: string, value: { pages: number; title?: string; author?: string }): Promise<void>;
  searchStatus(): Promise<{ id: string; ready: boolean; units: number; indexedAt?: string }[]>;
  searchFingerprint(id: string): Promise<string>;
  saveSearchIndex(id: string, units: SearchUnit[], fingerprint: string): Promise<void>;
  searchLibrary(query: string, scope?: string): Promise<LibrarySearchResult>;
  workspaceStorage(): Promise<StorageInfo>;
  workspaceDeleteCopy(key: string): Promise<{ ids: string[]; bytes: number }>;
  workspaceImportFiles(): Promise<BatchResult | null>;
  workspaceImportFolder(): Promise<BatchResult | null>;
  workspaceMove(removeOld: boolean): Promise<{ root: string; copied: number; removed: number; warnings?: string[] } | null>;
  workspaceBackup(prefs: Record<string, string>, options: { includeAudio: boolean; allowMissing: boolean }): Promise<{ path: string; books: number; audio: number; missing: { name: string }[] } | null>;
  workspacePreviewRestore(): Promise<RestorePlan | null>;
  workspaceRestore(id: string): Promise<{ prefs: Record<string, string>; recovery: string; books: number }>;
  workspaceCancel(): Promise<void>;
  onWorkspaceProgress(callback: (value: WorkspaceProgress) => void): () => void;
  playerList(): Promise<AudioTrack[]>;
  playerChoose(): Promise<AudioTrack[] | null>;
  playerOpenExport(directory: string, index?: number): Promise<ExportedAudiobook>;
  playerListExports(id: string): Promise<LinkedAudiobook[]>;
  playerLinkExport(id: string): Promise<LinkedAudiobook[] | null>;
  playerProgress(id: string, position: number, rate: number): Promise<void>;
  playerCheckpoint(id: string, position: number, rate: number): void;
  playerBookmark(id: string, value: { label: string; time: number }): Promise<AudioTrack[]>;
  playerRemoveBookmark(id: string, mark: string): Promise<AudioTrack[]>;
  playerSleep(minutes: number): Promise<number>;
  mediaKeys(source: FloatingPlayerSource, active: boolean): Promise<void>;
  onMediaToggle(callback: (source: FloatingPlayerSource) => void): () => void;
  onPlayerSleep(callback: () => void): () => void;
  openFloatingPlayer(state: FloatingPlayerState): Promise<void>;
  closeFloatingPlayer(source: FloatingPlayerSource): Promise<void>;
  updateFloatingPlayer(state: FloatingPlayerState): Promise<void>;
  onFloatingPlayerCommand(callback: (source: FloatingPlayerSource, command: FloatingPlayerCommand, position?: number) => void): () => void;
  onFloatingPlayerSource(callback: (source: FloatingPlayerSource | null) => void): () => void;
  onFloatingPlayerExpand(callback: (source: FloatingPlayerSource) => void): () => void;
  chooseBook(mode?: 'import' | 'external'): Promise<OpenedPdf | null>;
  importExisting(id: string): Promise<OpenedPdf | null>;
  showBooksFolder(): Promise<void>;
  onExternalOpenRequest(callback: () => void): () => void;
  openDroppedBook(file: File): Promise<OpenedPdf>;
  choosePdf(): Promise<OpenedPdf | null>;
  openDroppedPdf(file: File): Promise<OpenedPdf>;
  openRecent(id: string): Promise<OpenedPdf>;
  listRecent(): Promise<LibraryEntry[]>;
  organizeBook(id: string, value: Organization): Promise<LibraryEntry>;
  readStudy(id: string): Promise<StudyData>;
  saveStudySettings(value: StudySettings): Promise<StudySettings>;
  recordReading(id: string, seconds: number, sample?: { words: number; seconds: number }, session?: BookSession): Promise<StudyData>;
  recordListening(id: string, value: BookSession): Promise<void>;
  saveGlossary(id: string, value: GlossaryDraft | string): Promise<StudyData>;
  narrationPosition(id: string, value?: NarrationPosition | null): Promise<NarrationPosition | null>;
  narrationCheckpoint(id: string, value: NarrationPosition): void;
  narrationSleep(minutes: 0 | 15 | 30 | 60): Promise<void>;
  onNarrationSleep(callback: () => void): () => void;
  saveCrop(id: string, value: Crop): Promise<StudyData>;
  saveCard(id: string, value: Pick<Flashcard, 'front' | 'back' | 'page' | 'location'> & { id?: string }): Promise<StudyData>;
  removeCard(id: string, cardId: string): Promise<StudyData>;
  reviewCard(id: string, cardId: string, grade: 'again' | 'hard' | 'good' | 'easy'): Promise<StudyData>;
  lookup(value: LookupRequest): Promise<LookupResult>;
  exportNotes(id: string, format: 'md' | 'pdf'): Promise<string | null>;
  showExport(path: string): Promise<void>;
  openLookupSource(url: string): Promise<void>;
  exportAudiobook(id: string, chapters: { title: string; text: string }[], voice: string): Promise<string | null>;
  cancelAudiobook(): Promise<void>;
  onAudiobookProgress(callback: (value: AudiobookProgress) => void): () => void;
  saveProgress(id: string, page: number, totalPages: number): Promise<void>;
  saveEpubProgress(id: string, location: EpubLocation): Promise<void>;
  saveBookMetadata(id: string, metadata: BookMetadata): Promise<LibraryEntry>;
  removeRecent(id: string): Promise<LibraryEntry[]>;
  onOpenRequest(callback: () => void): () => void;
  readNotebook(id: string): Promise<Notebook>;
  saveAnnotation(id: string, annotation: Omit<Annotation, 'id' | 'createdAt'> & { id?: string }): Promise<Notebook>;
  removeAnnotation(id: string, annotationId: string): Promise<Notebook>;
  saveBookmark(id: string, bookmark: { id?: string; page: number; label: string; location?: string }): Promise<Notebook>;
  removeBookmark(id: string, bookmarkId: string): Promise<Notebook>;
  recognizePage(id: string, page: number, image: { data: Uint8Array; width: number; height: number }, jobId: string): Promise<OcrPage>;
  recognizeArea(id: string, page: number, image: PageImage, jobId: string): Promise<OcrPage>;
  savePageReview(id: string, page: number, update: PageReviewUpdate): Promise<Notebook>;
  cancelOcr(): Promise<void>;
  onOcrProgress(callback: (progress: OcrProgress) => void): () => void;
  speechVoices(): Promise<SpeechVoice[]>;
  synthesizeSpeech(id: string, text: string, voice: string): Promise<Uint8Array>;
  cancelSpeech(): Promise<void>;
}

declare global { interface Window { lume: LumeApi; lumeFloatingPlayer: FloatingPlayerApi } }
