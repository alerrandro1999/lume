import { useEffect, useRef, type CSSProperties } from 'react';
import { FileScan, LoaderCircle, Volume2 } from 'lucide-react';
import type { Annotation, Paragraph } from './types';
import type { ReadingTools } from './useReadingTools';

function quoteRange(text: string, quote: string): [number, number] | null {
  let normalized = '';
  const indices: number[] = [];
  for (let index = 0; index < text.length; index++) {
    const character = /\s/.test(text[index]) ? ' ' : text[index];
    if (character === ' ' && normalized.endsWith(' ')) continue;
    normalized += character;
    indices.push(index);
  }
  const value = quote.replace(/\s+/g, ' ').trim();
  if (!value) return null;
  const found = normalized.toLocaleLowerCase('pt-BR').indexOf(value.toLocaleLowerCase('pt-BR'));
  return found < 0 ? null : [indices[found], indices[found + value.length - 1] + 1];
}

function markedText(paragraph: Paragraph, annotations: Annotation[], tools: ReadingTools) {
  const ranges: { start: number; end: number; color: string; id?: string; note?: string }[] = [];
  for (const annotation of annotations) {
    const anchors = annotation.textAnchors.filter(anchor => anchor.paragraph === paragraph.id && anchor.end <= paragraph.text.length &&
      (annotation.textAnchors.length !== 1 || paragraph.text.slice(anchor.start, anchor.end).replace(/\s+/g, ' ').trim() === annotation.quote.replace(/\s+/g, ' ').trim()));
    for (const anchor of anchors) ranges.push({ ...anchor, color: annotation.color, id: annotation.id, note: annotation.note });
    if (!anchors.length && annotation.quote) {
      const match = quoteRange(paragraph.text, annotation.quote);
      if (match) ranges.push({ start: match[0], end: match[1], color: annotation.color, id: annotation.id, note: annotation.note });
    }
  }
  if (tools.textMatch?.paragraph === paragraph.id) ranges.push({ ...tools.textMatch, color: 'find-match' });
  const cuts = [...new Set([0, paragraph.text.length, ...ranges.flatMap(range => [Math.max(0, range.start), Math.min(paragraph.text.length, range.end)])])].sort((a, b) => a - b);
  return cuts.slice(0, -1).map((start, index) => {
    const end = cuts[index + 1];
    const active = ranges.filter(range => range.start < end && range.end > start);
    const selected = active.find(range => range.color === 'find-match') || active[0];
    const text = paragraph.text.slice(start, end);
    return selected ? <mark key={start} className={`text-mark ${selected.color}`} title={selected.note || 'Trecho destacado'} data-annotation-id={selected.id}>{text}</mark> : <span key={start}>{text}</span>;
  });
}

export function TextReader({ tools, page, onOriginal }: { tools: ReadingTools; page: number; onOriginal(): void }) {
  const root = useRef<HTMLDivElement>(null);
  const content = tools.pageText?.page === page ? tools.pageText : null;
  useEffect(() => { if (root.current) root.current.scrollTop = 0; }, [page]);
  useEffect(() => {
    const paragraph = tools.speech.spoken?.page === page ? tools.speech.spoken.paragraph : tools.textMatch?.page === page ? tools.textMatch.paragraph : '';
    if (paragraph) root.current?.querySelector(`[data-paragraph="${paragraph}"]`)?.scrollIntoView({ block: 'center', behavior: 'auto' });
  }, [tools.speech.spoken?.paragraph, tools.textMatch, page, content]);
  const settings: CSSProperties = { fontFamily: `"${tools.comfort.font}", serif`, fontSize: tools.comfort.size, lineHeight: tools.comfort.lineHeight, maxWidth: `${tools.comfort.width}ch` };
  return <div ref={root} id="text-reading-view" className="text-reader" aria-label="Texto da página">
    <div className="text-page-heading"><span>LEITURA EM TEXTO · PÁGINA {page}{content?.source === 'ocr' ? ' · OCR' : ''}</span><div className="text-page-actions"><button className="text-button" disabled={tools.ocrState.running} onClick={() => tools.setReviewPage(page)}>Revisar a página</button><button className="text-button" onClick={onOriginal}>Ver PDF original</button></div></div>
    {tools.loadingText || !content ? <div className="text-empty"><LoaderCircle size={25} className="spinner" /><p>Preparando o texto da página…</p></div>
      : !content.paragraphs.length ? <div className="text-empty"><FileScan size={32} /><h2>Esta página ainda não tem texto selecionável</h2><p>Reconheça as palavras da imagem para ler, buscar e ouvir.</p><button className="primary-button" disabled={tools.ocrState.running} onClick={() => void tools.recognize()}>Reconhecer esta página</button></div>
      : <article className="reflow-article" style={settings}>
        {content.paragraphs.map(paragraph => <div className={`reflow-block ${tools.speech.spoken?.paragraph === paragraph.id && tools.speech.spoken.page === page ? 'speaking-paragraph' : ''}`} key={paragraph.id}>
          <p data-paragraph={paragraph.id} className={paragraph.heading ? 'reflow-heading' : ''}>{markedText(paragraph, tools.notebook.annotations.filter(annotation => annotation.page === page), tools)}</p>
          <button className="paragraph-listen" aria-label={`Ouvir trecho ${content.paragraphs.indexOf(paragraph) + 1}`} title="Ouvir a partir deste trecho" onClick={() => void tools.speech.begin(page, paragraph.id)}><Volume2 size={15} /></button>
        </div>)}
        <footer className="reflow-note">{content.source === 'ocr' ? 'Texto reconhecido por OCR. Confira nomes e números no original.' : 'Texto extraído do PDF. Imagens e tabelas podem ser consultadas no original.'}</footer>
      </article>}
  </div>;
}
