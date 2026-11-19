import { useEffect } from 'react';
import type { Crop } from './types';

// Crop the displayed paper without changing PDF coordinates used by notes, OCR and selection.
export function usePdfCrop(crop: Crop | undefined, enabled: boolean) {
  useEffect(() => {
    const root = document.getElementById('pdf-container'), viewer = root?.querySelector<HTMLElement>('.pdfViewer');
    if (!root || !viewer) return;
    const value = enabled && crop ? crop : { top: 0, right: 0, bottom: 0, left: 0 };
    const active = Object.values(value).some(margin => margin > 0);
    viewer.style.zoom = active ? String(1 / (1 - value.left - value.right)) : '';
    let frame = 0;
    const update = () => {
      for (const page of viewer.querySelectorAll<HTMLElement>('.page')) {
        const width = page.clientWidth, height = page.clientHeight;
        const signature = `${width},${height},${Object.values(value).join(',')}`;
        if (page.dataset.cropSignature === signature) continue;
        page.dataset.cropSignature = signature;
        page.style.clipPath = active ? `inset(${value.top * 100}% ${value.right * 100}% ${value.bottom * 100}% ${value.left * 100}%)` : '';
        page.style.marginTop = active ? `${12 - height * value.top}px` : '';
        page.style.marginBottom = active ? `${12 - height * value.bottom}px` : '';
        page.style.marginLeft = active ? `${12 - width * value.left}px` : '';
        page.style.marginRight = active ? `${12 - width * value.right}px` : '';
      }
    };
    const observer = new MutationObserver(() => { cancelAnimationFrame(frame); frame = requestAnimationFrame(update); });
    observer.observe(viewer, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'data-loaded'] });
    update();
    return () => { observer.disconnect(); cancelAnimationFrame(frame); viewer.style.zoom = ''; for (const page of viewer.querySelectorAll<HTMLElement>('.page')) { delete page.dataset.cropSignature; for (const key of ['clip-path', 'margin-top', 'margin-bottom', 'margin-left', 'margin-right']) page.style.removeProperty(key); } };
  }, [enabled, crop?.left, crop?.right, crop?.top, crop?.bottom]);
}

export async function detectMargins(data: Uint8Array): Promise<Crop> {
  const image = new Image(), url = URL.createObjectURL(new Blob([new Uint8Array(data).buffer], { type: 'image/png' }));
  try {
    image.src = url; await image.decode();
    const canvas = document.createElement('canvas'); const scale = Math.min(1, 900 / Math.max(image.width, image.height));
    canvas.width = Math.round(image.width * scale); canvas.height = Math.round(image.height * scale);
    const context = canvas.getContext('2d', { willReadFrequently: true })!; context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const rows = new Uint32Array(canvas.height), columns = new Uint32Array(canvas.width);
    for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) { const offset = (y * canvas.width + x) * 4; if (pixels[offset + 3] > 100 && Math.min(pixels[offset], pixels[offset + 1], pixels[offset + 2]) < 200) { rows[y]++; columns[x]++; } }
    const bounds = (values: Uint32Array) => { let first = 0, last = values.length - 1; while (first < last && values[first] < 3) first++; while (last > first && values[last] < 3) last--; return [first, last]; };
    const [left, right] = bounds(columns), [top, bottom] = bounds(rows);
    if (right - left < 5 || bottom - top < 5) throw new Error('Não foi possível detectar texto nesta página. Ajuste as margens manualmente.');
    const margin = (value: number) => Math.max(0, Math.min(.3, Math.floor((value - .02) * 100) / 100));
    return { left: margin(left / canvas.width), right: margin(1 - right / canvas.width), top: margin(top / canvas.height), bottom: margin(1 - bottom / canvas.height) };
  } finally { URL.revokeObjectURL(url); }
}
