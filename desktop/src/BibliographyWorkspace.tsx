import { useEffect, useRef, useState } from 'react';
import { plannerMaterialEvent, type PlannerMaterial } from './planner-types';
import { ArrowLeft, ArrowRight, FilePlus2, LayoutGrid, LibraryBig, Moon, Plus, Search, Sun } from 'lucide-react';
import { Modal } from './ReadingTools';
import { BibliographyFlowView, bibliographyDraft, bibliographyStageLabels, ReferenceReview } from './BibliographyReview';
import { bibliographyStages, type BibliographyDecision, type BibliographyExport, type BibliographyFilter, type BibliographyImportReport, type BibliographyOrigin, type BibliographyPage, type BibliographyProject, type BibliographyRecord, type BibliographySettings, type BibliographySummary } from './bibliography-types';
import type { Theme } from './Hub';
import './bibliography.css';

const title = 'Bancada de Revisão Bibliográfica';
const initialFilter: BibliographyFilter = { query: '', stage: '', page: 0 };
const errorText = (error: unknown) => error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : 'Não foi possível concluir esta operação.';
type Dialog = 'create' | 'settings' | 'import';

export function BibliographyMark() {
  return <span className="bib-mark" aria-hidden="true"><LibraryBig size={26} strokeWidth={1.6} /></span>;
}

function ProjectForm({ project, busy, error, submit }: { project: BibliographyProject | null; busy: boolean; error: string; submit(value: BibliographySettings): void }) {
  const [form, setForm] = useState<BibliographySettings>(project || { title: '', question: '', includeCriteria: '', excludeCriteria: '' });
  const edit = (key: keyof BibliographySettings, value: string) => setForm({ ...form, [key]: value });
  return <form className="bib-form" onSubmit={event => { event.preventDefault(); if (form.title.trim()) submit(form); }}>
    <label>Nome da revisão<input autoFocus maxLength={140} required disabled={busy} value={form.title} onChange={event => edit('title', event.target.value)} /></label>
    {project && <>
      <label>Pergunta da revisão<textarea rows={2} maxLength={1200} disabled={busy} value={form.question} onChange={event => edit('question', event.target.value)} /></label>
      <label>Critérios de inclusão<textarea rows={3} maxLength={4000} disabled={busy} value={form.includeCriteria} onChange={event => edit('includeCriteria', event.target.value)} /></label>
      <label>Critérios de exclusão<textarea rows={3} maxLength={4000} disabled={busy} value={form.excludeCriteria} onChange={event => edit('excludeCriteria', event.target.value)} /></label>
    </>}
    {error && <p className="bib-error" role="alert">{error}</p>}
    <button type="submit" className="bib-button bib-primary" disabled={busy || !form.title.trim()}>{busy ? 'Salvando…' : project ? 'Salvar critérios' : 'Criar revisão'}</button>
  </form>;
}

function ImportForm({ busy, error, submit }: { busy: boolean; error: string; submit(value: BibliographyOrigin): void }) {
  const [origin, setOrigin] = useState<BibliographyOrigin>({ source: '', kind: 'database' });
  return <form className="bib-form" onSubmit={event => { event.preventDefault(); submit(origin); }}>
    <label>Nome da fonte (opcional)<input placeholder="Ex.: PubMed" maxLength={120} value={origin.source} disabled={busy} onChange={event => setOrigin({ ...origin, source: event.target.value })} /></label>
    <label>Tipo de fonte<select value={origin.kind} disabled={busy} onChange={event => setOrigin({ ...origin, kind: event.target.value as BibliographyOrigin['kind'] })}>
      <option value="database">Base de dados</option><option value="register">Registro de estudos</option>
    </select></label>
    <p className="bib-help">Selecione arquivos RIS, BibTeX ou CSV. O CSV precisa de uma coluna Título ou Title.</p>
    {error && <p className="bib-error" role="alert">{error}</p>}
    <button type="submit" className="bib-button bib-primary" disabled={busy}>{busy ? 'Importando…' : 'Selecionar arquivos'}</button>
  </form>;
}

