import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { PdfReader, type ReaderHandle } from './PdfReader';
import { EpubReader } from './EpubReader';
import type { Annotation, EpubLocation, NormalizedRect, OcrPage, ReadingMode, SelectionDraft } from './types';
import type { Comfort, TextMatch } from './useReadingTools';

interface Props {
  idPrefix?: string;
  onReaderKey?(event: KeyboardEvent): void;
  mode: ReadingMode;
  comfort: Comfort;
  annotations: Annotation[];
  ocrPages: Record<string, OcrPage>;
  spoken: { page: number; paragraph: string; rects: NormalizedRect[] } | null;
  searchMatch: TextMatch | null;
  onPage(page: number): void;
  onScale(scale: number, value: string): void;
  onMatches(current: number, total: number): void;
  onPassword(update: (value: string) => void, incorrect: boolean): void;
  onRenderError(message: string): void;
  onEpubLocation(id: string, location: EpubLocation): void;
  onSelection(selection: SelectionDraft): void;
}

export const UnifiedReader = forwardRef<ReaderHandle, Props>(function UnifiedReader(props, ref) {
  const pdf = useRef<ReaderHandle>(null);
  const epub = useRef<ReaderHandle>(null);
  const kind = useRef<'pdf' | 'epub'>('pdf');
  const revision = useRef(0);
  const opening = useRef<{ previous: 'pdf' | 'epub'; next: 'pdf' | 'epub' } | null>(null);
  const [visible, setVisible] = useState<'pdf' | 'epub'>('pdf');
  const target = () => (kind.current === 'epub' ? epub.current : pdf.current)!;
  useImperativeHandle(ref, () => ({
    async open(source) {
      const previous = kind.current;
      const ticket = ++revision.current;
      const next = source.entry.format === 'epub' ? 'epub' : 'pdf';
      opening.current = { previous, next };
      kind.current = next; setVisible(next);
      try {
        const result = await target().open(source);
        if (ticket !== revision.current) throw new Error('Abertura cancelada.');
        opening.current = null;
        if (previous !== next) (previous === 'pdf' ? pdf.current : epub.current)?.close();
        return result;
      } catch (error) { if (ticket === revision.current) { opening.current = null; kind.current = previous; setVisible(previous); } throw error; }
    },
    close() { pdf.current?.close(); epub.current?.close(); },
    cancelLoading() { revision.current++; target().cancelLoading(); if (opening.current) { kind.current = opening.current.previous; setVisible(kind.current); opening.current = null; } },
    page(number) { target().page(number); },
    turn(direction) { target().turn(direction); },
    zoom(direction) { target().zoom(direction); },
    scale(value) { target().scale(value); },
    rotate() { target().rotate(); },
    find(query, again, previous) { target().find(query, again, previous); },
    clearFind() { target().clearFind(); },
    destination(value) { target().destination(value); },
    text(number) { return target().text(number); },
    image(number) { return target().image(number); },
    location: () => target().location?.() || null,
    goToProgress(progress) { target().goToProgress?.(progress); },
    selectionCfi: selection => target().selectionCfi?.(selection) || Promise.resolve(undefined),
    currentParagraph: () => target().currentParagraph?.(),
    thumbnail: number => target().thumbnail?.(number) || Promise.reject(new Error('Miniaturas disponíveis para PDF.')),
  }), []);
  return <>
    <div className={`reader-engine pdf-engine ${visible === 'pdf' ? '' : 'inactive-engine'}`}><PdfReader ref={pdf} {...props} containerId={`${props.idPrefix || ''}pdf-container`} /></div>
    <div className={`reader-engine epub-engine ${visible === 'epub' ? '' : 'inactive-engine'}`}><EpubReader ref={epub} {...props} containerId={`${props.idPrefix || ''}epub-container`} onLocation={props.onEpubLocation} /></div>
  </>;
});
