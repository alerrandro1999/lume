import { ExternalLink } from 'lucide-react';
import { bibliographyStages, type BibliographyDecision, type BibliographyExport, type BibliographyProject, type BibliographyRecord, type BibliographyStage, type EvidenceRecord } from './bibliography-types';

export const bibliographyStageLabels = Object.fromEntries(bibliographyStages) as Record<BibliographyStage, string>;
const reasons = ['População fora dos critérios', 'Delineamento inelegível', 'Intervenção ou exposição diferente', 'Desfecho fora dos critérios', 'Não responde à pergunta da revisão', 'Publicação fora do período'];
const evidenceFields: [Exclude<keyof EvidenceRecord, 'studyKey'>, string][] = [
  ['design', 'Delineamento'], ['population', 'População ou amostra'], ['intervention', 'Intervenção ou exposição'], ['comparison', 'Comparador'],
  ['outcomes', 'Desfechos'], ['results', 'Resultados'], ['limitations', 'Limitações'],
];

export function bibliographyDraft(record: BibliographyRecord): BibliographyDecision {
  return { status: record.status, reason: record.reason, notes: record.notes, evidence: { ...record.evidence } };
}

export function ReferenceReview({ record, value, busy, dirty, change, save, discard, openSource }: {
  record: BibliographyRecord; value: BibliographyDecision; busy: boolean; dirty: boolean;
  change(value: BibliographyDecision): void; save(advance: boolean): void; discard(): void; openSource(): void;
}) {
  const excluded = value.status === 'screen_excluded' || value.status === 'full_excluded';
  const reasonVisible = excluded || value.status === 'not_retrieved';
  const canSave = !busy && (!excluded || !!value.reason.trim());
  return <article className="bib-inspector" aria-label="Referência selecionada">
    <div className="bib-reference-header">
      <h2>{record.title}</h2>
      <p>{[record.authors, record.year, record.journal].filter(Boolean).join(' · ') || 'Metadados de autoria e publicação indisponíveis'}</p>
      <div className="bib-reference-source">
        <span>{record.source}{record.doi ? ` · DOI ${record.doi}` : ''}</span>
        {(record.doi || record.url) && <button type="button" className="bib-button" onClick={openSource} disabled={busy}>Abrir fonte <ExternalLink size={13} aria-hidden="true" /></button>}
      </div>
    </div>
    <section className="bib-abstract" aria-labelledby="bib-abstract-title">
      <h3 id="bib-abstract-title">Resumo</h3>
      <p>{record.abstract || 'A importação desta referência veio sem resumo.'}</p>
    </section>
    <form className="bib-form" onSubmit={event => { event.preventDefault(); if (canSave && dirty) save(false); }}>
      <h3>Decisão de triagem</h3>
      <label>Etapa da referência<select value={value.status} disabled={busy} onChange={event => {
        const status = event.target.value as BibliographyStage;
        change({ ...value, status, reason: status === record.status ? record.reason : '' });
      }}>
        {bibliographyStages.map(([stage, label]) => <option key={stage} value={stage}>{label}</option>)}
      </select></label>
      {reasonVisible && <label>{excluded ? 'Motivo da exclusão' : 'Motivo da não recuperação (opcional)'}
        <input list="bib-reasons" maxLength={300} required={excluded} value={value.reason} disabled={busy} onChange={event => change({ ...value, reason: event.target.value })} />
      </label>}
      <datalist id="bib-reasons">{reasons.map(reason => <option key={reason} value={reason} />)}</datalist>
      <label>Notas da revisão<textarea rows={2} maxLength={6000} value={value.notes} disabled={busy} onChange={event => change({ ...value, notes: event.target.value })} /></label>
      {value.status === 'included' && <details className="bib-evidence" open>
        <summary>Extração de evidências</summary>
        <label>ID do estudo<input maxLength={100} placeholder="Ex.: Estudo 01" value={value.evidence.studyKey} disabled={busy} onChange={event => change({ ...value, evidence: { ...value.evidence, studyKey: event.target.value } })} /></label>
        <p className="bib-help">Repita o ID quando mais de uma publicação relatar o mesmo estudo.</p>
        <div className="bib-evidence-fields">{evidenceFields.map(([key, label]) => <label key={key}>{label}<textarea rows={2} maxLength={5000} value={value.evidence[key]} disabled={busy} onChange={event => change({ ...value, evidence: { ...value.evidence, [key]: event.target.value } })} /></label>)}</div>
      </details>}
      <div className="bib-actions bib-decision-actions">
        {dirty && <span>Alterações pendentes</span>}
        <button type="submit" className="bib-button bib-primary" disabled={!canSave || !dirty}>Salvar decisão</button>
        <button type="button" className="bib-button" disabled={!canSave || !dirty} onClick={() => save(true)}>Salvar e avançar</button>
        {dirty && <button type="button" className="bib-button" disabled={busy} onClick={discard}>Descartar</button>}
      </div>
    </form>
  </article>;
}