function ImportResult({ report, close }: { report: BibliographyImportReport; close(): void }) {
  const counted = (count: number, singular: string, plural: string) => `${count} ${count === 1 ? singular : plural}`;
  const summary = [counted(report.added, 'nova', 'novas'), counted(report.duplicates, 'duplicata', 'duplicatas'), `${report.invalid} sem título`];
  if (report.repeated.length) summary.push(counted(report.repeated.length, 'arquivo já importado', 'arquivos já importados'));
  if (report.errors.length) summary.push(counted(report.errors.length, 'arquivo com erro', 'arquivos com erro'));
  return <div className="bib-import-result">
    <div className="bib-section-heading"><p role="status">{summary.join(' · ')}</p>
      <button type="button" className="bib-button" onClick={close}>Dispensar resultado</button></div>
    {!!report.duplicateExamples.length && <details><summary>Ver exemplos de duplicatas</summary><ul>{report.duplicateExamples.map((name, index) => <li key={index}>{name}</li>)}</ul></details>}
    {!!report.repeated.length && <details><summary>Arquivos já importados</summary><ul>{report.repeated.map((name, index) => <li key={index}>{name}</li>)}</ul></details>}
    {!!report.errors.length && <details open><summary>Arquivos que não puderam ser importados</summary><ul>{report.errors.map(({ file, detail }, index) => <li key={index}>{file} · {detail}</li>)}</ul></details>}
  </div>;
}

