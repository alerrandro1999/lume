import {
  beginText, endText, PDFDocument, popGraphicsState, pushGraphicsState, setFontAndSize,
  setTextMatrix, setTextRenderingMode, showText, StandardFonts, TextRenderingMode,
} from 'pdf-lib';
import type { OcrPage } from './types';

export async function addOcrText(bytes: Uint8Array, recognized: Record<string, OcrPage>) {
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const supported = new Set(font.getCharacterSet());
  const pages = pdf.getPages();
  let wordCount = 0;

  for (const [number, result] of Object.entries(recognized)) {
    const page = pages[Number(number) - 1];
    if (!page || !result.words.length) continue;
    const { x, y, width, height } = page.getCropBox();
    const rotation = ((page.getRotation().angle % 360) + 360) % 360;
    const point = (u: number, v: number): [number, number] => {
      if (rotation === 90) return [x + v * width, y + u * height];
      if (rotation === 180) return [x + (1 - u) * width, y + v * height];
      if (rotation === 270) return [x + (1 - v) * width, y + (1 - u) * height];
      return [x + u * width, y + (1 - v) * height];
    };
    const fontKey = page.node.newFontDictionary(font.name, font.ref);
    page.pushOperators(pushGraphicsState(), beginText(), setTextRenderingMode(TextRenderingMode.Invisible), setFontAndSize(fontKey, 1));
    for (const { text, rect } of result.words) {
      if (![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) || rect.width <= 0 || rect.height <= 0) continue;
      const value = Array.from(text.trim().normalize('NFC')).map(char => supported.has(char.codePointAt(0)!) ? char : Array.from(char.normalize('NFKD')).filter(part => supported.has(part.codePointAt(0)!)).join('')).join('');
      if (!value) continue;
      const baseline = rect.y + rect.height * .85;
      const [left, bottom] = point(rect.x, baseline);
      const [right, nextBottom] = point(rect.x + rect.width, baseline);
      const [topX, topY] = point(rect.x, baseline - rect.height);
      // Keep an explicit space even when edited words share the original word box.
      const spaced = `${value} `;
      const advance = font.widthOfTextAtSize(spaced, 1);
      if (!advance) continue;
      page.pushOperators(setTextMatrix((right - left) / advance, (nextBottom - bottom) / advance, topX - left, topY - bottom, left, bottom), showText(font.encodeText(spaced)));
      wordCount++;
    }
    page.pushOperators(endText(), popGraphicsState());
  }
  if (!wordCount) throw new Error('Reconheça o texto de pelo menos uma página antes de exportar.');
  return pdf.save();
}
