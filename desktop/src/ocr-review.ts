import { bounds, compactText } from './text-extraction';
import type { NormalizedRect, OcrPage, OcrWord, PageImage, Paragraph } from './types';

export interface OcrDraftBlock { id: string; text: string; words: OcrWord[] }

export function draftFromOcr(page: number, ocr: OcrPage): OcrDraftBlock[] {
  let offset = 0;
  const blocks = ocr.blocks ?? ocr.text.split(/\n\s*\n/).map(compactText).filter(Boolean).map((text, index) => ({
    id: `p${page}-${index}`, text, wordCount: text.split(/\s+/).length,
  }));
  const draft = blocks.map(block => {
    const words = ocr.words.slice(offset, offset + block.wordCount);
    offset += block.wordCount;
    return { id: block.id, text: block.text, words };
  });
  // Older OCR records have a text string and flat word geometry only.
  if (offset < ocr.words.length && draft.length) draft[draft.length - 1].words.push(...ocr.words.slice(offset));
  return draft;
}

export function ocrInReadingOrder(page: number, ocr: OcrPage, paragraphs: Paragraph[]): OcrPage {
  const groups = new Map(draftFromOcr(page, ocr).map(block => [block.id, block.words]));
  if (!groups.size && !ocr.blocks) return ocr;
  return { ...ocr, words: paragraphs.flatMap(block => groups.get(block.id) ?? []) };
}

function placeWords(text: string, original: OcrWord[]) {
  const tokens = compactText(text).split(' ').filter(Boolean);
  const result: OcrWord[] = [];
  const unchanged = (index: number, position: number) => original[index]?.text === tokens[position];
  let old = 0, next = 0;
  while (old < original.length && next < tokens.length) {
    if (unchanged(old, next)) {
      result.push(original[old++]); next++;
      continue;
    }
    let oldEnd = old + 1, nextEnd = next + 1;
    // Reuse matching word boxes after insertions or deletions in this paragraph.
    for (let distance = 1; distance <= 16; distance++) {
      let found = false;
      for (let step = 0; step <= distance; step++) {
        const a = old + step, b = next + distance - step;
        if (a >= original.length || b >= tokens.length || !unchanged(a, b)) continue;
        if (!unchanged(a + 1, b + 1) && (a + 1 < original.length || b + 1 < tokens.length)) continue;
        oldEnd = a; nextEnd = b; found = true; break;
      }
      if (found) break;
    }
    const changed = original.slice(old, oldEnd);
    const slots = changed.length ? changed : [original[old]];
    for (let i = next; i < nextEnd; i++) {
      const index = i - next, total = nextEnd - next;
      const from = Math.floor(index * slots.length / total);
      const to = Math.ceil((index + 1) * slots.length / total);
      const rect = bounds(slots.slice(from, to).map(word => word.rect))!;
      if (slots.length === 1 && total > 1) {
        rect.x += rect.width * index / total;
        rect.width /= total;
      }
      result.push({ text: tokens[i], rect });
    }
    old = oldEnd; next = nextEnd;
  }
  if (original.length) for (const token of tokens.slice(next)) result.push({ text: token, rect: original[Math.max(0, old - 1)].rect });
  return result;
}

export function editOcrBlock(block: OcrDraftBlock, text: string): OcrDraftBlock {
  return { ...block, text, words: placeWords(text, block.words) };
}

export function saveOcrDraft(original: OcrPage, draft: OcrDraftBlock[]): OcrPage {
  return {
    ...original,
    text: draft.map(block => block.text.trim()).filter(Boolean).join('\n\n'),
    words: draft.flatMap(block => block.words),
    blocks: draft.map(block => ({ id: block.id, text: block.text.trim(), wordCount: block.words.length })),
  };
}

export function mergeOcrArea(page: number, current: OcrDraftBlock[], result: OcrPage, region: NormalizedRect) {
  const inside = ({ rect }: OcrWord) => {
    const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
    return x >= region.x && x <= region.x + region.width && y >= region.y && y <= region.y + region.height;
  };
  const newBlocks = draftFromOcr(page, result).map(block => ({
    ...block,
    id: `p${page}-${crypto.randomUUID()}`,
    words: block.words.map(({ text, rect }) => ({
      text,
      rect: { x: region.x + rect.x * region.width, y: region.y + rect.y * region.height, width: rect.width * region.width, height: rect.height * region.height },
    })),
  }));
  if (!newBlocks.some(block => block.words.length)) throw new Error('Nenhum texto encontrado na área. Ajuste a seleção e tente novamente.');
  const draft: OcrDraftBlock[] = [];
  let inserted = false;
  const insert = () => { if (!inserted) draft.push(...newBlocks); inserted = true; };
  for (const block of current) {
    const start = block.words.findIndex(inside);
    if (start < 0) {
      const box = bounds(block.words.map(word => word.rect));
      if (box && box.y > region.y + region.height) insert();
      draft.push(block);
      continue;
    }
    const before = block.words.slice(0, start);
    const after = block.words.slice(start).filter(word => !inside(word));
    if (before.length) draft.push({ ...block, text: before.map(word => word.text).join(' '), words: before });
    insert();
    if (after.length) draft.push({ id: before.length ? `p${page}-${crypto.randomUUID()}` : block.id, text: after.map(word => word.text).join(' '), words: after });
  }
  insert();
  return draft;
}

export async function cropPageImage(image: PageImage, selection: NormalizedRect): Promise<PageImage & { region: NormalizedRect }> {
  const left = Math.floor(selection.x * image.width), top = Math.floor(selection.y * image.height);
  const width = Math.min(image.width, Math.ceil((selection.x + selection.width) * image.width)) - left;
  const height = Math.min(image.height, Math.ceil((selection.y + selection.height) * image.height)) - top;
  if (width < 12 || height < 12) throw new Error('Selecione uma área maior da página.');
  const bitmap = await createImageBitmap(new Blob([new Uint8Array(image.data)], { type: 'image/png' }));
  try {
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    canvas.getContext('2d')!.drawImage(bitmap, left, top, width, height, 0, 0, width, height);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('Não foi possível preparar a área.')), 'image/png'));
    return { data: new Uint8Array(await blob.arrayBuffer()), width, height, region: { x: left / image.width, y: top / image.height, width: width / image.width, height: height / image.height } };
  } finally { bitmap.close(); }
}
