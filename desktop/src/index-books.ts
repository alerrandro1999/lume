import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import worker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { Book, EpubCFI } from 'epubjs';
import type Section from 'epubjs/types/section';
import DOMPurify from 'dompurify';
import { applyReadingOrder, extractPage, pdfReadingPage } from './text-extraction';
import type { LibraryEntry, PageText, SearchUnit } from './types';
GlobalWorkerOptions.workerSrc = worker;
export async function indexBook(entry: LibraryEntry, canceled: () => boolean) {
  const fingerprint = await window.lume.searchFingerprint(entry.id), source = await window.lume.readBookContent(entry.id), notebook = await window.lume.readNotebook(entry.id);
  const units: SearchUnit[] = []; const check = () => { if (canceled()) throw new Error('Indexação cancelada.'); };
  let pages = 0, title: string | undefined, author: string | undefined;
  if (entry.format !== 'epub') {
    const asset = (name: string) => new URL(`./pdfjs/${name}/`, location.href).href;
    const task = getDocument({ data: source.data, cMapUrl: asset('cmaps'), cMapPacked: true, standardFontDataUrl: asset('standard_fonts'), wasmUrl: asset('wasm'), iccUrl: asset('iccs') });
    task.onPassword = () => { void task.destroy(); };
    try {
      const pdf = await task.promise;
      pages = pdf.numPages;
      const cache = new Map<number, Promise<PageText>>();
      const native = (page: number) => {
        if (!cache.has(page)) cache.set(page, pdf.getPage(page).then(sourcePage => extractPage(sourcePage, page)));
        return cache.get(page)!;
      };
      for (let page = 1; page <= pages; page++) {
        check();
        const { text, margins } = await pdfReadingPage(page, pages, notebook, native);
        for (const paragraph of applyReadingOrder(text.paragraphs, margins, notebook.readingOrder?.[page])) {
          units.push({ page, text: paragraph.text });
        }
        cache.delete(page - 2);
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }
    catch (error) { check(); throw error; } finally { await task.destroy(); }
  } else {
    const book = new Book({ replacements: 'none' });
    book.spine.hooks.content.register((doc: Document) => {
      for (const element of doc.querySelectorAll('script, iframe, object, embed, form, input, button, textarea, select, meta[http-equiv]')) element.remove();
      for (const element of doc.querySelectorAll('*')) for (const attribute of [...element.attributes]) if (/^on/i.test(attribute.name)) element.removeAttribute(attribute.name);
      const body = doc.querySelector('body'); if (body) DOMPurify.sanitize(body, { IN_PLACE: true, ADD_TAGS: ['style'], ADD_ATTR: ['epub:type'], FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'textarea', 'select'] });
    });
    try {
      await book.open(new Uint8Array(source.data).buffer, 'binary'); await book.ready; check(); title = book.packaging.metadata.title; author = book.packaging.metadata.creator;
      const sections: Section[] = []; book.spine.each((section: Section) => sections.push(section)); pages = sections.length;
      for (let index = 0; index < sections.length; index++) {
        check(); const section = sections[index]; await section.load(book.load.bind(book));
        let elements = [...section.document.querySelectorAll('body p,body h1,body h2,body h3,body h4,body h5,body h6,body li,body blockquote,body pre,body figcaption,body dt,body dd')].filter(element => element.textContent?.trim() && !element.querySelector('p,h1,h2,h3,li,blockquote,pre,figcaption,dt,dd'));
        if (!elements.length) elements = [...section.document.querySelectorAll('body > div,body > section')].filter(element => element.textContent?.trim());
        for (const element of elements) {
          const walker = section.document.createTreeWalker(element, NodeFilter.SHOW_TEXT); const nodes: Node[] = []; let node = walker.nextNode(); while (node) { nodes.push(node); node = walker.nextNode(); } if (!nodes.length) continue;
          const range = section.document.createRange(); range.setStart(nodes[0], 0); range.setEnd(nodes.at(-1)!, nodes.at(-1)!.textContent?.length || 0); const cfi = new EpubCFI(section.cfiFromRange(range)); cfi.collapse(true);
          units.push({ page: index + 1, text: element.textContent!.replace(/\s+/g, ' ').trim(), cfi: cfi.toString() });
        }
        section.unload(); await new Promise(resolve => setTimeout(resolve, 0));
      }
    } finally { book.destroy(); }
  }
  check(); await window.lume.describeBook(entry.id, { pages, title, author }); await window.lume.saveSearchIndex(entry.id, units, fingerprint); return units.length;
}
