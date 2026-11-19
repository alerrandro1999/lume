import type { SelectionDraft, TextAnchor } from './types';

export function currentSelection(root: HTMLElement, page: number): SelectionDraft | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return null;
  const quote = selection.toString().trim();
  if (!quote || quote.length > 12000) return null;
  const textAnchors: TextAnchor[] = [];
  for (const paragraph of root.querySelectorAll<HTMLElement>('[data-paragraph]')) {
    if (!range.intersectsNode(paragraph)) continue;
    const prefix = document.createRange();
    prefix.selectNodeContents(paragraph);
    let start = 0;
    let end = paragraph.textContent?.length || 0;
    if (paragraph.contains(range.startContainer)) { prefix.setEnd(range.startContainer, range.startOffset); start = prefix.toString().length; }
    if (paragraph.contains(range.endContainer)) { prefix.selectNodeContents(paragraph); prefix.setEnd(range.endContainer, range.endOffset); end = prefix.toString().length; }
    if (end > start) textAnchors.push({ paragraph: paragraph.dataset.paragraph!, start, end });
  }
  const anchors = [];
  for (const sheet of root.querySelectorAll<HTMLElement>('.page[data-page-number]')) {
    if (!range.intersectsNode(sheet)) continue;
    const bounds = sheet.getBoundingClientRect();
    if (!bounds.width || !bounds.height) continue;
    const rects = [];
    const seen = new Set<string>();
    for (const rect of range.getClientRects()) {
      const x = Math.max(rect.left, bounds.left), y = Math.max(rect.top, bounds.top);
      const width = Math.min(rect.right, bounds.right) - x, height = Math.min(rect.bottom, bounds.bottom) - y;
      if (width <= 0 || height <= 0 || height > bounds.height * 0.15) continue;
      const key = [x, y, width, height].map(Math.round).join(',');
      if (seen.has(key)) continue;
      seen.add(key);
      rects.push({ x: (x - bounds.left) / bounds.width, y: (y - bounds.top) / bounds.height, width: width / bounds.width, height: height / bounds.height });
    }
    if (rects.length) anchors.push({ page: Number(sheet.dataset.pageNumber), rects, rotation: Number(sheet.dataset.mainRotation) || 0 });
  }
  return { page: anchors[0]?.page || page, quote, anchors, textAnchors };
}
