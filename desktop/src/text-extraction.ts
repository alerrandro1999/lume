import type { PDFPageProxy } from 'pdfjs-dist';
import type { NormalizedRect, Notebook, OcrPage, PageText, Paragraph, ReadingOrder } from './types';

interface Line { text: string; x: number; y: number; height: number; width: number; rects: NormalizedRect[]; column: number }
const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] || 0.02;

export async function extractPage(page: PDFPageProxy, number: number): Promise<PageText> {
  const viewport = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  const tokens = content.items.filter(item => 'str' in item && item.str.trim()).map(item => {
    if (!('str' in item)) throw new Error('Trecho de texto inválido.');
    const [, , , , x, y] = item.transform;
    const [a, b, c, d, e, f] = viewport.transform;
    const rect = [a * x + c * y + e, b * x + d * y + f, a * (x + item.width) + c * (y + item.height) + e, b * (x + item.width) + d * (y + item.height) + f];
    return {
      text: item.str,
      x: Math.max(0, Math.min(rect[0], rect[2]) / viewport.width),
      y: Math.max(0, Math.min(rect[1], rect[3]) / viewport.height),
      width: Math.min(1, Math.abs(rect[2] - rect[0]) / viewport.width),
      height: Math.min(1, Math.abs(rect[3] - rect[1]) / viewport.height),
    };
  }).sort((a, b) => Math.abs(a.y - b.y) < Math.min(a.height, b.height) * 0.35 ? a.x - b.x : a.y - b.y);
  const lines: Line[] = [];
  for (const token of tokens) {
    const previous = lines.at(-1);
    const sameLine = previous && Math.abs(previous.y - token.y) < Math.max(0.002, Math.min(previous.height, token.height) * 0.4);
    const gap = previous ? token.x - (previous.x + previous.width) : 0;
    if (sameLine && gap < Math.max(0.018, Math.min(0.045, token.height * 2))) {
      const separator = previous.text.endsWith(' ') || token.text.startsWith(' ') || gap < 0.001 ? '' : ' ';
      previous.text += separator + token.text;
      previous.width = Math.max(previous.width, token.x + token.width - previous.x);
      previous.height = Math.max(previous.height, token.height);
      previous.rects.push({ x: token.x, y: token.y, width: token.width, height: token.height });
    } else lines.push({ ...token, rects: [{ x: token.x, y: token.y, width: token.width, height: token.height }], column: 0 });
  }
  const ordered = columnOrder(lines, 3, (line, column) => { line.column = column; });
  const bodyHeight = median(lines.map(line => line.height));
  const gaps = ordered.slice(1).map((line, index) => line.column === ordered[index].column ? line.y - ordered[index].y : 0).filter(gap => gap > bodyHeight * 0.5 && gap < bodyHeight * 3);
  const normalGap = median(gaps) || bodyHeight * 1.4;
  const paragraphs: Paragraph[] = [];
  let previous: Line | undefined;
  for (const line of ordered) {
    if (/^(\d+|[ivxlcdm]+)$/i.test(line.text.trim()) && (line.y > 0.9 || line.y < 0.045)) continue;
    const heading = line.height > bodyHeight * 1.3;
    const paragraph = paragraphs.at(-1);
    const newParagraph = !previous || !paragraph || heading || paragraph.heading || line.column !== previous.column ||
      marginEdge(line) !== marginEdge(previous) || line.y - previous.y > normalGap * 1.45 || line.x - previous.x > bodyHeight * 1.2;
    if (newParagraph) paragraphs.push({ id: `p${number}-${paragraphs.length}`, text: line.text.trim(), rects: [...line.rects], heading });
    else {
      const hyphenated = /[\p{L}]-$/u.test(paragraph.text) && /^\p{Ll}/u.test(line.text);
      paragraph.text = (hyphenated ? paragraph.text.slice(0, -1) : paragraph.text + ' ') + line.text.trim();
      paragraph.rects.push(...line.rects);
    }
    previous = line;
  }
  return { page: number, paragraphs, source: 'pdf' };
}

export function ocrPageText(page: number, recognized: OcrPage): PageText {
  if (recognized.blocks) {
    let start = 0;
    const paragraphs = recognized.blocks.map(block => {
      const rects = recognized.words.slice(start, start + block.wordCount).map(word => word.rect);
      start += block.wordCount;
      return { id: block.id, text: compactText(block.text), rects };
    }).filter(block => block.text);
    return { page, paragraphs, source: 'ocr' };
  }
  let wordOffset = 0;
  const paragraphs = recognized.text.split(/\n\s*\n/).map(text => text.replace(/\s+/g, ' ').trim()).filter(Boolean).map((text, index) => {
    const count = text.split(/\s+/).length;
    const words = recognized.words.slice(wordOffset, wordOffset + count);
    wordOffset += count;
    return { id: `p${page}-${index}`, text, rects: words.map(word => word.rect) };
  });
  return { page, paragraphs, source: 'ocr' };
}

export const compactText = (value: string) => value.replace(/\s+/g, ' ').trim();

