import { useEffect, useRef, type ReactNode } from 'react';
import { BookMarked, BookmarkPlus, Check, FileScan, Highlighter, LoaderCircle, Maximize, MessageSquareText, Minimize, Pencil, ScanLine, SlidersHorizontal, Trash2, Volume2, X } from 'lucide-react';
import type { MarkColor } from './types';
import type { ReadingTools } from './useReadingTools';
import { PageReview } from './PageReview';

const colors: { value: MarkColor; label: string }[] = [{ value: 'yellow', label: 'Amarelo' }, { value: 'green', label: 'Verde' }, { value: 'blue', label: 'Azul' }, { value: 'pink', label: 'Rosa' }];

export function Modal({ title, children, close }: { title: string; children: ReactNode; close(): void }) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    (root.current?.querySelector<HTMLElement>('textarea, input') || root.current?.querySelector<HTMLElement>('button'))?.focus();
    return () => previous?.focus();
  }, []);
  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}><div ref={root} className="modal tool-modal" role="dialog" aria-modal="true" aria-label={title} onKeyDown={event => {
    if (event.key === 'Escape') { event.stopPropagation(); close(); }
    if (event.key === 'Tab') {
      const focusable = root.current?.querySelectorAll<HTMLElement>('button:not(:disabled), textarea:not(:disabled), input:not(:disabled), select:not(:disabled), summary');
      if (!focusable?.length) return;
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  }}><div className="modal-heading"><h2>{title}</h2><button className="icon-button" aria-label="Fechar diálogo" onClick={close}><X size={18} /></button></div>{children}</div></div>;
}

export function ToolBar({ tools, disabled, openStudy }: { tools: ReadingTools; disabled: boolean; openStudy?(): void }) {
  return <div className="reading-tools" aria-label="Ferramentas de leitura">
    <button className={tools.speech.visible ? 'active' : ''} disabled={disabled} onClick={() => void tools.speech.toggle()}><Volume2 size={15} /><span>Ouvir</span></button>
    <button className={tools.panel === 'notes' ? 'active' : ''} disabled={disabled} onClick={() => tools.togglePanel('notes')}><Highlighter size={15} /><span>Anotações</span>{tools.notebook.annotations.length > 0 && <small>{tools.notebook.annotations.length}</small>}</button>
    <button className={tools.panel === 'bookmarks' ? 'active' : ''} disabled={disabled} onClick={() => tools.togglePanel('bookmarks')}><BookMarked size={15} /><span>Marcadores</span>{tools.notebook.bookmarks.length > 0 && <small>{tools.notebook.bookmarks.length}</small>}</button>
    <button className={tools.panel === 'comfort' ? 'active' : ''} disabled={disabled} onClick={() => tools.togglePanel('comfort')}><SlidersHorizontal size={15} /><span>Conforto</span></button>
    {!tools.isEpub && <button className={tools.panel === 'ocr' ? 'active' : ''} disabled={disabled} onClick={() => tools.togglePanel('ocr')}><FileScan size={15} /><span>Reconhecer texto</span></button>}
    {openStudy && <button disabled={disabled} onClick={openStudy}><BookMarked size={15} /><span>Estudo</span></button>}
    <button className="focus-button" aria-label="Ativar modo foco" title="Modo foco (F8)" disabled={disabled} onClick={() => { tools.setFocus(true); tools.setPanel(null); }}><Maximize size={15} /><span>Foco</span></button>
  </div>;
}

export function SelectionBar({ tools, consult, card }: { tools: ReadingTools; consult?(): void; card?(): void }) {
  if (!tools.selection) return null;
  return <div className="selection-bar" role="toolbar" aria-label="Ações do texto selecionado" onMouseDown={event => { if ((event.target as HTMLElement).closest('button')) event.preventDefault(); }}>
    <span>{tools.selection.quote.length} caracteres</span>
    <select aria-label="Cor do destaque" value={tools.markColor} onChange={event => tools.setMarkColor(event.target.value as MarkColor)}>{colors.map(color => <option key={color.value} value={color.value}>{color.label}</option>)}</select>
    <button disabled={tools.saving} onClick={() => void tools.saveHighlight()}><Highlighter size={15} />Destacar</button>
    <button disabled={tools.saving} onClick={tools.annotateSelection}><MessageSquareText size={15} />Anotar</button>
    {consult && <button onClick={consult}>Consultar</button>}
    {card && <button onClick={card}>Criar cartão</button>}
    <button className="icon-button" aria-label="Dispensar seleção" onClick={tools.clearSelection}><X size={15} /></button>
  </div>;
}

