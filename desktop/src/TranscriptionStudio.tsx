import { useEffect, useMemo, useRef, useState } from 'react';
import { AudioLines, Bookmark, Download, FileAudio, FilePlus2, LayoutGrid, Moon, Pencil, Play, RotateCcw, Search, Sun, Trash2 } from 'lucide-react';
import { audioTime } from './audio-time';
import type { Theme } from './Hub';
import type { LessonSource, TranscriptionFormat, TranscriptionLanguage, TranscriptionMark, TranscriptionMarkInput, TranscriptionProgress, TranscriptionProject, TranscriptionQuality, TranscriptionSummary } from './types';
import { MarkEditor, ReviewMarks } from './TranscriptionMarks';
import { LessonCardEditor, LessonCards } from './LessonCards';
import { LessonCourse, LessonMaterial, LessonSearch } from './LessonTools';
import { LessonRange } from './LessonRange';
import { lessonSourceEvent, openLessonSource } from './lesson-navigation';
import './transcription.css';

const studioName = 'Estúdio de Transcrição';
const emptySegments: TranscriptionProject['segments'] = [];
const titleOf = (name: string) => name.replace(/\.[^.]+$/, '') || name;
const searchable = (text: string) => text.toLocaleLowerCase('pt-BR').normalize('NFD').replace(/\p{M}/gu, '');
const errorMessage = (error: unknown) => error instanceof Error
  ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
  : 'Não foi possível concluir esta operação.';
type StudioDialog = { kind: 'course' | 'search' | 'cards' } | { kind: 'range'; first: number } | { kind: 'card'; mark: TranscriptionMark };

export function StudioMark() {
  return <span className="studio-mark" aria-hidden="true"><AudioLines size={26} strokeWidth={1.7} /></span>;
}