function Counts({ title, lines }: { title: string; lines: [string, number | string][] }) {
  return <section className="bib-flow-card">
    <h3>{title}</h3>
    <dl>{lines.map(([label, count]) => <div key={label}><dt>{label}</dt><dd>{count}</dd></div>)}</dl>
  </section>;
}

export function BibliographyFlowView({ project, busy, exportData }: { project: BibliographyProject; busy: boolean; exportData(format: BibliographyExport): void }) {
  const { flow, sources } = project;
  const pending = flow.counts.pending + flow.counts.awaiting_text + flow.counts.awaiting_assessment;
  return <section aria-labelledby="bib-flow-title" className="bib-flow">
    <div className="bib-section-heading">
      <div><h2 id="bib-flow-title">Fluxo PRISMA e exportações</h2><p>Contagens para o modelo de buscas em bases de dados e registros de estudos.</p></div>
      <div className="bib-actions">
        <button type="button" className="bib-button" disabled={busy || !flow.articlesIncluded} onClick={() => exportData('evidence')}>Exportar evidências</button>
        <button type="button" className="bib-button bib-primary" disabled={busy || !flow.identified} onClick={() => exportData('prisma')}>Exportar contagens PRISMA</button>
      </div>
    </div>
    {(pending > 0 || flow.studyKeysMissing > 0) && <p className="bib-flow-note">
      {pending > 0 ? `${pending} ${pending === 1 ? 'referência ainda precisa de uma decisão.' : 'referências ainda precisam de uma decisão.'} ` : ''}
      {flow.studyKeysMissing ? `Preencha o ID do estudo em ${flow.studyKeysMissing} ${flow.studyKeysMissing === 1 ? 'relatório incluído' : 'relatórios incluídos'} para calcular o número de estudos.` : ''}
    </p>}
    <div className="bib-flow-grid">
      <Counts title="Identificação" lines={[
        ['Registros em bases de dados', flow.database], ['Registros em registros de estudos', flow.register], ['Identificados no total', flow.identified],
        ['Duplicatas removidas', flow.duplicates], ['Removidos sem título', flow.invalid],
      ]} />
      <Counts title="Triagem" lines={[
        ['Registros triados', flow.screened], ['Excluídos por título ou resumo', flow.counts.screen_excluded], ['Aguardando triagem', flow.counts.pending],
      ]} />
      <Counts title="Texto completo" lines={[
        ['Relatórios procurados', flow.reportsSought], ['Relatórios não recuperados', flow.reportsNotRetrieved],
        ['Relatórios avaliados', flow.reportsAssessed], ['Excluídos após avaliação', flow.counts.full_excluded],
      ]} />
      <Counts title="Inclusão" lines={[
        ['Relatórios incluídos', flow.articlesIncluded], ['Estudos incluídos', flow.studiesIncluded ?? 'A definir'],
      ]} />
    </div>
    {!!flow.fullTextReasons.length && <Counts title="Motivos de exclusão após leitura" lines={flow.fullTextReasons.map(item => [item.reason, item.count])} />}
    {!!sources.length && <section className="bib-source-history" aria-label="Histórico de importações">
      <h3>Histórico de importações</h3>
      <ul>{sources.map((item, index) => <li key={`${index}-${item.importedAt}`}>
        <strong>{item.source}</strong><span>{item.kind === 'database' ? 'Base de dados' : 'Registro de estudos'} · {item.name}</span>
        <span>{item.identified} {item.identified === 1 ? 'identificada' : 'identificadas'} · {item.added} {item.added === 1 ? 'nova' : 'novas'} · {item.duplicates} {item.duplicates === 1 ? 'duplicata' : 'duplicatas'}{item.invalid ? ` · ${item.invalid} sem título` : ''}</span>
      </li>)}</ul>
    </section>}
  </section>;
}
