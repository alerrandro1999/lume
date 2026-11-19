import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { AnnotationMode, getDocument, GlobalWorkerOptions, PasswordResponses, type PDFDocumentLoadingTask, type PDFDocumentProxy } from 'pdfjs-dist';
import { EventBus, PDFViewer, PDFLinkService, PDFFindController, GenericL10n, ScrollMode, SpreadMode } from 'pdfjs-dist/web/pdf_viewer.mjs';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import 'pdfjs-dist/web/pdf_viewer.css';
import type { Annotation, BookMetadata, EpubLocation, NormalizedRect, OcrPage, OpenedPdf, PageText, ReadingMode, SelectionDraft } from './types';
import { pageRange, readZoom, rememberZoom } from './reading';
import { extractPage } from './text-extraction';

GlobalWorkerOptions.workerSrc = workerUrl;

export interface OutlineItem { title: string; destination: string | unknown[]; depth: number; page?: number }

export interface ReaderHandle {
  open(source: OpenedPdf): Promise<{ pages: number; page: number; outline: OutlineItem[]; metadata?: BookMetadata; epubLocation?: EpubLocation }>;
  close(): void;
  cancelLoading(): void;
  page(number: number): void;
  turn(direction: 1 | -1): void;
  zoom(direction: 1 | -1): void;
  scale(value: string): void;
  rotate(): void;
  find(query: string, again?: boolean, previous?: boolean): void;
  clearFind(): void;
  destination(value: string | unknown[]): void;
  text(page: number): Promise<PageText>;
  image(page: number): Promise<{ data: Uint8Array; width: number; height: number }>;
  location?(): EpubLocation | null;
  goToProgress?(progress: number): void;
  selectionCfi?(selection: SelectionDraft): Promise<string | undefined>;
  currentParagraph?(): string | undefined;
  thumbnail?(page: number): Promise<string>;
}

interface Props {
  containerId?: string;
  mode: ReadingMode;
  annotations?: Annotation[];
  ocrPages?: Record<string, OcrPage>;
  spoken?: { page: number; rects: NormalizedRect[] } | null;
  onPage(page: number): void;
  onScale(scale: number, value: string): void;
  onMatches(current: number, total: number): void;
  onPassword(update: (value: string) => void, incorrect: boolean): void;
  onRenderError(message: string): void;
}