export function BibliographyWorkspace({ visible, activate, onOpenHub, theme, toggleTheme }: { visible: boolean; activate(): void; onOpenHub(): void; theme: Theme; toggleTheme(): void }) {
  const api = window.lume?.bibliography;
  const initialized = useRef(false);
  const main = useRef<HTMLElement>(null);
  const [projects, setProjects] = useState<BibliographySummary[]>([]);
  const [project, setProject] = useState<BibliographyProject | null>(null);
  const [record, setRecord] = useState<BibliographyRecord | null>(null);
  const [draft, setDraft] = useState<BibliographyDecision | null>(null);
  const [filter, setFilter] = useState(initialFilter);
  const [results, setResults] = useState<BibliographyPage | null>(null);
  const [view, setView] = useState<'screen' | 'flow'>('screen');
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [importReport, setImportReport] = useState<BibliographyImportReport | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const dirty = !!draft && !!record && JSON.stringify(draft) !== JSON.stringify(bibliographyDraft(record));
  const projectId = project?.id;

  useEffect(() => {
    const receive = (event: Event) => {
      const material = (event as CustomEvent<PlannerMaterial>).detail;
      if (material.kind !== 'review' || !api) return;
      activate();
      if (dirty) { setError('Salve ou descarte a decisão em edição antes de abrir outra revisão.'); return; }
      if (busy) return;
      initialized.current = true;
      void perform('Abrindo revisão…', async () => {
        const items = await api.list();
        setProjects(items);
        selectProject(await api.open(material.id));
        if (material.recordId) selectRecord(await api.reference(material.id, material.recordId));
      });
    };
    window.addEventListener(plannerMaterialEvent, receive);
    return () => window.removeEventListener(plannerMaterialEvent, receive);
  });

  useEffect(() => {
    if (!visible) return;
    document.title = title;
    if (initialized.current || !api) return;
    initialized.current = true;
    setBusy('Carregando revisões…');
    api.list().then(async items => {
      setProjects(items);
      if (items[0]) selectProject(await api.open(items[0].id));
    }).catch(error => setError(errorText(error))).finally(() => setBusy(''));
  }, [api, visible]);

  useEffect(() => {
    if (!api || !projectId) return;
    let current = true;
    const timer = window.setTimeout(() => {
      api.references(projectId, filter).then(page => { if (current) setResults(page); })
        .catch(error => { if (current) setError(errorText(error)); });
    }, filter.query ? 140 : 0);
    return () => { current = false; window.clearTimeout(timer); };
  }, [api, projectId, project, filter]);

  async function perform(message: string, action: () => Promise<void>) {
    if (busy) return;
    setBusy(message);
    setError('');
    setStatus('');
    try { await action(); }
    catch (error) { setError(errorText(error)); }
    finally { setBusy(''); }
  }

  function selectRecord(next: BibliographyRecord | null) {
    setRecord(next);
    setDraft(next ? bibliographyDraft(next) : null);
  }

  function selectProject(next: BibliographyProject) {
    setProject(next);
    setFilter(initialFilter);
    setResults(null);
    selectRecord(null);
    setView('screen');
    setImportReport(null);
    main.current?.scrollTo(0, 0);
  }

  function updateProject(next: BibliographyProject) {
    setProject(next);
    setProjects(items => [next, ...items.filter(item => item.id !== next.id)]);
  }

  function showDialog(next: Dialog) { setError(''); setDialog(next); }
  function closeDialog() { if (!busy) { setError(''); setDialog(null); } }

  function saveProject(value: BibliographySettings) {
    if (!api) return;
    void perform('Salvando revisão…', async () => {
      const next = dialog === 'settings' && project ? await api.configure(project.id, value) : await api.create(value.title);
      if (dialog === 'create') selectProject(next);
      updateProject(next);
      setDialog(null);
      setStatus(dialog === 'settings' ? 'Critérios salvos.' : 'Revisão criada.');
    });
  }

  function importReferences(origin: BibliographyOrigin) {
    if (!api || !project) return;
    void perform('Importando referências…', async () => {
      const result = await api.importReferences(project.id, origin);
      if (!result) return;
      updateProject(result.project);
      setImportReport(result.report);
      setDialog(null);
      setView('screen');
      if (result.report.added) setFilter(initialFilter);
      if (record) selectRecord(await api.reference(project.id, record.id));
    });
  }

  function selectFilter(next: BibliographyFilter) {
    setFilter(next);
    setResults(null);
    selectRecord(null);
  }

  function saveDecision(advance: boolean) {
    if (!api || !project || !record || !draft) return;
    void perform('Salvando decisão…', async () => {
      const result = await api.update(project.id, record.id, draft);
      updateProject(result.project);
      selectRecord(result.record);
      setStatus('Decisão salva.');
      if (!advance) return;
      const page = await api.references(project.id, filter);
      const before = results?.rows.findIndex(item => item.id === record.id) ?? -1;
      const now = page.rows.findIndex(item => item.id === record.id);
      const target = page.rows[now < 0 ? Math.max(before, 0) : now + 1];
      if (target) { selectRecord(await api.reference(project.id, target.id)); return; }
      const nextPage = page.page + 1;
      if (nextPage * page.pageSize < page.total) {
        const next = await api.references(project.id, { ...filter, page: nextPage });
        setFilter({ ...filter, page: next.page });
        setResults(next);
        selectRecord(next.rows[0] ? await api.reference(project.id, next.rows[0].id) : null);
      } else selectRecord(null);
    });
  }

  function exportData(format: BibliographyExport) {
    if (!api || !project) return;
    void perform('Exportando CSV…', async () => {
      if (await api.export(project.id, format)) setStatus(format === 'evidence' ? 'Tabela de evidências exportada.' : 'Contagens PRISMA exportadas.');
    });
  }

  const locked = !!busy || dirty;
  return <div className="bib-workspace">
    <header className="bib-header" inert={!!dialog}>
      <button type="button" className="hub-return" onClick={onOpenHub} disabled={!!busy}><LayoutGrid size={15} aria-hidden="true" />Aplicativos</button>
      <span><LibraryBig size={19} aria-hidden="true" />{title}</span>
      <button type="button" className="icon-button bib-theme" onClick={toggleTheme} aria-label={theme === 'light' ? 'Ativar tema escuro' : 'Ativar tema claro'}>
        {theme === 'light' ? <Moon size={19} /> : <Sun size={19} />}
      </button>
    </header>
    <div className="bib-layout" inert={!!dialog}>
      <aside className="bib-sidebar" aria-label="Revisões bibliográficas">
        <button type="button" className="bib-button bib-primary" disabled={locked || !api} onClick={() => showDialog('create')}><Plus size={17} aria-hidden="true" />Nova revisão</button>
        <h2>Minhas revisões</h2>
        {projects.length ? <ul>{projects.map(item => <li key={item.id}>
          <button type="button" className="bib-project" aria-current={projectId === item.id ? 'true' : undefined} disabled={locked || !api} onClick={() => {
            if (api && projectId !== item.id) void perform('Abrindo revisão…', async () => selectProject(await api.open(item.id)));
          }}><strong>{item.title}</strong><small>{item.recordCount} {item.recordCount === 1 ? 'referência' : 'referências'}</small></button>
        </li>)}</ul> : <p className="bib-help">Os projetos criados aparecem aqui.</p>}
      </aside>
      <main className="bib-main" ref={main}>
        {(error || !api) && !dialog && <p className="bib-error" role="alert">{error || 'Abra a Bancada pelo aplicativo desktop do Lume.'}</p>}
        {(status || busy) && !dialog && <p className="bib-status" role="status">{busy || status}</p>}
        {!project ? <section className="bib-welcome" aria-labelledby="bib-title">
          <BibliographyMark /><h1 id="bib-title">{title}</h1>
          <p>Reúna as referências de uma pesquisa, registre a seleção dos estudos e organize as evidências em um projeto.</p>
          <button type="button" className="bib-button bib-primary" disabled={locked || !api} onClick={() => showDialog('create')}><Plus size={17} aria-hidden="true" />Criar primeira revisão</button>
        </section> : <>
          <div className="bib-section-heading bib-project-heading">
            <div><h1>{project.title}</h1>{project.question && <p>{project.question}</p>}</div>
            <div className="bib-actions">
              <button type="button" className="bib-button" disabled={locked} onClick={() => showDialog('settings')}>Critérios da revisão</button>
              <button type="button" className="bib-button bib-primary" disabled={locked} onClick={() => showDialog('import')}><FilePlus2 size={16} aria-hidden="true" />Importar referências</button>
            </div>
          </div>
          {(project.includeCriteria || project.excludeCriteria) && <details className="bib-criteria"><summary>Consultar critérios</summary>
            {project.includeCriteria && <p><strong>Inclusão</strong> {project.includeCriteria}</p>}
            {project.excludeCriteria && <p><strong>Exclusão</strong> {project.excludeCriteria}</p>}
          </details>}
          {importReport && <ImportResult report={importReport} close={() => setImportReport(null)} />}
          <div className="bib-tabs" role="group" aria-label="Áreas da revisão">
            <button type="button" className="bib-button" aria-pressed={view === 'screen'} disabled={locked} onClick={() => setView('screen')}>Referências e triagem</button>
            <button type="button" className="bib-button" aria-pressed={view === 'flow'} disabled={locked} onClick={() => setView('flow')}>Fluxo PRISMA e exportações</button>
          </div>
          {view === 'flow' ? <BibliographyFlowView project={project} busy={!!busy} exportData={exportData} /> : <>
            <div className="bib-metrics" aria-label="Andamento da triagem">
              <div><strong>{project.recordCount}</strong><span>Referências únicas</span></div>
              <div><strong>{project.flow.counts.pending}</strong><span>Aguardando triagem</span></div>
              <div><strong>{project.flow.counts.awaiting_text + project.flow.counts.awaiting_assessment}</strong><span>Texto completo pendente</span></div>
              <div><strong>{project.flow.articlesIncluded}</strong><span>Relatórios incluídos</span></div>
            </div>
            {!project.recordCount ? <p className="bib-empty">Importe um arquivo RIS, BibTeX ou CSV para começar a triagem.</p> : <>
              <div className="bib-filters">
                <label><Search size={16} aria-hidden="true" /><input type="search" aria-label="Buscar nas referências" placeholder="Título, autor, DOI ou resumo" disabled={locked} value={filter.query} maxLength={250} onChange={event => selectFilter({ ...filter, query: event.target.value, page: 0 })} /></label>
                <label>Filtrar por etapa<select disabled={locked} value={filter.stage} onChange={event => selectFilter({ ...filter, stage: event.target.value as BibliographyFilter['stage'], page: 0 })}>
                  <option value="">Todas as etapas</option>{bibliographyStages.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                </select></label>
              </div>
              <div className="bib-screen-grid">
                <section className="bib-reference-list" aria-label="Resultados da busca">
                  <p className="bib-list-count" role="status">{results ? `${results.total} ${results.total === 1 ? 'referência encontrada' : 'referências encontradas'}` : 'Carregando…'}</p>
                  {!!results?.rows.length && <ul>{results.rows.map(item => <li key={item.id}>
                    <button type="button" className="bib-record" aria-current={record?.id === item.id ? 'true' : undefined} disabled={locked} onClick={() => {
                      if (api && item.id !== record?.id) void perform('Abrindo referência…', async () => selectRecord(await api.reference(project.id, item.id)));
                    }}><strong>{item.title}</strong><small>{[item.authors, item.year].filter(Boolean).join(' · ')}</small><span>{bibliographyStageLabels[item.status]}</span></button>
                  </li>)}</ul>}
                  {results && results.total > results.pageSize && <div className="bib-pagination">
                    <button type="button" className="bib-button" aria-label="Página anterior" disabled={locked || results.page === 0} onClick={() => selectFilter({ ...filter, page: results.page - 1 })}><ArrowLeft size={15} /></button>
                    <span>{results.page + 1} / {Math.ceil(results.total / results.pageSize)}</span>
                    <button type="button" className="bib-button" aria-label="Próxima página" disabled={locked || (results.page + 1) * results.pageSize >= results.total} onClick={() => selectFilter({ ...filter, page: results.page + 1 })}><ArrowRight size={15} /></button>
                  </div>}
                </section>
                {record && draft ? <ReferenceReview record={record} value={draft} busy={!!busy} dirty={dirty} change={setDraft} save={saveDecision} discard={() => setDraft(bibliographyDraft(record))}
                  openSource={() => { if (api) void perform('Abrindo fonte…', async () => api.openSource(project.id, record.id)); }} />
                  : <section className="bib-empty" aria-label="Seleção de referência">Selecione uma referência para ler o resumo e registrar a decisão.</section>}
              </div>
            </>}
          </>}
        </>}
      </main>
    </div>
    {(dialog === 'create' || dialog === 'settings') && <Modal title={dialog === 'create' ? 'Nova revisão bibliográfica' : 'Critérios da revisão'} close={closeDialog}>
      <ProjectForm project={dialog === 'settings' ? project : null} busy={!!busy} error={error} submit={saveProject} />
    </Modal>}
    {dialog === 'import' && <Modal title="Importar referências" close={closeDialog}><ImportForm busy={!!busy} error={error} submit={importReferences} /></Modal>}
  </div>;
}
