import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { Book, EpubCFI, type Rendition, type Contents } from 'epubjs';
import type Section from 'epubjs/types/section';
import type { Location } from 'epubjs/types/rendition';
import type { NavItem } from 'epubjs/types/navigation';
import DOMPurify from 'dompurify';
import type { Annotation, BookMetadata, EpubLocation, PageText, ReadingMode, SelectionDraft } from './types';
import type { OutlineItem, ReaderHandle } from './PdfReader';
import type { Comfort, TextMatch } from './useReadingTools';

interface Props {
  containerId?: string;
  onReaderKey?(event: KeyboardEvent): void;
  mode: ReadingMode;
  comfort: Comfort;
  annotations: Annotation[];
  spoken: { page: number; paragraph: string } | null;
  onLocation(id: string, location: EpubLocation): void;
  onSelection(selection: SelectionDraft): void;
  onRenderError(message: string): void;
  searchMatch: TextMatch | null;
}
interface Context {
  id: string; book: Book; rendition: Rendition; mount: HTMLDivElement;
  sections: Section[]; outline: OutlineItem[]; location: EpubLocation | null;
  texts: Map<number, PageText>; marks: string[]; suppress: boolean;
  searchMark?: string;
}

const paragraphElements = (doc: Document) => {
  const elements = [...doc.querySelectorAll<HTMLElement>('body p, body h1, body h2, body h3, body h4, body h5, body h6, body li, body blockquote, body pre, body figcaption, body dt, body dd')]
    .filter(element => element.textContent?.trim() && !element.querySelector('p, h1, h2, h3, li, blockquote, pre, figcaption, dt, dd'));
  return elements.length ? elements : [...doc.querySelectorAll<HTMLElement>('body > div, body > section')].filter(element => element.textContent?.trim());
};
const collapsed = (cfi: string) => { const location = new EpubCFI(cfi); location.collapse(true); return location.toString(); };
const timeout = <T,>(promise: PromiseLike<T>, label: string, milliseconds = 45000) => new Promise<T>((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(label)), milliseconds);
  Promise.resolve(promise).then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
});

