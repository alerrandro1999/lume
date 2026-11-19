import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, BookOpen, Clock3, Download, Languages, Layers, Scissors, Volume2 } from 'lucide-react';
import DOMPurify from 'dompurify';
import { Modal } from './ReadingTools';
import { duration, type StudyTools, type StudyTab } from './useStudy';
import type { Crop, LibraryEntry, StudySettings } from './types';
import type { ReadingTools } from './useReadingTools';
import type { ReadingPoint, useReadingHistory } from './useReadingHistory';
import { audioTime } from './audio-time';

const tabs = [{ id: 'rhythm', label: 'Ritmo', icon: Clock3 }, { id: 'lookup', label: 'Consultar', icon: Languages }, { id: 'glossary', label: 'Glossário', icon: BookOpen }, { id: 'cards', label: 'Cartões', icon: Layers }, { id: 'export', label: 'Anotações', icon: Download }, { id: 'audio', label: 'Audiobook', icon: Volume2 }, { id: 'crop', label: 'Margens', icon: Scissors }] as const;
const languages = [['pt', 'Português'], ['en', 'Inglês'], ['es', 'Espanhol'], ['fr', 'Francês'], ['de', 'Alemão'], ['it', 'Italiano']];
function cleanDefinition(html: string) {
  const safe = DOMPurify.sanitize(html, { ALLOWED_TAGS: ['p', 'ol', 'ul', 'li', 'b', 'strong', 'em', 'i', 'h2', 'h3', 'h4', 'span', 'br', 'dl', 'dt', 'dd', 'sup', 'sub', 'div'], ALLOWED_ATTR: ['class', 'id'] });
  const doc = new DOMParser().parseFromString(safe, 'text/html');
  for (const element of doc.querySelectorAll('.mw-editsection, .noprint, .toc, .navbox, .metadata, .mw-empty-elt')) element.remove();
  return DOMPurify.sanitize(doc.body.innerHTML, { ALLOWED_TAGS: ['p', 'ol', 'ul', 'li', 'b', 'strong', 'em', 'i', 'h2', 'h3', 'h4', 'span', 'br', 'dl', 'dt', 'dd', 'sup', 'sub'], ALLOWED_ATTR: [] });
}
export function StudyStrip({ study, history, disabled }: { study: StudyTools; history: ReturnType<typeof useReadingHistory>; disabled: boolean }) {
  return <div className="study-strip">
    <div className="history-controls"><button aria-label="Voltar ao trecho anterior" title="Voltar ao trecho anterior (Alt + ←)" disabled={disabled || !history.previous} onClick={history.back}><ArrowLeft size={14} /></button><button aria-label="Avançar no histórico" title="Avançar no histórico (Alt + →)" disabled={disabled || !history.next} onClick={history.forward}><ArrowRight size={14} /></button></div>
    <button className="reading-estimate" onClick={() => study.open('rhythm')}><Clock3 size={13} />{!study.index.complete ? 'Calculando tempo de leitura…' : study.totals.totalWords ? `≈ ${duration(study.totals.remaining / study.wpm)} para terminar${study.index.missing ? ' · texto disponível' : ''}` : 'Sem texto para estimar'}</button>
    {study.data && <button className="daily-goal" onClick={() => study.open('rhythm')}>{Math.floor(study.data.todaySeconds / 60)} / {study.data.settings.goal} min hoje</button>}
  </div>;
}
export function ReadingReminders({ study }: { study: StudyTools }) {
  if (!study.breakDue && !study.breakEnd && !study.goalReached) return null;
  return <div className="reading-reminders" role="status">
    {study.goalReached && <span>Meta diária alcançada. <button onClick={study.dismissGoal}>Fechar meta</button></span>}
    {study.breakDue && <span>Que tal descansar os olhos? <button onClick={study.startBreak}>Iniciar pausa de {study.data?.settings.breakDuration} min</button><button onClick={study.postponeBreak}>Daqui a 5 min</button><button onClick={study.dismissBreak}>Dispensar pausa</button></span>}
    {!!study.breakEnd && <span>{study.breakRemaining ? `Pausa: ${Math.floor(study.breakRemaining / 60)}:${String(study.breakRemaining % 60).padStart(2, '0')}` : 'Pausa concluída. Pode retomar sua leitura.'}<button onClick={study.dismissBreak}>{study.breakRemaining ? 'Encerrar pausa' : 'Retomar leitura'}</button></span>}
  </div>;
}
export function StudyPanel({ study, entry, page, tools, navigate, onOcr, onPlayExport }: { study: StudyTools; entry: LibraryEntry | null; page: number; tools: ReadingTools; navigate(point: ReadingPoint): void; onOcr(): void; onPlayExport(directory: string): void }) {
  const [settings, setSettings] = useState<StudySettings | null>(null);
  const [crop, setCrop] = useState<Crop>({ top: 0, bottom: 0, left: 0, right: 0 });
  const [kind, setKind] = useState<'dictionary' | 'translate'>('dictionary'), [from, setFrom] = useState('en'), [to, setTo] = useState('pt');
  const [scope, setScope] = useState<'current' | 'book'>('current'), [voice, setVoice] = useState('');
  const [reviewing, setReviewing] = useState(false), [revealed, setRevealed] = useState(false);
  const cards = study.data?.book.cards || [];
  const due = cards.filter(card => card.due <= Date.now()).sort((a, b) => a.due - b.due), review = due[0];
  useEffect(() => { setRevealed(false); }, [review?.id, reviewing]);
  useEffect(() => {
    if (study.tab === 'rhythm') setSettings(previous => previous || study.data?.settings || null);
    else setSettings(null);
  }, [entry?.id, study.tab, study.data?.settings]);
  useEffect(() => { if (study.data?.book.crop) setCrop(study.data.book.crop); }, [study.data?.book.crop]);
  useEffect(() => { if (tools.speech.voices.length && !tools.speech.voices.some(item => item.name === voice)) setVoice(tools.speech.voices.find(item => item.language === 'pt-BR')?.name || tools.speech.voices[0].name); }, [tools.speech.voices, voice]);
  const definition = useMemo(() => study.lookupResult?.html ? cleanDefinition(study.lookupResult.html) : '', [study.lookupResult]);
  const translation = useMemo(() => new DOMParser().parseFromString(DOMPurify.sanitize(study.lookupResult?.text || '', { ALLOWED_TAGS: [], ALLOWED_ATTR: [] }), 'text/html').body.textContent, [study.lookupResult]);
  const definitionText = useMemo(() => {
    if (!definition) return '';
    const document = new DOMParser().parseFromString(definition, 'text/html');
    return [...document.querySelectorAll('p, li, dd')].map(node => node.textContent?.trim()).filter(Boolean).join('\n') || document.body.textContent || '';
  }, [definition]);
  const unit = entry?.format === 'epub' ? 'Seção' : 'Página';
  if (!study.tab || !entry) return null;
  return <Modal title="Estudo e leitura" close={() => study.setTab(null)}><div className="study-content">
    <div className="study-tabs" role="tablist" aria-label="Recursos de estudo">{tabs.filter(tab => entry.format !== 'epub' || tab.id !== 'crop').map(tab => <button key={tab.id} role="tab" aria-selected={study.tab === tab.id} onClick={() => { study.setTab(tab.id as StudyTab); study.setError(''); }}><tab.icon size={16} />{tab.label}</button>)}</div>
    <div className="study-body" role="tabpanel" aria-label={tabs.find(tab => tab.id === study.tab)?.label}>
    {study.error && <p className="study-error" role="alert">{study.error}</p>}
    {study.message && <p className="study-success" role="status">{study.message}</p>}
    {study.tab === 'rhythm' && <>
      <h3>Um ritmo que cabe no seu dia</h3>
      <div className="reading-metrics"><div><strong>{study.index.complete && study.totals.totalWords ? duration(study.totals.remaining / study.wpm) : '—'}</strong><span>para terminar o livro{study.index.missing ? ' · texto disponível' : ''}</span></div><div><strong>{study.index.complete && study.totals.current ? duration(study.totals.sectionRemaining / study.wpm) : '—'}</strong><span>{study.totals.sectionLabel}</span></div><div><strong>{Math.floor((study.data?.todaySeconds || 0) / 60)} min</strong><span>lidos hoje</span></div></div>
      <p className="study-help">{study.calibrated ? `Estimativa pelo seu ritmo: ${study.wpm} palavras por minuto.` : `Estimativa inicial: ${study.wpm} palavras por minuto. O ritmo pessoal aparece após três amostras de leitura.`} O tempo conta com a janela ativa e pausa após dois minutos sem interação, durante a pausa e neste painel. Saltos e narração não calibram seu ritmo.</p>
      {!!study.index.missing && <p className="study-help">{study.index.missing} {entry.format === 'epub' ? 'seções' : 'páginas'} sem texto extraível. A estimativa considera apenas o texto disponível.{entry.format !== 'epub' && <button className="inline-action" onClick={onOcr}>Reconhecer texto</button>}</p>}
      {settings && <form className="study-form" onSubmit={event => { event.preventDefault(); void study.saveSettings(settings); }}>
        <div className="study-form-row"><label>Meta diária (minutos)<input aria-label="Meta diária em minutos" type="number" min={1} max={480} value={settings.goal} onChange={event => setSettings({ ...settings, goal: Number(event.target.value) })} required /></label><label>Ritmo inicial (palavras/min)<input aria-label="Ritmo inicial" type="number" min={50} max={1000} value={settings.wpm} onChange={event => setSettings({ ...settings, wpm: Number(event.target.value) })} required /></label></div>
        <label className="study-check"><input type="checkbox" checked={settings.autoPace} onChange={event => setSettings({ ...settings, autoPace: event.target.checked })} />Ajustar estimativas ao meu ritmo de leitura</label>
        <label className="study-check"><input type="checkbox" checked={settings.reminders} onChange={event => setSettings({ ...settings, reminders: event.target.checked })} />Lembrar de fazer pausas</label>
        <div className="study-form-row"><label>Lembrar a cada (minutos)<input aria-label="Intervalo entre pausas" type="number" min={5} max={180} value={settings.breakEvery} onChange={event => setSettings({ ...settings, breakEvery: Number(event.target.value) })} /></label><label>Duração da pausa (minutos)<input aria-label="Duração da pausa" type="number" min={1} max={30} value={settings.breakDuration} onChange={event => setSettings({ ...settings, breakDuration: Number(event.target.value) })} /></label></div>
        <button className="primary-button" disabled={study.busy} type="submit">Salvar preferências de leitura</button>
      </form>}
      {study.data && <>
        <h4>Sessões deste livro</h4>
        <div className="reading-metrics">
          <div><strong>{audioTime(study.data.book.seconds)}</strong><span>tempo de leitura</span></div>
          <div><strong>{audioTime(study.data.book.listeningSeconds)}</strong><span>tempo de escuta</span></div>
        </div>
        {study.data.book.sessions.length ? <ul className="book-sessions">
          {study.data.book.sessions.slice(0, 20).map(session => <li key={session.id}>
            <span>{session.kind === 'reading' ? 'Leitura' : 'Escuta'} · {new Date(session.startedAt).toLocaleString('pt-BR')}</span>
            <strong>{audioTime(session.seconds)}</strong>
          </li>)}
        </ul> : <p className="study-help">As sessões aparecem aqui depois que você lê ou ouve o livro.</p>}
      </>}
    </>}
    {study.tab === 'lookup' && <>
      <h3>Uma palavra, novos caminhos</h3><p className="study-help">A consulta usa internet. Somente o texto abaixo é enviado quando você clicar em Consultar: ao Wikcionário para significado ou ao MyMemory para tradução.</p>
      <form className="study-form" onSubmit={event => { event.preventDefault(); void study.consult(kind, from, to); }}>
        <label>Tipo de consulta<select aria-label="Tipo de consulta" value={kind} onChange={event => setKind(event.target.value as typeof kind)}><option value="dictionary">Dicionário em português · Wikcionário</option><option value="translate">Tradução · MyMemory</option></select></label>
        <label>Palavra ou trecho<textarea aria-label="Texto para consulta" value={study.lookupText} maxLength={1000} onChange={event => study.setLookupText(event.target.value)} placeholder="Selecione uma palavra no livro ou digite aqui." required /></label>
        {kind === 'translate' && <div className="study-form-row"><label>De<select aria-label="Idioma de origem" value={from} onChange={event => setFrom(event.target.value)}>{languages.map(([code, name]) => <option key={code} value={code}>{name}</option>)}</select></label><label>Para<select aria-label="Idioma de destino" value={to} onChange={event => setTo(event.target.value)}>{languages.map(([code, name]) => <option key={code} value={code}>{name}</option>)}</select></label></div>}
        <p className="study-help">{kind === 'translate' ? `${new TextEncoder().encode(study.lookupText).length} / 500 bytes. A tradução automática está sujeita aos limites diários do serviço.` : 'Selecione uma palavra ou expressão de até cinco palavras.'}</p>
        <button className="primary-button" disabled={study.busy || !study.lookupText.trim() || kind === 'translate' && (from === to || new TextEncoder().encode(study.lookupText).length > 500)}>{study.busy ? 'Consultando…' : 'Consultar'}</button>
      </form>
      {study.lookupResult && <article className="lookup-result">{definition ? <div className="dictionary-definition" dangerouslySetInnerHTML={{ __html: definition }} /> : <p>{translation}</p>}
        <div className="study-actions">
          <button className="inline-action" onClick={() => void window.lume.openLookupSource(study.lookupResult!.url)}>{study.lookupResult.source} · abrir fonte</button>
          <button className="secondary-button" disabled={study.busy || !(definitionText || translation).trim()} onClick={() => void study.saveLookup(definitionText || translation)}>Salvar no glossário</button>
        </div>
      </article>}
    </>}
    {study.tab === 'glossary' && <>
      {!study.data?.book.glossary.length && <p className="study-help">Use a aba Consultar para salvar um significado ou tradução neste livro.</p>}
      {study.data?.book.glossary.map(item => <article className="flashcard-card" key={item.id}>
        <h4>{item.term}</h4><p className="glossary-meaning">{item.meaning}</p>
        {item.quote && item.quote !== item.term && <blockquote>{item.quote}</blockquote>}
        <small>{unit} {item.page} · {item.source}{item.source === 'Wikcionário' ? ' · CC BY-SA' : ''}</small>
        <div className="study-actions">
          <button onClick={() => { study.setTab(null); navigate({ page: item.page, location: item.location }); }}>Ir ao trecho</button>
          <button onClick={() => study.glossaryCard(item)}>Criar cartão</button>
          <button disabled={study.busy} onClick={() => void study.update(id => window.lume.saveGlossary(id, item.id))}>Excluir do glossário</button>
        </div>
      </article>)}
    </>}
    {study.tab === 'cards' && <>
      <h3>Relembre o que merece ficar</h3><p className="study-help">Crie cartões a partir de trechos ou anotações. Depois de revelar a resposta, escolha a dificuldade para agendar a próxima revisão.</p>
      {!study.editor && <div className="study-actions"><button className="primary-button" onClick={() => void study.newCard().catch(error => study.setError(String(error)))}>Novo cartão</button><button className="secondary-button" disabled={!due.length} onClick={() => setReviewing(value => !value)}>{reviewing ? 'Voltar aos cartões' : `Revisar ${due.length} pendente${due.length === 1 ? '' : 's'}`}</button></div>}
      {study.editor && <form className="study-form card-editor" onSubmit={event => { event.preventDefault(); void study.saveCard(); }}><label>Pergunta<textarea aria-label="Pergunta do cartão" value={study.editor.front} maxLength={2000} onChange={event => study.setEditor(previous => previous ? { ...previous, front: event.target.value } : null)} required /></label><label>Resposta<textarea aria-label="Resposta do cartão" value={study.editor.back} maxLength={12000} onChange={event => study.setEditor(previous => previous ? { ...previous, back: event.target.value } : null)} required /></label><small>{unit} {study.editor.page} · vínculo com o trecho original</small><div className="study-actions"><button className="primary-button" disabled={study.busy}>Salvar cartão</button><button type="button" className="secondary-button" onClick={() => study.setEditor(null)}>Cancelar cartão</button></div></form>}
      {reviewing && !study.editor ? review ? <article className="flashcard-review"><small>{due.length} revisões pendentes · {unit} {review.page}</small><h4>{review.front}</h4>{revealed ? <><p className="card-answer">{review.back}</p><div className="review-grades">{([{ id: 'again', label: 'Repetir · 1 min' }, { id: 'hard', label: 'Difícil' }, { id: 'good', label: 'Bom' }, { id: 'easy', label: 'Fácil' }] as const).map(grade => <button key={grade.id} disabled={study.busy} onClick={() => void study.update(id => window.lume.reviewCard(id, review.id, grade.id))}>{grade.label}</button>)}</div></> : <button className="primary-button" onClick={() => setRevealed(true)}>Mostrar resposta</button>}</article> : <p className="study-help">Revisões em dia. Os cartões reaparecem na data agendada.</p> : !study.editor && cards.map(card => <article className="flashcard-card" key={card.id}><h4>{card.front}</h4><p>{card.back}</p><small>{unit} {card.page} · Próxima revisão: {new Date(card.due).toLocaleString('pt-BR')}</small><div className="study-actions"><button onClick={() => { study.setTab(null); navigate({ page: card.page, location: card.location }); }}>Ir ao trecho</button><button onClick={() => study.setEditor({ ...card })}>Editar cartão</button><button disabled={study.busy} onClick={() => void study.update(id => window.lume.removeCard(id, card.id))}>Excluir cartão</button></div></article>)}
      {!cards.length && !study.editor && <p className="study-help">Selecione uma passagem e clique em Criar cartão, ou transforme uma anotação em cartão abaixo.</p>}
      {!study.editor && !reviewing && tools.notebook.annotations.length > 0 && <><h4>Dos seus destaques</h4>{tools.notebook.annotations.map(note => <article className="annotation-to-card" key={note.id}><p>{note.quote || note.note}</p><button className="inline-action" onClick={() => void study.newCard(note, note.quote || note.note).catch(error => study.setError(String(error)))}>Criar cartão deste destaque</button></article>)}</>}
    </>}
    {study.tab === 'export' && <>
      <h3>Suas ideias, prontas para levar</h3><p className="study-help">Exporte {tools.notebook.annotations.length} anotações e {tools.notebook.bookmarks.length} marcadores com o nome do livro, a página ou seção e a localização dos trechos do EPUB.</p>
      <div className="study-actions"><button className="primary-button" disabled={study.busy || !tools.notebook.annotations.length && !tools.notebook.bookmarks.length} onClick={() => void study.exportAnnotations('md')}>Exportar Markdown</button><button className="secondary-button" disabled={study.busy || !tools.notebook.annotations.length && !tools.notebook.bookmarks.length} onClick={() => void study.exportAnnotations('pdf')}>Exportar PDF</button></div>
      {!tools.notebook.annotations.length && !tools.notebook.bookmarks.length && <p className="study-help">Crie um destaque, uma anotação ou um marcador para exportar.</p>}
    </>}
    {study.tab === 'audio' && <>
      <h3>Leve a leitura em voz alta com você</h3><p className="study-help">A voz do Windows gera arquivos WAV locais e uma playlist M3U. EPUBs são divididos por seção; PDFs usam os capítulos do sumário, quando disponíveis, ou um arquivo por página. Arquivos WAV podem ocupar bastante espaço.</p>
      <div className="study-form"><label>Conteúdo<select aria-label="Conteúdo do audiobook" value={scope} disabled={study.audio.running || study.audioPreparing} onChange={event => setScope(event.target.value as typeof scope)}><option value="current">{unit} atual ({page})</option><option value="book">Livro inteiro</option></select></label><label>Voz do audiobook<select aria-label="Voz do audiobook" disabled={study.audio.running || study.audioPreparing} value={voice} onChange={event => setVoice(event.target.value)}>{tools.speech.voices.map(voice => <option key={voice.name} value={voice.name}>{voice.name} ({voice.language})</option>)}</select></label>
      {study.index.complete && <p className="study-help">{scope === 'current' ? `${study.index.counts[page - 1] || 0} palavras nesta ${unit.toLocaleLowerCase('pt-BR')}.` : `${study.totals.totalWords.toLocaleString('pt-BR')} palavras disponíveis. ${study.index.missing} ${entry.format === 'epub' ? 'seções' : 'páginas'} sem texto não serão narradas.`}{entry.format !== 'epub' && (scope === 'current' ? !study.index.counts[page - 1] : study.index.missing > 0) && <button className="inline-action" onClick={onOcr}>Reconhecer texto antes de exportar</button>}</p>}
      {!tools.speech.voices.length && <p className="study-help">Instale uma voz de fala nas configurações do Windows para gerar áudio.</p>}
      {study.audio.running || study.audioPreparing ? <div className="audio-export-progress" role="status"><strong>{study.audioPreparing ? 'Preparando texto…' : study.audio.chapter}</strong><progress max={study.audio.total || 1} value={study.audio.done} /><small>{study.audio.done} de {study.audio.total} trechos gerados</small><button className="secondary-button" onClick={study.cancelAudio}>Cancelar exportação de áudio</button><p className="study-help">Você pode fechar este painel e continuar lendo. Os arquivos aparecem na pasta escolhida quando a exportação terminar.</p></div> : <button className="primary-button" disabled={!voice || !study.index.complete || (scope === 'current' ? !study.index.counts[page - 1] : !study.totals.totalWords)} onClick={() => void study.exportAudio(scope, voice)}>Gerar audiobook WAV</button>}
      </div>
      <button className="secondary-button" disabled={study.busy} onClick={() => void study.linkAudiobook()}>Vincular audiobook já gerado</button>
      {study.audioExports.map(item => <article key={item.directory} className="flashcard-card">
        <h4>{item.title}</h4>
        <small>{item.chapters} {item.chapters === 1 ? 'faixa' : 'faixas'} · {new Date(item.createdAt).toLocaleString('pt-BR')}</small>
        <div className="study-actions">
          <button className="secondary-button" onClick={() => onPlayExport(item.directory)}>Abrir audiobook no player</button>
          <button className="inline-action" onClick={() => void window.lume.showExport(item.directory)}>Mostrar na pasta</button>
        </div>
      </article>)}
    </>}
    {study.tab === 'crop' && <>
      <h3>Mais espaço para o conteúdo</h3><p className="study-help">Recorte visualmente as margens deste PDF. O ajuste vale para todas as páginas deste livro; o arquivo original e as posições das anotações são preservados. Confira páginas com ilustrações ou layouts diferentes.</p>
      <button className="secondary-button" disabled={study.busy} onClick={() => void study.autoCrop()}>Detectar margens da página atual</button>
      <form className="study-form crop-controls" onSubmit={event => { event.preventDefault(); void study.update(id => window.lume.saveCrop(id, crop)); }}>{([{ key: 'top', label: 'Superior' }, { key: 'bottom', label: 'Inferior' }, { key: 'left', label: 'Esquerda' }, { key: 'right', label: 'Direita' }] as const).map(margin => <label key={margin.key}>{margin.label} · {Math.round(crop[margin.key] * 100)}%<input aria-label={`Margem ${margin.label.toLocaleLowerCase('pt-BR')}`} type="range" min={0} max={30} step={1} value={Math.round(crop[margin.key] * 100)} onChange={event => setCrop({ ...crop, [margin.key]: Number(event.target.value) / 100 })} /></label>)}<div className="study-actions"><button className="primary-button" disabled={study.busy}>Aplicar recorte</button><button className="secondary-button" type="button" disabled={study.busy} onClick={() => void study.update(id => window.lume.saveCrop(id, { top: 0, bottom: 0, left: 0, right: 0 }))}>Restaurar margens</button></div></form>
    </>}
    {!!study.exportPath && (study.tab === 'export' || study.tab === 'audio') && <div className="export-result"><span>{study.exportPath}</span><button className="inline-action" onClick={() => void window.lume.showExport(study.exportPath)}>Mostrar na pasta</button></div>}
    </div>
  </div></Modal>;
}