export function bounds(rects: NormalizedRect[]): NormalizedRect | null {
  if (!rects.length) return null;
  let left = 1, top = 1, right = 0, bottom = 0;
  for (const rect of rects) {
    left = Math.min(left, rect.x); top = Math.min(top, rect.y);
    right = Math.max(right, rect.x + rect.width); bottom = Math.max(bottom, rect.y + rect.height);
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

// Look for a gutter supported by several lines on both sides at the same height.
// Full-width headings divide the page into independently ordered bands.
export function columnOrder<T extends NormalizedRect>(items: T[], minimum = 3, assignColumn?: (item: T, column: number) => void): T[] {
  const byPosition = (a: T, b: T) => a.y - b.y || a.x - b.x;
  const sorted = [...items].sort(byPosition);
  let gutter = 0, best = 0;
  let columnItems = new Set<T>();
  for (const split of [.40, .45, .50, .55, .60, .65]) {
    const left = sorted.filter(item => item.x < split - .09 && item.x + item.width <= split - .012 && item.width >= .08);
    const right = sorted.filter(item => item.x >= split + .004 && item.x < split + .13 && item.width >= .08);
    if (left.length < minimum || right.length < minimum) continue;
    const top = Math.max(left[0].y, right[0].y);
    const bottom = Math.min(left.at(-1)!.y + left.at(-1)!.height, right.at(-1)!.y + right.at(-1)!.height);
    if (bottom - top < .04) continue;
    const gap = right.reduce((min, item) => Math.min(min, item.x), 1) - left.reduce((max, item) => Math.max(max, item.x + item.width), 0);
    const score = Math.min(left.length, right.length) + gap;
    if (score <= best) continue;
    gutter = split; best = score; columnItems = new Set([...left, ...right]);
  }
  if (!gutter) return sorted;
  const result: T[] = [], band: T[] = [];
  const flush = () => {
    const column = (item: T) => item.x >= gutter ? 2 : 1;
    band.sort((a, b) => column(a) - column(b) || byPosition(a, b));
    for (const item of band) { assignColumn?.(item, column(item)); result.push(item); }
    band.length = 0;
  };
  const first = sorted.findIndex(item => columnItems.has(item) && item.x >= gutter);
  let last = sorted.length - 1;
  while (!columnItems.has(sorted[last])) last--;
  for (const [index, item] of sorted.entries()) {
    const fullWidth = item.x < gutter - .03 && item.x + item.width > gutter + .025;
    const margin = item.y < .075 || item.y + item.height > .94;
    const outside = (index > last || index < first && sorted[first].y - item.y > .035) && !columnItems.has(item);
    if (fullWidth || outside || margin && !columnItems.has(item)) { flush(); result.push(item); }
    else band.push(item);
  }
  flush();
  return result;
}

export function orderOcrParagraphs(paragraphs: Paragraph[]) {
  const positioned = paragraphs.flatMap(paragraph => {
    const rect = bounds(paragraph.rects);
    return rect ? [{ ...rect, paragraph }] : [];
  });
  if (positioned.length !== paragraphs.length) return paragraphs;
  return columnOrder(positioned, 2).map(item => item.paragraph);
}

const marginEdge = (rect: NormalizedRect) => rect.y < .085 ? 'top' : rect.y + rect.height > .915 ? 'bottom' : '';
function marginSignature(block: Paragraph) {
  const rect = bounds(block.rects);
  if (!rect || block.text.length > 150 || rect.height > .05) return '';
  const edge = marginEdge(rect);
  if (!edge) return '';
  return edge + ':' + compactText(block.text.toLocaleLowerCase('pt-BR').replace(/\d+/g, '#'));
}

export function applyReadingOrder(paragraphs: Paragraph[], margins: string[], layout?: ReadingOrder) {
  const byId = new Map(paragraphs.map(block => [block.id, block]));
  const arranged = layout?.order.flatMap(id => {
    const block = byId.get(id);
    byId.delete(id);
    return block ? [block] : [];
  }) ?? [];
  const hidden = new Set(layout?.hidden);
  if (!layout?.includeMargins) for (const id of margins) hidden.add(id);
  return [...arranged, ...byId.values()].filter(block => !hidden.has(block.id));
}

export async function pdfReadingPage(page: number, total: number, notebook: Notebook, nativeText: (page: number) => Promise<PageText>) {
  const source = async (number: number) => {
    const recognized = notebook.ocrPages[number];
    if (!recognized) return nativeText(number);
    const text = ocrPageText(number, recognized);
    return { ...text, paragraphs: orderOcrParagraphs(text.paragraphs) };
  };
  const text = await source(page);
  const candidates = text.paragraphs.map(block => [block.id, marginSignature(block)] as const).filter(([, signature]) => signature);
  if (total < 3 || !candidates.length) return { text, margins: [] as string[] };
  const neighbors = [page - 1, page + 1, page - 2, page + 2].filter(number => number >= 1 && number <= total);
  const signatures = await Promise.all(neighbors.map(async number => {
    try { return new Set((await source(number)).paragraphs.map(marginSignature).filter(Boolean)); }
    catch { return new Set<string>(); }
  }));
  const margins = candidates.filter(([, signature]) => signatures.filter(other => other.has(signature)).length >= 2).map(([id]) => id);
  return { text, margins };
}

export function speechChunks(page: PageText): { text: string; paragraph: string; rects: NormalizedRect[] }[] {
  return page.paragraphs.flatMap(paragraph => {
    const chunks: string[] = [];
    let current = '';
    for (const sentence of paragraph.text.match(/[^.!?]+[.!?]*\s*/g) || [paragraph.text]) {
      if ((current + sentence).length > 700 && current.trim()) { chunks.push(current.trim()); current = ''; }
      if (sentence.length > 700) {
        const words = sentence.split(/\s+/);
        for (const word of words) {
          if ((current + word).length > 700) { chunks.push(current.trim()); current = ''; }
          current += `${word} `;
        }
      } else current += sentence;
    }
    if (current.trim()) chunks.push(current.trim());
    return chunks.map(text => ({ text, paragraph: paragraph.id, rects: paragraph.rects }));
  });
}