export const EpubReader = forwardRef<ReaderHandle, Props>(function EpubReader(props, ref) {
  const root = useRef<HTMLDivElement>(null);
  const latest = useRef(props); latest.current = props;
  const current = useRef<Context | null>(null);
  const pending = useRef<Book | null>(null);
  const generation = useRef(0);
  const resizing = useRef(0);
  const api = useRef<ReaderHandle | null>(null);

  function destroy(context: Context | null) {
    if (!context) return;
    context.suppress = true;
    try { context.rendition.destroy(); } catch { /* The view may already be unloaded. */ }
    try { context.book.destroy(); } catch { /* Closing remains possible for damaged books. */ }
    context.mount.remove();
  }
  useEffect(() => {
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(resizing.current);
      resizing.current = requestAnimationFrame(() => {
        if (current.current && root.current?.clientWidth && root.current.clientHeight) current.current.rendition.resize(root.current.clientWidth, root.current.clientHeight);
      });
    });
    if (root.current) observer.observe(root.current);
    return () => { observer.disconnect(); cancelAnimationFrame(resizing.current); generation.current++; destroy(current.current); current.current = null; pending.current?.destroy(); };
  }, []);

  function contents(context: Context): Contents[] {
    return context.rendition.getContents() as unknown as Contents[];
  }
  function applyComfort(context: Context) {
    const settings = latest.current.comfort;
    const paper = { light: ['#faf9f6', '#33372f'], sepia: ['#f5ecd9', '#55452e'], dark: ['#242820', '#e0dfcd'] }[settings.paper];
    context.rendition.themes.default({
      body: { color: `${paper[1]} !important`, background: `${paper[0]} !important`, 'line-height': `${settings.lineHeight} !important`, 'font-family': `"${settings.font}", serif !important` },
      'p, li, blockquote, figcaption, dd, dt': { 'font-family': 'inherit !important', 'font-size': '1em !important', 'line-height': 'inherit !important' },
      'p, blockquote': { 'max-width': `${settings.width}ch !important`, 'margin-left': 'auto !important', 'margin-right': 'auto !important' },
      'h1, h2, h3, h4, h5, h6': { 'font-family': 'inherit !important' },
      'img, svg': { 'max-width': '100% !important', 'object-fit': 'contain' },
      a: { color: settings.paper === 'dark' ? '#d2ae6d !important' : '#8d682d !important' },
      '.lume-speaking': { background: '#d9b65844 !important', 'box-shadow': 'inset 3px 0 #b48b39 !important' },
    });
    context.rendition.themes.fontSize(`${settings.size}px`);
  }
  function configure(context: Context) {
    context.rendition.flow(latest.current.mode === 'scroll' ? 'scrolled-doc' : 'paginated');
    context.rendition.spread(latest.current.mode === 'book' ? 'always' : 'none', 0);
    applyComfort(context);
  }
  useEffect(() => {
    const context = current.current;
    if (!context) return;
    const cfi = context.location?.cfi;
    configure(context);
    if (cfi) void context.rendition.display(cfi).catch(() => {});
  }, [props.mode]);
  useEffect(() => {
    const context = current.current;
    if (!context) return;
    const cfi = context.location?.cfi;
    applyComfort(context);
    if (cfi) void context.rendition.display(cfi).catch(() => {});
  }, [props.comfort.size, props.comfort.font, props.comfort.lineHeight, props.comfort.paper, props.comfort.width]);

  function applyMarks(context: Context) {
    if (context.searchMark) context.rendition.annotations.remove(context.searchMark, 'highlight');
    for (const location of context.marks) { try { context.rendition.annotations.remove(location, 'highlight'); } catch { /* The section may have been replaced. */ } }
    context.marks = [];
    const colors = { yellow: '#f3d251', green: '#75cb82', blue: '#68b5ed', pink: '#e995b4' };
    for (const annotation of latest.current.annotations) if (annotation.location && annotation.quote) {
      try {
        context.rendition.annotations.highlight(annotation.location, { id: annotation.id, color: annotation.color }, undefined, 'epub-highlight', { fill: colors[annotation.color], 'fill-opacity': '0.35', 'mix-blend-mode': 'multiply' });
        context.marks.push(annotation.location);
      } catch { /* Keep notes available even if an edited EPUB moved the original range. */ }
    }
    if (context.searchMark) context.rendition.annotations.highlight(context.searchMark, { kind: 'search' }, undefined, 'epub-find-match', { fill: '#dfa546', 'fill-opacity': '0.55' });
  }
  useEffect(() => { if (current.current) applyMarks(current.current); }, [props.annotations]);
  useEffect(() => {
    const context = current.current;
    if (!context) return;
    let canceled = false;
    if (context.searchMark) { context.rendition.annotations.remove(context.searchMark, 'highlight'); context.searchMark = undefined; applyMarks(context); }
    const match = props.searchMatch;
    if (match) void api.current?.selectionCfi?.({ page: match.page, quote: '', anchors: [], textAnchors: [{ paragraph: match.paragraph, start: match.start, end: match.end }] }).then(cfi => {
      if (canceled || current.current !== context || !cfi) return;
      context.searchMark = cfi;
      return context.rendition.display(collapsed(cfi)).then(() => { if (!canceled) applyMarks(context); });
    }).catch(() => {});
    return () => { canceled = true; };
  }, [props.searchMatch]);
  function applySpoken(context: Context) {
    for (const content of contents(context)) {
      for (const paragraph of content.document.querySelectorAll('.lume-speaking')) paragraph.classList.remove('lume-speaking');
      const spoken = latest.current.spoken;
      if (spoken && context.sections[spoken.page - 1]?.index === content.sectionIndex) content.document.querySelector(`[data-lume-paragraph="${spoken.paragraph}"]`)?.classList.add('lume-speaking');
    }
  }
  useEffect(() => {
    const context = current.current;
    if (!context) return;
    applySpoken(context);
    const spoken = props.spoken;
    if (!spoken) return;
    const paragraph = context.texts.get(spoken.page)?.paragraphs.find(item => item.id === spoken.paragraph);
    if (paragraph?.cfi && latest.current.mode !== 'text') void context.rendition.display(collapsed(paragraph.cfi)).then(() => {
      if (current.current === context) applySpoken(context);
    }).catch(() => {});
  }, [props.spoken?.paragraph, props.spoken?.page]);

  function location(context: Context, value: Location): EpubLocation {
    const chapter = Math.max(0, context.sections.findIndex(section => section.index === value.start.index)) + 1;
    const section = context.sections[chapter - 1];
    const title = context.outline.find(item => typeof item.destination === 'string' && item.destination.split('#')[0] === section?.href)?.title || `Seção ${chapter}`;
    const mapped = context.book.locations.length() > 1 ? context.book.locations.percentageFromCfi(value.start.cfi) : (chapter - 1) / Math.max(1, context.sections.length);
    const displayedPage = Math.max(1, value.start.displayed?.page || 1);
    return { cfi: value.start.cfi, chapter, chapters: context.sections.length, title, progress: value.atEnd ? 1 : Math.min(0.999, Math.max(0, Number.isFinite(mapped) ? mapped : 0)), displayedPage, displayedTotal: Math.max(displayedPage, value.start.displayed?.total || 1), atStart: value.atStart === true, atEnd: value.atEnd === true };
  }

  async function text(context: Context, number: number): Promise<PageText> {
    if (context.texts.has(number)) return context.texts.get(number)!;
    const section = context.sections[number - 1];
    if (!section) throw new Error('Seção do EPUB não encontrada.');
    await section.load(context.book.load.bind(context.book));
    const paragraphs = paragraphElements(section.document).map((element, index) => {
      const id = `p${number}-${index}`;
      element.dataset.lumeParagraph = id;
      const range = section.document.createRange();
      const walker = section.document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      const nodes: Node[] = []; let node = walker.nextNode();
      while (node) { nodes.push(node); node = walker.nextNode(); }
      if (nodes.length) { range.setStart(nodes[0], 0); range.setEnd(nodes.at(-1)!, nodes.at(-1)!.textContent?.length || 0); }
      else range.selectNodeContents(element);
      return { id, text: (element.textContent || '').replace(/\s+/g, ' ').trim(), rects: [], heading: /^H[1-6]$/.test(element.tagName.toUpperCase()), cfi: section.cfiFromRange(range) };
    }).filter(paragraph => paragraph.text);
    const result: PageText = { page: number, paragraphs, source: 'epub' };
    context.texts.set(number, result);
    return result;
  }

  async function cover(book: Book): Promise<Uint8Array | undefined> {
    try {
      const url = await book.coverUrl();
      if (!url || !url.startsWith('blob:') && !url.startsWith('data:')) return undefined;
      const image = new Image(); image.src = url;
      await timeout(image.decode(), 'Capa indisponível.', 3000);
      const canvas = document.createElement('canvas');
      const ratio = Math.min(320 / image.naturalWidth, 420 / image.naturalHeight, 1);
      canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio)); canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
      canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
      return blob ? new Uint8Array(await blob.arrayBuffer()) : undefined;
    } catch { return undefined; }
  }

  useImperativeHandle(ref, () => { const controller: ReaderHandle = {
    async open(source) {
      const ticket = ++generation.current;
      const book = new Book({ replacements: 'blobUrl', openAs: 'epub' });
      pending.current = book;
      let context: Context | null = null;
      book.spine.hooks.content.register((doc: Document, section: Section) => {
        for (const element of doc.querySelectorAll('script, iframe, object, embed, form, input, button, textarea, select, meta[http-equiv]')) element.remove();
        for (const element of doc.querySelectorAll('*')) for (const attribute of [...element.attributes]) if (/^on/i.test(attribute.name)) element.removeAttribute(attribute.name);
        const body = doc.querySelector('body');
        if (body) DOMPurify.sanitize(body, { IN_PLACE: true, ADD_TAGS: ['style'], ADD_ATTR: ['epub:type'], FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'textarea', 'select'] });
        const index = section.index + 1;
        paragraphElements(doc).forEach((paragraph, number) => { paragraph.dataset.lumeParagraph = `p${index}-${number}`; });
      });
      try {
        await timeout(book.open(new Uint8Array(source.data).buffer, 'binary'), 'O EPUB demorou a abrir. Verifique se o arquivo está íntegro.');
        await timeout(book.ready, 'Não foi possível carregar a estrutura do EPUB.');
        const sections: Section[] = [];
        book.spine.each((section: Section) => sections.push(section));
        if (!sections.length) throw new Error('Este EPUB não contém seções de leitura.');
        const outline: OutlineItem[] = [];
        const flatten = (items: NavItem[], depth = 0) => { for (const item of items) { outline.push({ title: item.label.trim(), destination: item.href, depth }); flatten(item.subitems || [], depth + 1); } };
        flatten(book.navigation.toc);
        Object.assign(book.locations, { pause: 0 });
        await timeout(book.locations.generate(1024), 'Não foi possível preparar a posição de leitura do EPUB.');
        if (ticket !== generation.current) throw new Error('Abertura cancelada.');
        const mount = document.createElement('div'); mount.className = 'epub-mount'; mount.style.visibility = 'hidden'; root.current!.append(mount);
        const rendition = book.renderTo(mount, { width: '100%', height: '100%', flow: latest.current.mode === 'scroll' ? 'scrolled-doc' : 'paginated', spread: latest.current.mode === 'book' ? 'always' : 'none', minSpreadWidth: 0, allowScriptedContent: false });
        context = { id: source.entry.id, book, rendition, mount, sections, outline, location: null, texts: new Map(), marks: [], suppress: true };
        const candidate = context;
        applyComfort(candidate);
        rendition.hooks.content.register((content: Contents) => {
          let lastActivity = 0;
          const activity = () => { if (Date.now() - lastActivity > 1000) { lastActivity = Date.now(); window.dispatchEvent(new Event('lume-reading-activity')); } };
          for (const event of ['pointerdown', 'pointermove', 'keydown', 'wheel']) content.document.addEventListener(event, activity, { passive: true });
          content.document.addEventListener('click', event => {
            const link = (event.target as Element).closest?.('a');
            if (link && /^(https?:|javascript:|mailto:|file:)/i.test(link.getAttribute('href') || '')) event.preventDefault();
          }, true);
          content.document.addEventListener('keydown', event => {
            if (/INPUT|TEXTAREA|SELECT/.test((event.target as Element).tagName)) return;
            const forwarded = new KeyboardEvent('keydown', { key: event.key, code: event.code, ctrlKey: event.ctrlKey, metaKey: event.metaKey, shiftKey: event.shiftKey, altKey: event.altKey, cancelable: true });
            if (latest.current.onReaderKey) latest.current.onReaderKey(forwarded); else window.dispatchEvent(forwarded);
            if (forwarded.defaultPrevented) event.preventDefault();
          });
          content.document.addEventListener('pointermove', event => {
            if (!latest.current.comfort.ruler) return;
            const canvas = root.current?.closest<HTMLElement>('.canvas-area');
            const frame = content.window.frameElement?.getBoundingClientRect();
            if (canvas && frame) canvas.style.setProperty('--ruler-y', `${frame.top + event.clientY - canvas.getBoundingClientRect().top}px`);
          });
        });
        rendition.on('relocated', (value: Location) => {
          candidate.location = location(candidate, value);
          if (current.current === candidate) applySpoken(candidate);
          if (!candidate.suppress && current.current === candidate) latest.current.onLocation(candidate.id, candidate.location);
        });
        rendition.on('selected', (cfi: string, content: Contents) => {
          if (current.current !== candidate) return;
          const range = content.range(cfi);
          const quote = range.toString().trim();
          if (quote && quote.length <= 12000) latest.current.onSelection({ page: Math.max(1, sections.findIndex(section => section.index === content.sectionIndex) + 1), quote, anchors: [], textAnchors: [], location: cfi });
        });
        rendition.on('rendered', () => { if (current.current === candidate) { applyMarks(candidate); applySpoken(candidate); } });
        const firstLocation = new Promise<void>(resolve => rendition.once('relocated', () => resolve()));
        const target = source.entry.epubLocation?.cfi || sections[Math.max(0, Math.min(source.entry.page - 1, sections.length - 1))].href;
        try { await timeout(rendition.display(target), 'Não foi possível exibir o conteúdo deste EPUB.'); }
        catch { await timeout(rendition.display(sections[0].href), 'Não foi possível exibir o conteúdo deste EPUB.'); }
        await rendition.reportLocation();
        await timeout(firstLocation, 'Não foi possível calcular a posição neste EPUB.');
        const metadata: BookMetadata = { title: book.packaging.metadata.title || source.entry.name.replace(/\.epub$/i, ''), author: book.packaging.metadata.creator || '', cover: await cover(book) };
        if (ticket !== generation.current) throw new Error('Abertura cancelada.');
        const previous = current.current;
        current.current = candidate; pending.current = null; candidate.suppress = false; mount.style.visibility = '';
        destroy(previous);
        applyMarks(candidate);
        if (!candidate.location) candidate.location = location(candidate, rendition.location);
        return { pages: sections.length, page: candidate.location.chapter, outline, metadata, epubLocation: candidate.location };
      } catch (error) {
        if (pending.current === book) pending.current = null;
        if (context) destroy(context); else book.destroy();
        throw error instanceof Error ? error : new Error('Não foi possível ler este EPUB.');
      }
    },
    close() { generation.current++; pending.current = null; destroy(current.current); current.current = null; },
    cancelLoading() { generation.current++; },
    page(number) { const context = current.current; if (context) void context.rendition.display(context.sections[Math.max(0, Math.min(number - 1, context.sections.length - 1))].href).catch(error => latest.current.onRenderError(String(error))); },
    turn(direction) { const context = current.current; if (context) void (direction === 1 ? context.rendition.next() : context.rendition.prev()).catch(() => {}); },
    zoom() {}, scale() {}, rotate() {}, find() {}, clearFind() {},
    destination(value) { if (typeof value === 'string' && current.current) void current.current.rendition.display(value).catch(() => latest.current.onRenderError('Não foi possível encontrar este trecho do EPUB.')); },
    text(number) { if (!current.current) return Promise.reject(new Error('Abra um EPUB para ler seu texto.')); return text(current.current, number); },
    image() { return Promise.reject(new Error('O reconhecimento de imagens está disponível para PDFs.')); },
    location: () => current.current?.location || null,
    goToProgress(progress) {
      const context = current.current;
      if (!context) return;
      void (async () => {
        let target = context.book.locations.cfiFromPercentage(Math.max(0, Math.min(progress, 1)));
        if (progress >= 1) {
          // A range around the final character avoids collapsed caret bounds in CSS columns.
          const section = context.sections.at(-1)!;
          await text(context, context.sections.length);
          const walker = section.document.createTreeWalker(section.document.body, NodeFilter.SHOW_TEXT);
          let last: Node | null = null, node = walker.nextNode();
          while (node) { if (node.textContent?.trim()) last = node; node = walker.nextNode(); }
          if (last) {
            const range = section.document.createRange(); const end = last.textContent!.trimEnd().length;
            range.setStart(last, end - 1); range.setEnd(last, end);
            target = section.cfiFromRange(range);
          }
        }
        if (!target || current.current !== context) return;
        await context.rendition.display(target);
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        if (current.current === context) await context.rendition.display(target);
      })().catch(() => latest.current.onRenderError('Não foi possível abrir esta posição do EPUB.'));
    },
    async selectionCfi(selection) {
      if (selection.location) return selection.location;
      const context = current.current;
      if (!context || !selection.textAnchors.length) return context?.location?.cfi;
      const section = context.sections[selection.page - 1];
      await text(context, selection.page);
      const paragraphs = paragraphElements(section.document);
      const range = section.document.createRange();
      const point = (paragraph: string, offset: number, end = false): [Node, number] => {
        const index = Number(paragraph.split('-').at(-1));
        const element = paragraphs[index];
        if (!element) throw new Error('Trecho não encontrado.');
        const raw = element.textContent || '';
        let normalized = '';
        const indices: number[] = [];
        for (let index = 0; index < raw.length; index++) {
          const character = /\s/.test(raw[index]) ? ' ' : raw[index];
          if (character === ' ' && (!normalized || normalized.endsWith(' '))) continue;
          normalized += character; indices.push(index);
        }
        if (normalized.endsWith(' ')) { normalized = normalized.slice(0, -1); indices.pop(); }
        offset = end && offset > 0 ? (indices[Math.min(offset - 1, indices.length - 1)] ?? 0) + 1 : (indices[Math.min(offset, indices.length - 1)] ?? 0);
        const walker = section.document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        let node = walker.nextNode(), previous: Node = element;
        while (node) { const length = node.textContent?.length || 0; if (offset <= length) return [node, offset]; offset -= length; previous = node; node = walker.nextNode(); }
        return [previous, previous.textContent?.length || 0];
      };
      const first = selection.textAnchors[0], last = selection.textAnchors.at(-1)!;
      const start = point(first.paragraph, first.start), end = point(last.paragraph, last.end, true);
      range.setStart(...start); range.setEnd(...end);
      return section.cfiFromRange(range);
    },
    currentParagraph() {
      const context = current.current;
      if (!context?.location) return undefined;
      const paragraphs = context.texts.get(context.location.chapter)?.paragraphs || [];
      let selected = paragraphs[0]?.id;
      for (const paragraph of paragraphs) if (paragraph.cfi && new EpubCFI().compare(collapsed(paragraph.cfi), context.location.cfi) <= 0) selected = paragraph.id;
      return selected;
    },
  }; api.current = controller; return controller; }, []);
  return <div id={props.containerId || 'epub-container'} className="epub-reader-container" ref={root} aria-label="Páginas do EPUB" aria-hidden={props.mode === 'text' || undefined} />;
});