export function TranscriptionStudio({ visible, activate, onOpenHub, theme, toggleTheme }: {
  visible: boolean; activate(): void; onOpenHub(): void; theme: Theme; toggleTheme(): void;
}) {
  const api = window.lume;
  const audio = useRef<HTMLAudioElement>(null);
  const main = useRef<HTMLElement>(null);
  const runningProject = useRef<string | null>(null);
  const playbackEnd = useRef<number | null>(null);
  const [catalog, setCatalog] = useState<TranscriptionSummary[]>([]);
  const [courseFilter, setCourseFilter] = useState('');
  const [dialog, setDialog] = useState<StudioDialog | null>(null);
  const [source, setSource] = useState<LessonSource | null>(null);
  const [cue, setCue] = useState<LessonSource | null>(null);
  const [project, setProject] = useState<TranscriptionProject | null>(null);
  const [language, setLanguage] = useState<TranscriptionLanguage>('pt');
  const [quality, setQuality] = useState<TranscriptionQuality>('accurate');
  const [revisionForm, setRevisionForm] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [query, setQuery] = useState('');
  const [edit, setEdit] = useState<{ index: number; text: string } | null>(null);
  const [view, setView] = useState<'transcript' | 'review' | 'material'>('transcript');
  const [markDraft, setMarkDraft] = useState<{ id: string | null; value: TranscriptionMarkInput } | null>(null);
  const [busy, setBusy] = useState('');
  const [progress, setProgress] = useState<TranscriptionProgress | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const projectId = project?.id;

  useEffect(() => {
    if (!api) return;
    let mounted = true;
    api.transcriptionList().then(items => { if (mounted) setCatalog(items); })
      .catch(error => { if (mounted) setError(errorMessage(error)); });
    const unsubscribe = api.onTranscriptionProgress(update => {
      if (update.id === runningProject.current) setProgress(update);
    });
    return () => { mounted = false; unsubscribe(); };
  }, [api]);

  useEffect(() => {
    if (visible) document.title = studioName;
    else audio.current?.pause();
  }, [visible]);

  useEffect(() => { main.current?.scrollTo(0, 0); }, [projectId]);

  useEffect(() => {
    const receive = (event: Event) => { activate(); setSource((event as CustomEvent<LessonSource>).detail); };
    window.addEventListener(lessonSourceEvent, receive);
    return () => window.removeEventListener(lessonSourceEvent, receive);
  }, [activate]);

  useEffect(() => {
    if (!visible || !source || busy || dialog || edit || markDraft) return;
    setSource(null);
    void perform('Abrindo trecho…', async () => {
      if (projectId !== source.projectId) select(await api.transcriptionOpen(source.projectId));
      setView('transcript');
      setCue(source);
    });
  }, [visible, source, busy, dialog, edit, markDraft, projectId]);

  useEffect(() => {
    const player = audio.current;
    if (!visible || !cue || cue.projectId !== projectId || !player) return;
    const seek = () => {
      playAt(cue.startMs);
      player.focus();
      setCue(null);
    };
    if (player.readyState >= 1) seek();
    else player.addEventListener('loadedmetadata', seek, { once: true });
    return () => player.removeEventListener('loadedmetadata', seek);
  }, [visible, cue, projectId]);

  async function perform(label: string, action: () => Promise<void>) {
    if (busy) return;
    setBusy(label);
    setError('');
    setStatus('');
    try { await action(); }
    catch (error) { setError(errorMessage(error)); }
    finally { setBusy(''); }
  }

  function select(next: TranscriptionProject | null) {
    audio.current?.pause();
    playbackEnd.current = null;
    setProject(next);
    setEdit(null);
    setView('transcript');
    setMarkDraft(null);
    setQuery('');
    setActiveIndex(-1);
    setLanguage(next?.language === 'en' || next?.language === 'es' ? next.language : 'pt');
    setRevisionForm(false);
  }

  function importAudio() {
    void perform('Importando gravação…', async () => {
      const next = await api.transcriptionImport();
      if (!next) return;
      select(next);
      setCatalog(items => [next, ...items]);
      setStatus('Gravação importada.');
    });
  }

  function openProject(id: string) {
    if (id === project?.id) return;
    void perform('Abrindo gravação…', async () => select(await api.transcriptionOpen(id)));
  }

  function transcribe() {
    if (!project) return;
    const { id } = project;
    void perform('Transcrevendo…', async () => {
      runningProject.current = id;
      setProgress({ id, phase: 'preparing', percent: 0 });
      try {
        const result = await api.transcriptionStart(id, language, quality);
        if (result) {
          if (result.id !== id) {
            select(result);
            setCatalog(items => [result, ...items]);
            setStatus('Nova versão salva. A anterior continua em Gravações.');
          } else {
            setProject(result);
            setCatalog(items => items.map(item => item.id === id ? { ...item, segmentCount: result.segmentCount } : item));
            setStatus('Transcrição concluída.');
          }
        } else setStatus('Transcrição cancelada.');
      } finally {
        runningProject.current = null;
        setCancelling(false);
        setProgress(null);
      }
    });
  }

  async function cancel() {
    if (!project || !progress) return;
    setCancelling(true);
    try { await api.transcriptionCancel(project.id); }
    catch (error) { setCancelling(false); setError(errorMessage(error)); }
  }

  function saveEdit() {
    if (!project || !edit) return;
    void perform('Salvando trecho…', async () => {
      setProject(await api.transcriptionEdit(project.id, edit.index, edit.text));
      setEdit(null);
      setStatus('Trecho salvo.');
      requestAnimationFrame(() => document.getElementById(`studio-edit-${edit.index}`)?.focus());
    });
  }

  function updateProject(next: TranscriptionProject) {
    setProject(next);
    setCatalog(items => items.map(item => item.id === next.id ? { ...item, course: next.course, segmentCount: next.segmentCount } : item));
  }

  function editMark(mark: TranscriptionMark) {
    setMarkDraft({ id: mark.id, value: { category: mark.category, note: mark.note } });
  }

  function changeMark(value: TranscriptionMarkInput) {
    setMarkDraft(draft => draft ? { ...draft, value } : null);
  }

  function closeMark() {
    const control = markDraft?.id ? `studio-note-${markDraft.id}` : `studio-mark-${markDraft?.value.segmentIndex}`;
    setMarkDraft(null);
    requestAnimationFrame(() => document.getElementById(control)?.focus());
  }

  function saveMark() {
    if (!project || !markDraft) return;
    void perform('Salvando marcação…', async () => {
      setProject(await api.transcriptionSaveMark(project.id, markDraft.id, markDraft.value));
      closeMark();
      setStatus('Marcação salva.');
    });
  }

  function removeMark(id: string) {
    if (!project) return;
    void perform('Excluindo marcação…', async () => {
      setProject(await api.transcriptionRemoveMark(project.id, id));
      setStatus('Marcação excluída.');
      requestAnimationFrame(() => document.getElementById('studio-review-toggle')?.focus());
    });
  }

  function exportText(format: TranscriptionFormat) {
    if (!project) return;
    void perform('Exportando arquivo…', async () => {
      if (await api.transcriptionExport(project.id, format)) setStatus(format === 'srt' ? 'Legendas exportadas.' : 'Texto exportado.');
    });
  }

  function removeProject() {
    if (!project) return;
    void perform('Excluindo projeto…', async () => {
      audio.current?.pause();
      const items = await api.transcriptionRemove(project.id);
      if (!items) return;
      select(null);
      setCatalog(items);
      if (courseFilter && !items.some(item => item.course === courseFilter)) setCourseFilter('');
      setStatus('Projeto excluído.');
    });
  }

  function playAt(ms: number, endMs?: number, rate = 1) {
    const player = audio.current;
    if (!player) return;
    playbackEnd.current = endMs ?? null;
    player.playbackRate = rate;
    player.currentTime = ms / 1000;
    syncPosition(player.currentTime);
    void player.play().catch((error: unknown) => {
      if (!(error instanceof DOMException && ['AbortError', 'NotAllowedError'].includes(error.name))) setError('Não foi possível reproduzir a gravação.');
    });
  }

  const editing = edit !== null || markDraft !== null;
  const review = view === 'review';
  const courses = useMemo(() => [...new Set(catalog.map(item => item.course).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR')), [catalog]);
  const recordings = courseFilter ? catalog.filter(item => item.course === courseFilter) : catalog;
  const duration = project?.duration ?? 0;
  const segments = project?.segments ?? emptySegments;
  const marks = project?.marks ?? [];
  const markedTimes = useMemo(() => new Set(project?.marks.map(mark => mark.startMs)), [project?.marks]);
  const results = useMemo(() => {
    const terms = searchable(query.trim()).split(/\s+/).filter(Boolean);
    return segments.map((segment, index) => ({ ...segment, index })).filter(segment => {
      if (!terms.length) return true;
      const content = searchable(segment.text);
      return terms.every(term => content.includes(term));
    });
  }, [segments, query]);
  const canExport = useMemo(() => segments.some(segment => segment.text.trim()), [segments]);

  function syncPosition(seconds: number) {
    const ms = seconds * 1000;
    if (playbackEnd.current !== null && ms >= playbackEnd.current) {
      playbackEnd.current = null;
      audio.current?.pause();
    }
    setActiveIndex(segments.findIndex(segment => ms >= segment.startMs && ms < segment.endMs));
  }

  return <div className="studio">
    <header className="studio-header" inert={!!dialog}>
      <button className="hub-return" type="button" onClick={onOpenHub}><LayoutGrid size={15} aria-hidden="true" />Aplicativos</button>
      <span className="studio-header-title"><AudioLines size={21} aria-hidden="true" />{studioName}</span>
      <button className="icon-button studio-theme" type="button" onClick={toggleTheme} aria-label={theme === 'light' ? 'Ativar tema escuro' : 'Ativar tema claro'}>
        {theme === 'light' ? <Moon size={19} /> : <Sun size={19} />}
      </button>
    </header>

    <div className="studio-layout" inert={!!dialog}>
      <aside className="studio-library" aria-label="Projetos de transcrição">
        <button type="button" className="studio-button studio-primary" disabled={!!busy || editing || !api} onClick={importAudio}><FilePlus2 size={17} aria-hidden="true" />Importar gravação</button>
        <div className="lesson-library-tools">
          <button type="button" className="studio-button" disabled={!!busy || editing || !api} onClick={() => setDialog({ kind: 'search' })}><Search size={15} aria-hidden="true" />Buscar nas aulas</button>
          <button type="button" className="studio-button" disabled={!!busy || editing || !api} onClick={() => setDialog({ kind: 'cards' })}>Cartões de aulas</button>
        </div>
        <h2>Gravações</h2>
        {!!courses.length && <label className="lesson-course-filter">Filtrar por disciplina<select value={courseFilter} onChange={event => setCourseFilter(event.target.value)}>
          <option value="">Todas as disciplinas</option>{courses.map(name => <option key={name}>{name}</option>)}
        </select></label>}
        {recordings.length ? <ul className="studio-projects">
          {recordings.map(item => <li key={item.id}>
            <button type="button" className="studio-project" aria-current={item.id === projectId ? 'true' : undefined} disabled={!!busy || editing} onClick={() => openProject(item.id)}>
              <FileAudio size={19} aria-hidden="true" />
              <span><strong title={item.name}>{titleOf(item.name)}</strong><small>{[item.course, audioTime(item.duration), item.segmentCount ? 'Transcrita' : 'A transcrever'].filter(Boolean).join(' · ')}</small></span>
            </button>
          </li>)}
        </ul> : <p>{courseFilter ? 'Nenhuma gravação nesta disciplina.' : 'As gravações importadas aparecem aqui.'}</p>}
      </aside>

      <main className="studio-main" ref={main}>
        <div className="studio-content">
          {(error || !api) && <div className="studio-alert" role="alert">{error || 'Abra o Estúdio pelo aplicativo desktop do Lume.'}</div>}
          <div className="studio-status" role="status">{status || (progress ? '' : busy)}</div>
          {!project ? <section className="studio-welcome" aria-labelledby="studio-title">
            <StudioMark />
            <h1 id="studio-title">{studioName}</h1>
            <p>Importe uma aula, palestra ou entrevista. Transforme a gravação em texto e volte a qualquer trecho do áudio.</p>
            <button type="button" className="studio-button studio-primary" disabled={!!busy || !api} onClick={importAudio}><FilePlus2 size={17} aria-hidden="true" />Escolher gravação</button>
            <small>MP3, WAV, FLAC, M4A ou MP4 · Até 2 horas · Processamento local</small>
          </section> : <>
            <div className="studio-project-header">
              <div><h1>{titleOf(project.name)}</h1><p>{[project.name, audioTime(duration), project.course].filter(Boolean).join(' · ')}</p></div>
              <div className="studio-row-actions">
                <button type="button" className="studio-button" disabled={!!busy || editing} onClick={() => setDialog({ kind: 'course' })}>Disciplina e glossário</button>
                <button type="button" className="icon-button studio-delete" aria-label="Excluir projeto" title="Excluir projeto" disabled={!!busy || editing} onClick={removeProject}><Trash2 size={17} /></button>
              </div>
            </div>

            <section className="studio-playback" aria-label="Reprodução da gravação">
              <FileAudio size={21} aria-hidden="true" />
              <audio key={project.id} src={project.audioUrl} ref={audio} controls preload="metadata" aria-label="Áudio da gravação"
                onTimeUpdate={event => syncPosition(event.currentTarget.currentTime)} onSeeked={event => syncPosition(event.currentTarget.currentTime)}
                onError={() => setError('A cópia da gravação está indisponível ou não pôde ser reproduzida.')} />
            </section>

            {(!segments.length || revisionForm) && <section className="studio-start" aria-labelledby="studio-start-title">
              <h2 id="studio-start-title">{segments.length ? 'Gerar nova versão' : 'Transcrever gravação'}</h2>
              <p>{segments.length ? 'A nova transcrição aparecerá em Gravações, com as marcações desta aula.' : 'O tempo de processamento depende da duração do áudio e da velocidade do computador.'}</p>
              {progress ? <div className="studio-progress">
                <span role="status">{cancelling ? 'Cancelando…' : progress.phase === 'preparing' ? 'Preparando o modelo…' : `Transcrevendo… ${progress.percent}%`}</span>
                <progress aria-label="Progresso da transcrição" max={100} value={progress.phase === 'preparing' ? undefined : progress.percent} />
                <button type="button" className="studio-button" onClick={() => void cancel()} disabled={cancelling}>Cancelar transcrição</button>
              </div> : <div className="studio-start-actions">
                <label>Idioma do áudio<select value={language} onChange={event => setLanguage(event.target.value as TranscriptionLanguage)} disabled={!!busy}>
                  <option value="pt">Português</option><option value="auto">Detectar automaticamente</option><option value="en">Inglês</option><option value="es">Espanhol</option>
                </select></label>
                <label>Qualidade<select value={quality} onChange={event => setQuality(event.target.value as TranscriptionQuality)} disabled={!!busy}>
                  <option value="accurate">Maior precisão</option><option value="fast">Mais rápido</option>
                </select></label>
                <button type="button" className="studio-button studio-primary" disabled={!!busy || editing} onClick={transcribe}><AudioLines size={17} aria-hidden="true" />{segments.length ? 'Transcrever novamente' : 'Iniciar transcrição'}</button>
                {!!segments.length && <button type="button" className="studio-button" disabled={!!busy} onClick={() => setRevisionForm(false)}>Fechar</button>}
              </div>}
            </section>}
            {!!segments.length && <section className="studio-transcript" aria-labelledby="studio-transcript-title">
              <header className="studio-transcript-header">
                <h2 id="studio-transcript-title">{view === 'material' ? 'Material de estudo' : review ? 'Caderno da Aula' : 'Transcrição'}</h2>
                <div className="studio-exports">
                  {!revisionForm && <button type="button" className="studio-button" disabled={!!busy || editing} onClick={() => setRevisionForm(true)}><AudioLines size={15} aria-hidden="true" />Gerar nova versão</button>}
                  <button type="button" className="studio-button" disabled={!!busy || editing || !canExport} onClick={() => exportText('txt')}><Download size={15} aria-hidden="true" />Exportar TXT</button>
                  <button type="button" className="studio-button" disabled={!!busy || editing || !canExport} onClick={() => exportText('srt')}><Download size={15} aria-hidden="true" />Exportar SRT</button>
                </div>
              </header>
              <div className="studio-view-options" role="group" aria-label="Visualização da aula">
                <button type="button" className="studio-button" aria-pressed={view === 'transcript'} disabled={editing} onClick={() => setView('transcript')}>Transcrição</button>
                <button type="button" className="studio-button" id="studio-review-toggle" aria-pressed={review} disabled={editing} onClick={() => setView('review')}><Bookmark size={15} aria-hidden="true" />Para revisar ({marks.length})</button>
                <button type="button" className="studio-button" aria-pressed={view === 'material'} disabled={editing} onClick={() => setView('material')}>Resumo e perguntas</button>
              </div>
              {view === 'material' ? <LessonMaterial project={project} play={playAt} /> : review ? <ReviewMarks marks={marks} draft={markDraft} busy={!!busy} change={changeMark} save={saveMark} cancel={closeMark} edit={editMark} remove={removeMark} play={playAt} card={mark => setDialog({ kind: 'card', mark })} /> : <>
              <div className="studio-search">
                <label><Search size={17} aria-hidden="true" /><input type="search" aria-label="Buscar na transcrição" placeholder="Buscar na transcrição" value={query} onChange={event => setQuery(event.target.value)} disabled={editing} /></label>
                <span aria-live="polite">{results.length} {results.length === 1 ? 'trecho' : 'trechos'}{query.trim() ? ` de ${segments.length}` : ''}</span>
              </div>
              {results.length ? <ol className="studio-segments">
                {results.map(({ index, startMs, text }) => <li key={index} className={index === activeIndex ? 'studio-segment studio-segment-active' : 'studio-segment'}>
                  <button type="button" className="studio-time" aria-current={index === activeIndex ? 'true' : undefined} aria-label={`Reproduzir trecho ${index + 1} em ${audioTime(startMs / 1000)}`} onClick={() => playAt(startMs)}><Play size={13} aria-hidden="true" />{audioTime(startMs / 1000)}</button>
                  {edit?.index === index ? <div className="studio-edit">
                    <textarea autoFocus aria-label={`Texto do trecho ${index + 1}`} rows={3} maxLength={5000} value={edit.text} disabled={!!busy} onChange={event => setEdit({ index, text: event.target.value })} />
                    <div>
                      <button type="button" className="studio-button" disabled={!!busy} onClick={() => { setEdit(null); requestAnimationFrame(() => document.getElementById(`studio-edit-${index}`)?.focus()); }}>Cancelar edição</button>
                      <button type="button" className="studio-button studio-primary" disabled={!!busy} onClick={saveEdit}>Salvar trecho</button>
                    </div>
                  </div> : <>
                    <div className="studio-segment-body">
                      <p>{text || <em>Trecho sem texto</em>}</p>
                      {markDraft && markDraft.id === null && markDraft.value.segmentIndex === index && <MarkEditor value={markDraft.value} busy={!!busy} change={changeMark} save={saveMark} cancel={closeMark} />}
                    </div>
                    <div className="studio-row-actions">
                      <button type="button" className="icon-button" aria-label={`Corrigir intervalo a partir do trecho ${index + 1}`} title="Retranscrever intervalo" disabled={!!busy || editing} onClick={() => setDialog({ kind: 'range', first: index })}><RotateCcw size={16} /></button>
                      <button type="button" id={`studio-mark-${index}`} className="icon-button studio-edit-button" aria-label={`Marcar trecho ${index + 1}`} title={markedTimes.has(startMs) ? 'Adicionar outra marcação' : 'Marcar trecho'} disabled={!!busy || editing} onClick={() => setMarkDraft({ id: null, value: { segmentIndex: index, category: 'important', note: '' } })}><Bookmark size={16} fill={markedTimes.has(startMs) ? 'currentColor' : 'none'} /></button>
                      <button type="button" id={`studio-edit-${index}`} className="icon-button studio-edit-button" aria-label={`Editar trecho ${index + 1}`} title="Editar trecho" disabled={!!busy || editing} onClick={() => setEdit({ index, text })}><Pencil size={16} /></button>
                    </div>
                  </>}
                </li>)}
              </ol> : <p className="studio-no-results">Nenhum trecho corresponde à busca.</p>}
              </>}
            </section>}
          </>}
        </div>
      </main>
    </div>
    {dialog?.kind === 'cards' && <LessonCards close={() => setDialog(null)} />}
    {dialog?.kind === 'search' && <LessonSearch courses={courses} defaultCourse={courseFilter} close={() => setDialog(null)} open={openLessonSource} />}
    {dialog?.kind === 'course' && project && <LessonCourse project={project} courses={courses} close={() => setDialog(null)} update={next => {
      updateProject(next);
      if (courseFilter) setCourseFilter(next.course);
    }} />}
    {dialog?.kind === 'card' && project && <LessonCardEditor projectId={project.id} mark={dialog.mark} close={() => setDialog(null)} saved={() => {
      setDialog(null);
      setStatus('Cartão salvo em Cartões de aulas.');
    }} />}
    {dialog?.kind === 'range' && project && <LessonRange project={project} first={dialog.first} language={language} quality={quality} close={() => setDialog(null)}
      saved={next => { updateProject(next); setDialog(null); setStatus('Correção aplicada ao intervalo.'); }} play={playAt} pause={() => audio.current?.pause()} />}
  </div>;
}