export function ToolPanel({ tools, page, mode, navigate, textMode }: { tools: ReadingTools; page: number; mode: string; navigate(page: number, location?: string): void; textMode(): void }) {
  if (!tools.panel) return null;
  const title = { notes: 'Destaques e anotações', bookmarks: 'Seus marcadores', comfort: 'Conforto de leitura', ocr: 'Reconhecer texto' }[tools.panel];
  const lowConfidence = tools.panel === 'ocr' ? Object.entries(tools.notebook.ocrPages).filter(([, result]) => !result.reviewedAt && result.confidence < 75) : [];
  return <aside className="tool-panel" aria-label={title}>
    <div className="tool-panel-heading"><h2>{title}</h2><button className="icon-button" aria-label="Fechar painel de leitura" onClick={() => tools.setPanel(null)}><X size={17} /></button></div>
    <div className="tool-panel-body">
      {tools.panel === 'notes' && <>
        <p className="panel-help">Selecione um trecho da leitura para destacar ou anotar. Seus registros ficam salvos neste livro.</p>
        <button className="panel-primary" onClick={tools.newNote}><Pencil size={15} />Nova anotação na {tools.isEpub ? 'seção' : 'página'} {page}</button>
        {!tools.notebook.annotations.length && <div className="tool-empty"><Highlighter size={27} /><p>Guarde aqui as ideias que merecem uma segunda leitura.</p></div>}
        {tools.notebook.annotations.map(annotation => <article className={`annotation-card ${annotation.color}`} key={annotation.id}>
          <button className="saved-item-page" onClick={() => navigate(annotation.page, annotation.location)}>{tools.unit} {annotation.page}</button>
          {annotation.quote && <blockquote>{annotation.quote}</blockquote>}
          {annotation.note && <p className="annotation-note">{annotation.note}</p>}
          <div className="saved-item-actions"><button onClick={() => tools.editNote(annotation)}><Pencil size={12} />Editar</button><button disabled={tools.saving} aria-label={`Excluir anotação da página ${annotation.page}`} onClick={() => void tools.removeNote(annotation.id)}><Trash2 size={12} />Excluir</button></div>
        </article>)}
      </>}
      {tools.panel === 'bookmarks' && <>
        <p className="panel-help">Guarde posições importantes com um nome. O ponto em que você parou continua sendo salvo automaticamente.</p>
        <button className="panel-primary" onClick={tools.newBookmark}><BookmarkPlus size={16} />Marcar {tools.isEpub ? 'trecho da seção' : 'página'} {page}</button>
        {!tools.notebook.bookmarks.length && <div className="tool-empty"><BookMarked size={27} /><p>Crie marcadores para revisar capítulos, exercícios ou passagens.</p></div>}
        {tools.notebook.bookmarks.map(bookmark => <article className="bookmark-card" key={bookmark.id}><button className="bookmark-jump" onClick={() => navigate(bookmark.page, bookmark.location)}><BookMarked size={17} /><span><strong>{bookmark.label}</strong><small>{tools.unit} {bookmark.page}</small></span></button><div className="saved-item-actions"><button onClick={() => tools.setBookmarkEditor({ ...bookmark })}><Pencil size={12} />Renomear</button><button disabled={tools.saving} aria-label={`Excluir marcador ${bookmark.label}`} onClick={() => void tools.removeBookmark(bookmark.id)}><Trash2 size={12} />Excluir</button></div></article>)}
      </>}
      {tools.panel === 'comfort' && <>
        <p className="panel-help">Ajuste o ambiente ao seu ritmo. As preferências ficam salvas.</p>
        {!tools.isEpub && mode !== 'text' && <button className="panel-primary" onClick={textMode}>Usar fonte ajustável no modo texto</button>}
        {tools.isEpub && <p className="setting-hint">A fonte do EPUB é ajustável em todos os modos. Os marcadores acompanham o texto quando a paginação muda.</p>}
        <label className="setting-label">Fonte de leitura<select aria-label="Fonte do texto" value={tools.comfort.font} onChange={event => tools.setComfort(previous => ({ ...previous, font: event.target.value as typeof previous.font }))}><option value="Georgia">Georgia · serifada</option><option value="Segoe UI">Segoe UI · sem serifa</option><option value="Arial">Arial · sem serifa</option></select></label>
        <label className="setting-label">Tamanho da fonte <strong>{tools.comfort.size}px</strong><input aria-label="Tamanho da fonte" type="range" min={16} max={40} step={1} value={tools.comfort.size} onChange={event => tools.setComfort(previous => ({ ...previous, size: Number(event.target.value) }))} /></label>
        <label className="setting-label">Espaçamento entre linhas<select aria-label="Espaçamento entre linhas" value={tools.comfort.lineHeight} onChange={event => tools.setComfort(previous => ({ ...previous, lineHeight: Number(event.target.value) }))}>{[1.4, 1.6, 1.8, 2, 2.2, 2.4].map(value => <option key={value} value={value}>{value.toLocaleString('pt-BR')}</option>)}</select></label>
        <label className="setting-label">Largura das linhas<select aria-label="Largura das linhas" value={tools.comfort.width} onChange={event => tools.setComfort(previous => ({ ...previous, width: Number(event.target.value) }))}><option value={45}>Estreita</option><option value={65}>Média</option><option value={85}>Larga</option></select></label>
        <div className="setting-label">Fundo da leitura<div className="paper-options">{([{ value: 'light', label: 'Claro' }, { value: 'sepia', label: 'Sépia' }, { value: 'dark', label: 'Escuro' }] as const).map(paper => <button key={paper.value} className={`paper-choice ${paper.value} ${tools.comfort.paper === paper.value ? 'chosen' : ''}`} aria-pressed={tools.comfort.paper === paper.value} onClick={() => tools.setComfort(previous => ({ ...previous, paper: paper.value }))}>{paper.label}</button>)}</div></div>
        <label className="ruler-toggle"><input type="checkbox" checked={tools.comfort.ruler} onChange={event => tools.setComfort(previous => ({ ...previous, ruler: event.target.checked }))} /><ScanLine size={17} /><span>Régua de leitura</span></label>
        <p className="setting-hint">Com a régua ativada, deixe o cursor sobre a linha que está lendo.</p>
        <button className="panel-primary" onClick={() => { tools.setFocus(true); tools.setPanel(null); }}><Maximize size={15} />Entrar no modo foco · F8</button>
      </>}
      {tools.panel === 'ocr' && <>
        <p className="panel-help">Transforme páginas digitalizadas em texto para selecionar, buscar, destacar e ouvir. O reconhecimento funciona neste computador, em português e inglês.</p>
        {tools.notebook.ocrPages[page]?.reviewedAt || tools.notebook.readingOrder?.[page]
          ? <button className="panel-primary" disabled={tools.ocrState.running} onClick={() => tools.setReviewPage(page)}><Pencil size={16} />Revisar página {page}</button>
          : <>
            <button className="panel-primary" disabled={tools.ocrState.running} onClick={() => void tools.recognize()}><FileScan size={16} />Reconhecer página {page}</button>
            <button className="panel-secondary" disabled={tools.ocrState.running} onClick={() => tools.setReviewPage(page)}>Revisar página {page}</button>
          </>}
        <button className="panel-secondary" disabled={tools.ocrState.running} onClick={() => void tools.recognize(true)}>Reconhecer documento inteiro</button>
        <p className="setting-hint">No documento inteiro, páginas que já têm texto ou já foram reconhecidas são preservadas.</p>
        {(tools.ocrState.running || tools.ocrState.message) && <div className="ocr-status" role="status">{tools.ocrState.running ? <LoaderCircle size={20} className="spinner" /> : <Check size={20} />}<strong>{tools.ocrState.running ? `Página ${tools.ocrState.page}` : 'Reconhecimento'}</strong><p>{tools.ocrState.message}</p>{tools.ocrState.running && <><progress max={tools.ocrState.total} value={tools.ocrState.completed + tools.ocrState.progress} /><span>{tools.ocrState.completed} de {tools.ocrState.total} páginas concluídas</span><button className="panel-secondary" onClick={() => void tools.cancelOcr()}>Cancelar reconhecimento</button></>}</div>}
        {Object.keys(tools.notebook.ocrPages).length > 0 && <p className="ocr-cache-info">{Object.keys(tools.notebook.ocrPages).length} páginas reconhecidas e salvas neste livro.</p>}
        {lowConfidence.length > 0 && <details className="review-low-confidence">
          <summary>{lowConfidence.length} {lowConfidence.length === 1 ? 'página com baixa confiança' : 'páginas com baixa confiança'}</summary>
          {lowConfidence.map(([number, result]) => <button key={number} className="text-button" disabled={tools.ocrState.running} onClick={() => { navigate(Number(number)); tools.setReviewPage(Number(number)); }}>Página {number} · {result.confidence}%</button>)}
        </details>}
        {Object.values(tools.notebook.ocrPages).some(page => page.words.length) &&
          <button className="panel-secondary" disabled={tools.ocrState.running || tools.pdfExport?.pending} onClick={() => void tools.exportSearchablePdf()}>
            {tools.pdfExport?.pending ? 'Preparando PDF…' : 'Salvar cópia pesquisável'}
          </button>}
        {tools.pdfExport?.message && <p className="setting-hint" role="status">{tools.pdfExport.message}</p>}
      </>}
    </div>
  </aside>;
}

