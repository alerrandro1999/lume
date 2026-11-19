import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { ArrowDown, ArrowUp, FileScan } from 'lucide-react';
import { draftFromOcr, editOcrBlock, mergeOcrArea, saveOcrDraft, type OcrDraftBlock } from './ocr-review';
import { applyReadingOrder, bounds, compactText, orderOcrParagraphs } from './text-extraction';
import type { NormalizedRect, Paragraph } from './types';
import type { ReadingTools } from './useReadingTools';

type Review = Awaited<ReturnType<ReadingTools['loadPageReview']>>;
type Draft = { paragraphs: Paragraph[]; hidden: string[]; includeMargins: boolean; manual: boolean; ocr: OcrDraftBlock[] | null; edited: boolean };
const INITIAL_REGION = { x: .15, y: .1, width: .7, height: .2 };
const explain = (error: unknown) => error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : 'Não foi possível revisar a página.';

function makeDraft(value: Review): Draft {
  const { text, layout, ocr } = value;
  const order = layout ? { ...layout, hidden: [], includeMargins: true } : undefined;
  return {
    paragraphs: applyReadingOrder(text.paragraphs, [], order),
    hidden: layout?.hidden ?? [], includeMargins: layout?.includeMargins ?? false, manual: !!layout,
    ocr: ocr ? draftFromOcr(text.page, ocr) : null, edited: false,
  };
}

function AreaControls({ region, change, disabled }: { region: NormalizedRect; change(value: NormalizedRect): void; disabled: boolean }) {
  const update = (key: keyof NormalizedRect, number: number) => {
    if (!Number.isFinite(number)) return;
    const next = { ...region, [key]: Math.max(0, Math.min(1, number / 100)) };
    next.x = Math.min(next.x, .98); next.y = Math.min(next.y, .98);
    next.width = Math.max(.02, Math.min(next.width, 1 - next.x));
    next.height = Math.max(.02, Math.min(next.height, 1 - next.y));
    change(next);
  };
  return <div className="review-region-values">
    {([['x', 'Esquerda'], ['y', 'Topo'], ['width', 'Largura'], ['height', 'Altura']] as const).map(([key, label]) =>
      <label key={key}>{label} (%)<input disabled={disabled} type="number" min={0} max={100} value={Math.round(region[key] * 100)} onChange={event => update(key, event.target.valueAsNumber)} /></label>)}
  </div>;
}