export const PdfReader = forwardRef<ReaderHandle, Props>(function PdfReader(props, ref) {
  const container = useRef<HTMLDivElement>(null);
  const callbacks = useRef(props);
  callbacks.current = props;
  const state = useRef<{
    viewer: PDFViewer;
    links: PDFLinkService;
    bus: EventBus;
    document: PDFDocumentProxy | null;
    task: PDFDocumentLoadingTask | null;
    generation: number;
    configuring: boolean;
    texts: Map<number, Promise<PageText>>;
  } | null>(null);

  useEffect(() => {
    const bus = new EventBus();
    const links = new PDFLinkService({ eventBus: bus });
    links.externalLinkEnabled = false;
    const finder = new PDFFindController({ eventBus: bus, linkService: links });
    const abort = new AbortController();
    const options: ConstructorParameters<typeof PDFViewer>[0] & { abortSignal: AbortSignal } = {
      container: container.current!, eventBus: bus, linkService: links, findController: finder,
      l10n: new GenericL10n('pt-BR'), annotationMode: AnnotationMode.ENABLE,
      enableAutoLinking: false, abortSignal: abort.signal,
    };
    const viewer = new PDFViewer(options);
    links.setViewer(viewer);
    let animationFrame = 0;
    bus.on('pagechanging', ({ pageNumber, previous }: { pageNumber: number; previous: number }) => {
      if (state.current?.configuring) return;
      callbacks.current.onPage(pageNumber);
      requestAnimationFrame(applyLayers);
      if (callbacks.current.mode === 'scroll' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      cancelAnimationFrame(animationFrame);
      animationFrame = requestAnimationFrame(() => {
        if (!state.current?.document) return;
        const sheet = viewer.viewer?.querySelector<HTMLElement>('.spread, .page');
        if (!sheet) return;
        const distance = Math.max(0, Math.min(32, (container.current!.clientWidth - sheet.offsetWidth) / 2 - 4));
        sheet.getAnimations().forEach(animation => animation.cancel());
        sheet.animate([
          { transform: `translateX(${pageNumber > previous ? distance : -distance}px)`, opacity: 0.65 },
          { transform: 'translateX(0)', opacity: 1 },
        ], { duration: 220, easing: 'cubic-bezier(.2,.65,.3,1)' });
      });
    });
    bus.on('scalechanging', ({ scale }: { scale: number }) => {
      const value = viewer.currentScaleValue;
      callbacks.current.onScale(scale, value);
      if (state.current?.document && !state.current.configuring) rememberZoom(callbacks.current.mode, value);
      requestAnimationFrame(applyLayers);
    });
    bus.on('updatefindmatchescount', ({ matchesCount }: { matchesCount: { current: number; total: number } }) => {
      callbacks.current.onMatches(matchesCount.current, matchesCount.total);
    });
    bus.on('updatefindcontrolstate', ({ matchesCount }: { matchesCount: { current: number; total: number } }) => {
      callbacks.current.onMatches(matchesCount.current, matchesCount.total);
    });
    bus.on('pagerendered', ({ error }: { error?: Error }) => {
      if (error) callbacks.current.onRenderError('Não foi possível renderizar uma das páginas deste PDF.');
      applyLayers();
    });
    state.current = { viewer, links, bus, document: null, task: null, generation: 0, configuring: false, texts: new Map() };
    const resize = new ResizeObserver(() => {
      if (!state.current?.document || !container.current?.clientWidth || !container.current.clientHeight) return;
      container.current.style.setProperty('--viewer-container-height', `${container.current.clientHeight}px`);
      const value = viewer.currentScaleValue;
      if (['auto', 'page-fit', 'page-width', 'page-height'].includes(value)) viewer.currentScaleValue = value;
    });
    resize.observe(container.current!);
    return () => {
      resize.disconnect();
      const current = state.current;
      state.current = null;
      cancelAnimationFrame(animationFrame);
      abort.abort();
      viewer.setDocument(null);
      void current?.task?.destroy();
      void current?.document?.loadingTask.destroy();
    };
  }, []);

  function configure(mode: ReadingMode, target?: number) {
    const current = state.current;
    if (!current?.document) return;
    const page = target ?? current.viewer.currentPageNumber;
    current.configuring = true;
    try {
      current.viewer.scrollMode = mode === 'scroll' ? ScrollMode.VERTICAL : ScrollMode.PAGE;
      current.viewer.spreadMode = mode === 'book' ? SpreadMode.EVEN : SpreadMode.NONE;
      current.viewer.currentPageNumber = page;
      current.viewer.currentScaleValue = readZoom(mode);
    } finally { current.configuring = false; }
    callbacks.current.onScale(current.viewer.currentScale, current.viewer.currentScaleValue);
    callbacks.current.onPage(current.viewer.currentPageNumber);
  }

  useEffect(() => { configure(props.mode); }, [props.mode]);
  useEffect(() => { applyLayers(); }, [props.annotations, props.ocrPages, props.spoken]);

  function applyLayers() {
    const root = container.current;
    if (!root) return;
    for (const node of root.querySelectorAll('.lume-marks, .lume-ocr-layer')) node.remove();
    const rotate = (rect: NormalizedRect, rotation: number): NormalizedRect => {
      switch ((rotation + 360) % 360) {
        case 90: return { x: 1 - rect.y - rect.height, y: rect.x, width: rect.height, height: rect.width };
        case 180: return { x: 1 - rect.x - rect.width, y: 1 - rect.y - rect.height, width: rect.width, height: rect.height };
        case 270: return { x: rect.y, y: 1 - rect.x - rect.width, width: rect.height, height: rect.width };
        default: return rect;
      }
    };
    for (const sheet of root.querySelectorAll<HTMLElement>('.page[data-page-number]')) {
      const number = Number(sheet.dataset.pageNumber);
      const rotation = Number(sheet.dataset.mainRotation) || 0;
      const baseRotation = state.current?.viewer.getPageView(number - 1)?.pdfPage?.rotate || 0;
      const marks = document.createElement('div');
      marks.className = 'lume-marks';
      marks.setAttribute('aria-hidden', 'true');
      const add = (rect: NormalizedRect, color: string, id?: string, initialRotation = 0) => {
        const position = rotate(rect, rotation - initialRotation);
        const mark = document.createElement('span');
        mark.className = `pdf-mark ${color}`;
        if (id) mark.dataset.annotationId = id;
        Object.assign(mark.style, { left: `${position.x * 100}%`, top: `${position.y * 100}%`, width: `${position.width * 100}%`, height: `${position.height * 100}%` });
        marks.append(mark);
      };
      for (const annotation of callbacks.current.annotations || []) for (const anchor of annotation.anchors) {
        if (anchor.page === number) for (const rect of anchor.rects) add(rect, annotation.color, annotation.id, anchor.rotation);
      }
      if (callbacks.current.spoken?.page === number) for (const rect of callbacks.current.spoken.rects) add(rect, 'spoken', undefined, baseRotation);
      if (marks.childElementCount) sheet.append(marks);
      const recognized = callbacks.current.ocrPages?.[String(number)];
      if (!recognized?.words.length) continue;
      const layer = document.createElement('div');
      layer.className = 'lume-ocr-layer';
      for (const word of recognized.words) {
        const rect = rotate(word.rect, rotation - baseRotation);
        const span = document.createElement('span');
        span.textContent = word.text + ' ';
        Object.assign(span.style, { left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.width * 100}%`, height: `${rect.height * 100}%`, fontSize: `${Math.max(3, rect.height * sheet.clientHeight)}px` });
        layer.append(span);
      }
      sheet.append(layer);
    }
  }

  useImperativeHandle(ref, () => ({
    async open(source) {
      const current = state.current!;
      const generation = ++current.generation;
      if (current.task) await current.task.destroy();
      const asset = (name: string) => new URL(`./pdfjs/${name}/`, window.location.href).href;
      const task = getDocument({
        data: new Uint8Array(source.data),
        cMapUrl: asset('cmaps'), cMapPacked: true,
        standardFontDataUrl: asset('standard_fonts'),
        wasmUrl: asset('wasm'), iccUrl: asset('iccs'),
      });
      current.task = task;
      task.onPassword = (update: (value: string) => void, reason: number) => {
        if (generation === current.generation) callbacks.current.onPassword(update, reason === PasswordResponses.INCORRECT_PASSWORD);
      };
      try {
        const pdf = await task.promise;
        if (generation !== current.generation) { await pdf.loadingTask.destroy(); throw new Error('Abertura cancelada.'); }
        current.task = null;
        const previous = current.document;
        current.document = pdf;
        current.texts.clear();
        current.links.setDocument(pdf);
        const ready = new Promise<void>(resolve => {
          const initialized = () => {
            current.bus.off('pagesinit', initialized);
            configure(callbacks.current.mode, Math.min(source.entry.page, pdf.numPages));
            resolve();
          };
          current.bus.on('pagesinit', initialized);
        });
        current.viewer.setDocument(pdf);
        await ready;
        void previous?.loadingTask.destroy();
        const outline: OutlineItem[] = [];
        const flatten = (items: Awaited<ReturnType<PDFDocumentProxy['getOutline']>>, depth = 0) => {
          for (const item of items ?? []) {
            if (item.dest) outline.push({ title: item.title, destination: item.dest, depth });
            flatten(item.items, depth + 1);
          }
        };
        try { flatten(await pdf.getOutline()); } catch { /* The document can still be read without an outline. */ }
        await Promise.all(outline.filter(item => item.depth === 0).slice(0, 200).map(async item => {
          try { const destination = typeof item.destination === 'string' ? await pdf.getDestination(item.destination) : item.destination; const target = destination?.[0]; if (typeof target === 'number') item.page = target + 1; else if (target && typeof target === 'object' && 'num' in target && 'gen' in target) item.page = await pdf.getPageIndex(target as { num: number; gen: number }) + 1; } catch { /* Reading is available even for an invalid outline destination. */ }
        }));
        return { pages: pdf.numPages, page: current.viewer.currentPageNumber, outline };
      } catch (error) {
        if (current.task === task) current.task = null;
        await task.destroy();
        throw error;
      }
    },
    close() {
      const current = state.current;
      if (!current) return;
      current.generation++;
      current.viewer.setDocument(null);
      current.links.setDocument(null);
      void current.task?.destroy();
      void current.document?.loadingTask.destroy();
      current.document = null;
      current.task = null;
    },
    cancelLoading() {
      if (!state.current) return;
      state.current.generation++;
      void state.current.task?.destroy();
      state.current.task = null;
    },
    page(number) {
      const current = state.current;
      if (current?.document) current.viewer.currentPageNumber = Math.max(1, Math.min(number, current.document.numPages));
    },
    turn(direction) {
      const current = state.current;
      if (!current?.document) return;
      const [first, last] = pageRange(current.viewer.currentPageNumber, current.document.numPages, callbacks.current.mode);
      const target = direction === 1 ? last + 1 : first - 1;
      if (target >= 1 && target <= current.document.numPages) current.viewer.currentPageNumber = target;
    },
    zoom(direction) {
      const viewer = state.current?.viewer;
      if (!state.current?.document || !viewer) return;
      const next = Math.max(0.25, Math.min(5, viewer.currentScale * (direction === 1 ? 1.2 : 1 / 1.2)));
      viewer.currentScaleValue = String(Math.round(next * 100) / 100);
    },
    scale(value) { if (state.current?.document) state.current.viewer.currentScaleValue = value; },
    rotate() { if (state.current?.document) state.current.viewer.pagesRotation = (state.current.viewer.pagesRotation + 90) % 360; },
    find(query, again = false, previous = false) {
      state.current?.bus.dispatch('find', {
        source: this, type: again ? 'again' : '', query,
        caseSensitive: false, entireWord: false, highlightAll: true,
        findPrevious: previous, matchDiacritics: false,
      });
    },
    clearFind() { state.current?.bus.dispatch('findbarclose', { source: this }); },
    destination(value) { void state.current?.links.goToDestination(value); },
    async text(number) {
      const current = state.current;
      if (!current?.document) throw new Error('Abra um PDF para ler seu texto.');
      if (!current.texts.has(number)) current.texts.set(number, current.document.getPage(number).then(page => extractPage(page, number)));
      return current.texts.get(number)!;
    },
    async image(number) {
      const pdf = state.current?.document;
      if (!pdf) throw new Error('Abra um PDF antes de reconhecer o texto.');
      const page = await pdf.getPage(number);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: Math.min(2.5, 2400 / Math.max(base.width, base.height)) });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      await page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport }).promise;
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Não foi possível preparar a imagem da página.')), 'image/png'));
      const image = { data: new Uint8Array(await blob.arrayBuffer()), width: canvas.width, height: canvas.height };
      canvas.width = canvas.height = 0;
      return image;
    },
    async thumbnail(number) {
      const pdf = state.current?.document; if (!pdf) throw new Error('Abra um PDF.');
      const page = await pdf.getPage(number), base = page.getViewport({ scale: 1 }), viewport = page.getViewport({ scale: 130 / base.width });
      const canvas = document.createElement('canvas'); canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
      await page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport }).promise; const result = canvas.toDataURL('image/jpeg', .72); canvas.width = canvas.height = 0; return result;
    },
  }), []);

  return <div ref={container} id={props.containerId || 'pdf-container'} className="pdf-reader-container" data-mode={props.mode} tabIndex={props.mode === 'text' ? -1 : 0} aria-hidden={props.mode === 'text' || undefined} aria-label="Páginas do documento"><div className="pdfViewer" /></div>;
});