export function ToolDialogs({ tools }: { tools: ReadingTools }) {
  return <>
    {tools.reviewPage !== null && <Modal title={`Revisar página ${tools.reviewPage}`} close={() => tools.setReviewPage(null)}><PageReview key={tools.reviewPage} page={tools.reviewPage} tools={tools} close={() => tools.setReviewPage(null)} /></Modal>}
    {tools.noteEditor && <Modal title={tools.noteEditor.id ? 'Editar anotação' : 'Anotar passagem'} close={() => tools.setNoteEditor(null)}><form onSubmit={event => { event.preventDefault(); void tools.saveNote(); }}>
      <p className="editor-page">{tools.unit} {tools.noteEditor.page}</p>{tools.noteEditor.quote && <blockquote className="editor-quote">{tools.noteEditor.quote}</blockquote>}
      <label htmlFor="annotation-note">Sua anotação</label><textarea id="annotation-note" value={tools.noteEditor.note} maxLength={10000} placeholder="O que você quer lembrar deste trecho?" onChange={event => tools.setNoteEditor(previous => previous ? { ...previous, note: event.target.value } : null)} />
      <div className="mark-color-options" aria-label="Cor da anotação">{colors.map(color => <button type="button" key={color.value} aria-label={color.label} aria-pressed={tools.noteEditor!.color === color.value} className={`color-dot ${color.value} ${tools.noteEditor!.color === color.value ? 'chosen' : ''}`} onClick={() => tools.setNoteEditor(previous => previous ? { ...previous, color: color.value } : null)} />)}</div>
      <div className="modal-actions"><button type="button" className="secondary-button" onClick={() => tools.setNoteEditor(null)}>Cancelar</button><button className="primary-button" disabled={tools.saving || !tools.noteEditor.note.trim() && !tools.noteEditor.quote.trim()}>Salvar anotação</button></div>
    </form></Modal>}
    {tools.bookmarkEditor && <Modal title={tools.bookmarkEditor.id ? 'Renomear marcador' : 'Criar marcador'} close={() => tools.setBookmarkEditor(null)}><form onSubmit={event => { event.preventDefault(); void tools.saveBookmark(); }}><p className="editor-page">{tools.unit} {tools.bookmarkEditor.page}{tools.isEpub ? ' · posição exata do trecho' : ''}</p><label htmlFor="bookmark-label">Nome do marcador</label><input id="bookmark-label" value={tools.bookmarkEditor.label} maxLength={160} required onChange={event => tools.setBookmarkEditor(previous => previous ? { ...previous, label: event.target.value } : null)} /><div className="modal-actions"><button type="button" className="secondary-button" onClick={() => tools.setBookmarkEditor(null)}>Cancelar</button><button className="primary-button" disabled={tools.saving || !tools.bookmarkEditor.label.trim()}>Salvar marcador</button></div></form></Modal>}
  </>;
}

export function ExitFocus({ tools }: { tools: ReadingTools }) {
  return tools.focus ? <button className="exit-focus" onClick={() => tools.setFocus(false)}><Minimize size={15} />Sair do foco <kbd>F8</kbd></button> : null;
}