export function PageReview({ page, tools, close }: { page: number; tools: ReadingTools; close(): void }) {
  const load = tools.loadPageReview;
  const [review, setReview] = useState<Review | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [active, setActive] = useState('');
  const [area, setArea] = useState<NormalizedRect | null>(null);
  const [working, setWorking] = useState(false);
  const start = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    let canceled = false, preview = '';
    load(page).then(value => {
      if (canceled) return;
      preview = URL.createObjectURL(new Blob([new Uint8Array(value.image.data)], { type: 'image/png' }));
      setReview(value); setDraft(makeDraft(value)); setUrl(preview);
      setActive(value.text.paragraphs.find(block => !value.margins.includes(block.id))?.id ?? '');
    }).catch(error => { if (!canceled) setError(explain(error)); });
    return () => { canceled = true; if (preview) URL.revokeObjectURL(preview); };
  }, [load, page]);

  if (!review || !draft) return <div className="page-review"><p role="status">{error || 'Preparando a página original e os blocos de leitura…'}</p></div>;
  const selected = draft.paragraphs.find(block => block.id === active);
  const highlight = area || (selected && bounds(selected.rects));
  const layoutFor = (value: Draft) => ({ order: value.paragraphs.map(block => block.id), hidden: value.hidden, includeMargins: value.includeMargins });
  const visible = applyReadingOrder(draft.paragraphs, review.margins, layoutFor(draft));
  const rectFor = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const clamp = (value: number) => Math.min(1, Math.max(0, value));
    return { x: clamp((event.clientX - rect.left) / rect.width), y: clamp((event.clientY - rect.top) / rect.height) };
  };
  function selectArea(event: PointerEvent<HTMLDivElement>) {
    if (!area || !start.current) return;
    const to = rectFor(event), from = start.current;
    setArea({ x: Math.min(from.x, to.x), y: Math.min(from.y, to.y), width: Math.abs(from.x - to.x), height: Math.abs(from.y - to.y) });
  }
  function move(index: number, direction: number) {
    setDraft(current => {
      if (!current) return current;
      const paragraphs = [...current.paragraphs], other = index + direction;
      if (other < 0 || other >= paragraphs.length) return current;
      [paragraphs[index], paragraphs[other]] = [paragraphs[other], paragraphs[index]];
      return { ...current, paragraphs, manual: true };
    });
  }
  function toggleBlock(id: string) {
    setDraft(current => current && ({ ...current, manual: true, hidden: current.hidden.includes(id) ? current.hidden.filter(item => item !== id) : [...current.hidden, id] }));
  }
  function edit(text: string) {
    setDraft(current => current && ({ ...current, edited: true, paragraphs: current.paragraphs.map(block => block.id === active ? { ...block, text } : block) }));
  }
  function corrected(value: Draft) {
    return value.ocr?.map(block => {
      const text = value.paragraphs.find(item => item.id === block.id)?.text ?? block.text;
      return compactText(text) === compactText(block.text) ? block : editOcrBlock(block, text);
    });
  }
  async function recognizeArea() {
    if (!area || !draft?.ocr || !review) return;
    setWorking(true); setError(''); setStatus('Reconhecendo a área marcada…');
    try {
      const { result, region } = await tools.recognizeArea(review.id, page, review.image, area);
      const ocr = mergeOcrArea(page, corrected(draft)!, result, region);
      const blocks = ocr.map(block => ({ id: block.id, text: block.text, rects: block.words.map(word => word.rect) }));
      const arranged = orderOcrParagraphs(blocks);
      const keep = new Set(blocks.map(block => block.id));
      const paragraphs = draft.manual
        ? applyReadingOrder(arranged, [], { ...layoutFor(draft), hidden: [], includeMargins: true })
        : arranged;
      setDraft({ ...draft, paragraphs, ocr, edited: true, hidden: draft.hidden.filter(id => keep.has(id)) });
      setActive(ocr.find(block => !draft.ocr!.some(previous => previous.id === block.id))?.id ?? '');
      setArea(null);
      setStatus('Área reconhecida. Revise o texto e salve para aplicar ao livro.');
    } catch (error) { setError(explain(error)); setStatus(''); }
    finally { setWorking(false); }
  }
  function resetOrder() {
    setDraft(current => {
      if (!current) return current;
      const byId = new Map(current.paragraphs.map(block => [block.id, block]));
      const automatic = current.ocr ? orderOcrParagraphs(current.ocr.flatMap(block => {
        const paragraph = byId.get(block.id);
        return paragraph ? [paragraph] : [];
      })) : review!.text.paragraphs;
      return { ...current, paragraphs: automatic, hidden: [], includeMargins: false, manual: false };
    });
  }
  async function save() {
    if (!review || !draft || working) return;
    const ocr = corrected(draft);
    setWorking(true); setError('');
    try {
      await tools.savePageReview(review.id, page, {
        layout: draft.manual ? layoutFor(draft) : null,
        expectedRevision: review.ocr?.reviewedAt || review.ocr?.createdAt,
        ocr: review.ocr && ocr && (draft.edited || !review.ocr.blocks && draft.manual) ? saveOcrDraft(review.ocr, ocr) : undefined,
      });
    } catch (error) { setError(explain(error)); }
    finally { setWorking(false); }
  }
  return <div className="page-review">
    <div className="page-review-columns">
      <section className="review-original" aria-label="Página original">
        <h3>Página original</h3>
        {area && <p className="review-hint">Arraste sobre a página ou ajuste as medidas da área.</p>}
        <div className="review-preview-scroll">
          <div className={area && !working ? 'review-image selecting' : 'review-image'} onPointerDown={event => {
            if (!area || working || event.button !== 0) return;
            start.current = rectFor(event); event.currentTarget.setPointerCapture(event.pointerId);
          }} onPointerMove={selectArea} onPointerUp={event => { selectArea(event); start.current = null; }} onPointerCancel={() => { start.current = null; }}>
            <img src={url} alt={`Prévia da página ${page} do PDF`} draggable={false} />
            {highlight && <span className="review-highlight" style={{ left: `${highlight.x * 100}%`, top: `${highlight.y * 100}%`, width: `${highlight.width * 100}%`, height: `${highlight.height * 100}%` }} />}
          </div>
        </div>
        {area && <AreaControls region={area} change={setArea} disabled={working} />}
        {review.ocr && <div className="review-actions">
          {area ? <><button type="button" className="secondary-button" disabled={working} onClick={() => setArea(null)}>Desmarcar área</button>
            <button type="button" className="primary-button" disabled={working || area.width < .01 || area.height < .01} onClick={() => void recognizeArea()}>Refazer OCR da área</button></>
            : <button type="button" className="secondary-button" disabled={working} onClick={() => setArea(INITIAL_REGION)}><FileScan size={16} />Selecionar área para OCR</button>}
        </div>}
      </section>
      <section className="review-blocks" aria-label="Blocos da página">
        <div className="review-block-title"><h3>Ordem de leitura</h3><button type="button" className="text-button" disabled={working || !draft.manual} onClick={resetOrder}>Restaurar ordem automática</button></div>
        {review.ocr && <p className="review-hint">{review.ocr.reviewedAt ? 'Página revisada · ' : ''}Confiança do OCR inicial {review.ocr.confidence}%{review.ocr.confidence < 75 ? ' · confira o texto com atenção' : ''}</p>}
        {review.margins.length > 0 && <label className="review-margins"><input type="checkbox" disabled={working} checked={draft.includeMargins} onChange={event => setDraft({ ...draft, includeMargins: event.target.checked, manual: true })} />Incluir cabeçalhos e rodapés repetidos</label>}
        <ol className="review-list">
          {draft.paragraphs.map((block, index) => {
            const hidden = draft.hidden.includes(block.id);
            const margin = review.margins.includes(block.id);
            return <li key={block.id} className={block.id === active ? 'selected' : ''}>
              <button type="button" className="review-block-select" aria-pressed={block.id === active} disabled={working} onClick={() => setActive(block.id)}>
                <span>{block.text || 'Bloco vazio'}</span>
                {(hidden || margin) && <small>{hidden ? 'Ignorado' : 'Cabeçalho ou rodapé repetido'}</small>}
              </button>
              <div className="review-block-actions">
                <button type="button" className="icon-button" aria-label={`Subir bloco ${index + 1}`} disabled={working || index === 0} onClick={() => move(index, -1)}><ArrowUp size={15} /></button>
                <button type="button" className="icon-button" aria-label={`Descer bloco ${index + 1}`} disabled={working || index === draft.paragraphs.length - 1} onClick={() => move(index, 1)}><ArrowDown size={15} /></button>
                <button type="button" className="text-button" aria-label={`${hidden ? 'Incluir' : 'Ignorar'} bloco ${index + 1}`} disabled={working} onClick={() => toggleBlock(block.id)}>{hidden ? 'Incluir' : 'Ignorar'}</button>
              </div>
            </li>;
          })}
        </ol>
        {!draft.paragraphs.length && <p className="review-hint">{review.ocr ? 'Selecione uma área da página para reconhecer o texto.' : 'Reconheça a página antes de editar o texto.'}</p>}
        {review.ocr && selected && <label className="review-edit">Texto do bloco
          <textarea disabled={working} maxLength={100000} value={selected.text} onChange={event => edit(event.target.value)} />
        </label>}
      </section>
    </div>
    <div className="review-footer">
      <div>{error ? <p className="review-error" role="alert">{error}</p> : status && <p role="status">{status}</p>}</div>
      <button type="button" className="secondary-button" onClick={close}>Cancelar</button>
      <button type="button" className="primary-button" disabled={working || !visible.some(block => block.text.trim())} onClick={() => void save()}>Salvar revisão</button>
    </div>
  </div>;
}
