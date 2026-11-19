const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const kinds = ['education', 'experience', 'project', 'certificate', 'activity'];
const levels = ['learning', 'practicing', 'confident'];
const fileExtensions = ['.pdf', '.png', '.jpg', '.jpeg', '.docx'];
const profileDefaults = () => ({ name: '', headline: '', course: '', institution: '', location: '', email: '', phone: '', linkedin: '', website: '', about: '', objective: '' });
function text(value, limit, required = false) { if (typeof value !== 'string' || value.length > limit || value.includes('\0')) throw new Error('Confira os campos do portfólio.'); const result = value.trim(); if (required && !result) throw new Error('Informe um título ou nome.'); return result; }
function id(value) { if (typeof value !== 'string' || !uuid.test(value)) throw new Error('Registro inválido.'); return value; }
function url(value) {
  const raw = text(value, 2000); if (!raw) return '';
  let parsed; try { parsed = new URL(raw); } catch { throw new Error('Use um endereço completo, começando por https:// ou http://.'); }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('Use um endereço HTTP ou HTTPS sem credenciais.');
  return parsed.href;
}
function month(value) { if (value === '') return ''; if (typeof value !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value) || value.startsWith('0000')) throw new Error('Informe um mês e ano válidos.'); return value; }
function day(value) { if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Informe uma data válida.'); const parsed = new Date(value + 'T12:00:00Z'); if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new Error('Informe uma data válida.'); return value; }
function profile(value) {
  const result = Object.fromEntries(Object.keys(profileDefaults()).map(key => [key, text(value?.[key], ['about', 'objective'].includes(key) ? 6000 : key === 'linkedin' || key === 'website' ? 2000 : 200)]));
  if (result.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result.email)) throw new Error('Confira o endereço de e-mail.');
  result.linkedin = url(result.linkedin); result.website = url(result.website); return result;
}
function entryDraft(value) {
  if (!kinds.includes(value?.kind) || typeof value.current !== 'boolean' || typeof value.visible !== 'boolean' || typeof value.featured !== 'boolean' || !['internship', 'work', 'volunteer', 'other'].includes(value.experienceType)) throw new Error('Confira o tipo e as opções do registro.');
  const start = month(value.start), end = value.current ? '' : month(value.end);
  if (start && end && end < start) throw new Error('A conclusão deve ser no mês de início ou depois dele.');
  if (!Number.isFinite(value.targetHours) || value.targetHours < 0 || value.targetHours > 10000 || !Number.isInteger(value.targetHours * 4)) throw new Error('Informe uma meta de horas válida, em intervalos de 15 minutos.');
  return { kind: value.kind, title: text(value.title, 200, true), organization: text(value.organization, 200), role: text(value.role, 200), start, end, current: value.current, summary: text(value.summary, 6000), outcomes: text(value.outcomes, 6000), skills: text(value.skills, 1500), url: url(value.url), visible: value.visible, featured: value.featured, experienceType: value.experienceType, supervisor: text(value.supervisor, 200), targetHours: value.targetHours };
}
function skillDraft(value) { if (!['technical', 'interpersonal', 'language'].includes(value?.category) || !levels.includes(value.level)) throw new Error('Confira a categoria e o nível da competência.'); return { name: text(value.name, 100, true), category: value.category, level: value.level }; }
function logDraft(value, entries) {
  if (!entries.some(entry => entry.id === value?.entryId && entry.kind === 'experience' && entry.experienceType === 'internship')) throw new Error('Selecione um estágio cadastrado nas experiências.');
  if (!Number.isInteger(value.minutes) || value.minutes < 1 || value.minutes > 1440) throw new Error('Informe de 1 minuto a 24 horas por atividade.');
  return { entryId: value.entryId, date: day(value.date), minutes: value.minutes, activity: text(value.activity, 3000, true), learning: text(value.learning, 6000) };
}
function preferences(value) { if (!['ocean', 'violet', 'forest'].includes(value?.theme) || typeof value.showContacts !== 'boolean' || typeof value.showSkills !== 'boolean') throw new Error('Confira as opções da apresentação.'); return { theme: value.theme, showContacts: value.showContacts, showSkills: value.showSkills }; }
function validate(data) {
  if (data?.version !== 1 || !Array.isArray(data.entries) || data.entries.length > 500 || !Array.isArray(data.skills) || data.skills.length > 200 || !Array.isArray(data.logs) || data.logs.length > 5000 || !Array.isArray(data.evidence) || data.evidence.length > 500) throw new Error('Formato ou quantidade de registros inválida.');
  profile(data.profile); preferences(data.preferences);
  const ids = new Set(), unique = item => { id(item.id); if (ids.has(item.id)) throw new Error('Registro duplicado.'); ids.add(item.id); };
  for (const entry of data.entries) { unique(entry); entryDraft(entry); if (entry.sourceProjectId) id(entry.sourceProjectId); }
  for (const skill of data.skills) { unique(skill); skillDraft(skill); }
  for (const log of data.logs) { unique(log); logDraft(log, data.entries); }
  for (const file of data.evidence) { unique(file); if (!data.entries.some(entry => entry.id === file.entryId) || !fileExtensions.includes(file.extension) || !Number.isSafeInteger(file.size) || file.size < 0) throw new Error('Comprovante inválido.'); text(file.name, 300, true); }
}
class AcademicPortfolio {
  constructor(userData) {
    this.file = path.join(userData, 'portfolio.json'); this.directory = path.join(userData, 'portfolio-files');
    this.data = { version: 1, profile: profileDefaults(), preferences: { theme: 'ocean', showContacts: true, showSkills: true }, entries: [], skills: [], logs: [], evidence: [] };
    try { const saved = JSON.parse(fs.readFileSync(this.file, 'utf8')); validate(saved); this.data = saved; } catch (error) { if (error.code !== 'ENOENT') this.problem = 'Não foi possível ler o portfólio. Confira o arquivo portfolio.json nos dados do Lume.'; }
  }
  read() { if (this.problem) throw new Error(this.problem); return structuredClone(this.data); }
  commit(next) {
    if (this.problem) throw new Error(this.problem); validate(next);
    const json = JSON.stringify(next); if (Buffer.byteLength(json) > 32 * 1024 ** 2) throw new Error('O portfólio atingiu o limite de armazenamento.');
    fs.mkdirSync(path.dirname(this.file), { recursive: true }); const temporary = this.file + '.' + randomUUID() + '.tmp';
    try { fs.writeFileSync(temporary, json, { flag: 'wx', encoding: 'utf8' }); fs.renameSync(temporary, this.file); } catch (error) { try { fs.unlinkSync(temporary); } catch { /* Preserva o erro original. */ } throw error; }
    this.data = next; return this.read();
  }
  saveProfile(value) { const next = this.read(); next.profile = profile(value); if (!next.profile.name) throw new Error('Informe seu nome completo.'); return this.commit(next); }
  savePreferences(value) { const next = this.read(); next.preferences = preferences(value); return this.commit(next); }
  entry(entryId) { const entry = this.data.entries.find(entry => entry.id === entryId); if (!entry) throw new Error('Registro não encontrado.'); return entry; }
  saveEntry(entryId, value) {
    const next = this.read(), draft = entryDraft(value), previous = entryId === null ? null : this.entry(entryId);
    if (previous && next.logs.some(log => log.entryId === entryId) && (draft.kind !== 'experience' || draft.experienceType !== 'internship')) throw new Error('Este estágio possui atividades registradas. Mantenha o tipo Estágio ou remova suas atividades primeiro.');
    const entry = { ...draft, id: previous?.id ?? randomUUID(), sourceProjectId: previous?.sourceProjectId ?? '' };
    next.entries = previous ? next.entries.map(item => item.id === entryId ? entry : item) : [...next.entries, entry]; return this.commit(next);
  }
  toggle(entryId, visible) { if (typeof visible !== 'boolean') throw new Error('Opção inválida.'); const next = this.read(); this.entry(entryId); next.entries.find(entry => entry.id === entryId).visible = visible; return this.commit(next); }
  move(entryId, delta) { if (![1, -1].includes(delta)) throw new Error('Posição inválida.'); const next = this.read(), entry = this.entry(entryId), indices = next.entries.map((item, index) => item.kind === entry.kind ? index : -1).filter(index => index >= 0), offset = indices.findIndex(index => next.entries[index].id === entryId), index = indices[offset], target = indices[offset + delta]; if (target !== undefined) [next.entries[index], next.entries[target]] = [next.entries[target], next.entries[index]]; return this.commit(next); }
  removeEntry(entryId) {
    this.entry(entryId); const next = this.read(), files = next.evidence.filter(file => file.entryId === entryId);
    next.entries = next.entries.filter(entry => entry.id !== entryId); next.logs = next.logs.filter(log => log.entryId !== entryId); next.evidence = next.evidence.filter(file => file.entryId !== entryId);
    const result = this.commit(next); for (const file of files) this.cleanFile(file); return result;
  }
  importProject(project) {
    if (this.data.entries.some(entry => entry.sourceProjectId === project.id)) throw new Error('Este projeto já foi adicionado ao portfólio.');
    const value = { kind: 'project', title: project.title, organization: project.course, role: '', start: project.startDate.slice(0, 7), end: '', current: project.status !== 'completed', summary: project.plan.generalObjective || project.plan.topic, outcomes: '', skills: '', url: '', visible: true, featured: false, experienceType: 'other', supervisor: '', targetHours: 0 };
    const next = this.read(); next.entries.push({ ...entryDraft(value), id: randomUUID(), sourceProjectId: id(project.id) }); return this.commit(next);
  }
  saveSkill(skillId, value) { const next = this.read(), draft = skillDraft(value); if (skillId !== null && !next.skills.some(skill => skill.id === skillId)) throw new Error('Competência não encontrada.'); if (next.skills.some(skill => skill.id !== skillId && skill.name.toLocaleLowerCase('pt-BR') === draft.name.toLocaleLowerCase('pt-BR'))) throw new Error('Esta competência já está cadastrada.'); const skill = { ...draft, id: skillId ?? randomUUID() }; next.skills = skillId === null ? [...next.skills, skill] : next.skills.map(item => item.id === skillId ? skill : item); return this.commit(next); }
  removeSkill(skillId) { const next = this.read(); if (!next.skills.some(skill => skill.id === skillId)) throw new Error('Competência não encontrada.'); next.skills = next.skills.filter(skill => skill.id !== skillId); return this.commit(next); }
  saveLog(logId, value) { const next = this.read(), draft = logDraft(value, next.entries); if (logId !== null && !next.logs.some(log => log.id === logId)) throw new Error('Atividade não encontrada.'); const log = { ...draft, id: logId ?? randomUUID() }; next.logs = logId === null ? [...next.logs, log] : next.logs.map(item => item.id === logId ? log : item); return this.commit(next); }
  removeLog(logId) { const next = this.read(); if (!next.logs.some(log => log.id === logId)) throw new Error('Atividade não encontrada.'); next.logs = next.logs.filter(log => log.id !== logId); return this.commit(next); }
  fileFor(file) { id(file.id); if (!fileExtensions.includes(file.extension)) throw new Error('Comprovante inválido.'); return path.join(this.directory, file.id + file.extension); }
  cleanFile(file) { try { fs.unlinkSync(this.fileFor(file)); } catch (error) { if (error.code !== 'ENOENT') console.warn('Não foi possível remover o comprovante:', error.message); } }
  evidence(fileId) { const file = this.data.evidence.find(file => file.id === fileId); if (!file) throw new Error('Comprovante não encontrado.'); return file; }
  async addEvidence(entryId, paths) {
    this.entry(entryId); if (!Array.isArray(paths) || paths.length > 10) throw new Error('Adicione até 10 comprovantes por vez.');
    await fsp.mkdir(this.directory, { recursive: true }); let added = 0; const errors = [];
    for (const original of paths) {
      const name = path.basename(original), extension = path.extname(original).toLowerCase(), fileId = randomUUID(), temporary = path.join(this.directory, fileId + '.tmp'), destination = path.join(this.directory, fileId + extension);
      try {
        if (!fileExtensions.includes(extension)) throw new Error('Use PDF, PNG, JPEG ou DOCX.');
        const info = await fsp.stat(original); if (!info.isFile() || info.size > 20 * 1024 ** 2) throw new Error('Cada comprovante pode ter até 20 MB.');
        await fsp.copyFile(original, temporary, fs.constants.COPYFILE_EXCL); const copy = await fsp.stat(temporary); if (copy.size > 20 * 1024 ** 2) throw new Error('Cada comprovante pode ter até 20 MB.'); await fsp.rename(temporary, destination);
        const next = this.read(); this.entry(entryId); next.evidence.push({ id: fileId, entryId, name: name.slice(0, 300), extension, size: copy.size }); this.commit(next); added++;
      } catch (error) { await fsp.unlink(destination).catch(() => {}); errors.push({ name, detail: error.code ? 'Não foi possível copiar o arquivo.' : error.message }); }
      finally { await fsp.unlink(temporary).catch(() => {}); }
    }
    return { data: this.read(), added, errors };
  }
  removeEvidence(fileId) { const file = this.evidence(fileId), next = this.read(); next.evidence = next.evidence.filter(item => item.id !== fileId); const result = this.commit(next); this.cleanFile(file); return result; }
  csv() {
    const data = this.read(), cell = value => { const text = String(value ?? ''), safe = /^\s*[=+\-@]/.test(text) ? "'" + text : text; return '"' + safe.replaceAll('"', '""') + '"'; };
    const rows = [['Estágio', 'Data', 'Minutos', 'Horas', 'Atividade', 'Aprendizados'], ...[...data.logs].sort((a, b) => a.date.localeCompare(b.date)).map(log => [data.entries.find(entry => entry.id === log.entryId).title, log.date, log.minutes, (log.minutes / 60).toFixed(2).replace('.', ','), log.activity, log.learning])];
    return '\uFEFF' + rows.map(row => row.map(cell).join(';')).join('\r\n') + '\r\n';
  }
}
const escape = value => String(value).toWellFormed().replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
function portfolioHtml(data) {
  const profile = data.profile, prefs = data.preferences, accent = { ocean: '#357b92', violet: '#735ca5', forest: '#47795f' }[prefs.theme];
  const section = (title, body) => body ? `<section><h2>${title}</h2>${body}</section>` : '';
  const paragraph = value => value ? `<p class="text">${escape(value)}</p>` : '';
  const period = entry => [entry.start && entry.start.split('-').reverse().join('/'), entry.current ? 'Atual' : entry.end && entry.end.split('-').reverse().join('/')].filter(Boolean).join(' - ');
  const contact = prefs.showContacts ? [profile.location, profile.email, profile.phone].filter(Boolean).map(escape).join(' · ') : '';
  const links = prefs.showContacts ? [profile.linkedin, profile.website].filter(Boolean).map(link => `<a href="${escape(link)}">${escape(link)}</a>`).join(' · ') : '';
  const labels = { education: 'Formação', experience: 'Experiências e estágios', project: 'Projetos', certificate: 'Cursos e certificações', activity: 'Atividades acadêmicas' };
  const entries = kinds.map(kind => section(labels[kind], data.entries.filter(entry => entry.kind === kind && entry.visible).map(entry => `<article><div class="entry-head"><h3>${escape(entry.title)}${entry.featured ? ' <span class="featured">Destaque</span>' : ''}</h3><span>${escape(period(entry))}</span></div><div class="meta">${[entry.organization, entry.role].filter(Boolean).map(escape).join(' · ')}</div>${paragraph(entry.summary)}${entry.outcomes ? '<div class="result-label">Resultados e aprendizados</div>' + paragraph(entry.outcomes) : ''}${prefs.showSkills && entry.skills ? `<p class="entry-skills">Competências: ${escape(entry.skills)}</p>` : ''}${entry.url ? `<a class="entry-link" href="${escape(entry.url)}">${escape(entry.url)}</a>` : ''}</article>`).join(''))).join('');
  const skillLabels = { learning: 'Em desenvolvimento', practicing: 'Na prática', confident: 'Com autonomia' };
  const skills = prefs.showSkills && data.skills.length ? section('Competências', `<div class="skills">${data.skills.map(skill => `<div><strong>${escape(skill.name)}</strong><span>${skillLabels[skill.level]}</span></div>`).join('')}</div>`) : '';
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${escape(profile.name || 'Portfólio acadêmico')}</title><style>
  @page{size:A4;margin:17mm 18mm 19mm}*{box-sizing:border-box}html{color:#273546;background:#fff;font:10.5pt/1.65 'Segoe UI',Arial,sans-serif}body{margin:0}header{border-top:5px solid ${accent};padding-top:23px;padding-bottom:22px;border-bottom:1px solid #dde4ea}.eyebrow{font-size:8pt;letter-spacing:1.5px;text-transform:uppercase;color:${accent};font-weight:600}h1{font-size:27pt;line-height:1.15;letter-spacing:-1px;margin:12px 0 9px;overflow-wrap:anywhere}header h3{font-size:12pt;font-weight:500;color:${accent};margin:0 0 10px}.education{color:#627284;font-size:10pt}.contact,.links{font-size:8.5pt;margin-top:9px;color:#627284;overflow-wrap:anywhere}a{color:${accent};text-decoration:none;overflow-wrap:anywhere}section{margin-top:23px}h2{font-size:10pt;letter-spacing:1px;text-transform:uppercase;color:${accent};border-bottom:1px solid #dde4ea;padding-bottom:7px;margin:0 0 12px;break-after:avoid}h3{font-size:11pt;margin:0;font-weight:650;overflow-wrap:anywhere}.entry-head{display:flex;align-items:baseline;justify-content:space-between;gap:14px;break-after:avoid}.entry-head>span{font-size:8pt;color:#627284;white-space:nowrap}.meta{font-size:9pt;color:#627284;margin:3px 0 9px;break-after:avoid}article{margin-bottom:21px}.text{margin:7px 0;white-space:pre-line;overflow-wrap:anywhere;orphans:3;widows:3}.result-label{font-size:8pt;font-weight:650;color:#627284;margin-top:11px;break-after:avoid}.entry-skills{font-size:8.5pt;color:#627284;margin:9px 0 0;white-space:pre-line}.entry-link{display:block;font-size:8pt;margin-top:7px}.featured{font-size:7pt;letter-spacing:.5px;font-weight:500;padding:2px 5px;border:1px solid #dde4ea;border-radius:3px;color:${accent};white-space:nowrap}.skills{display:grid;grid-template-columns:1fr 1fr;gap:10px 22px}.skills>div{display:flex;justify-content:space-between;gap:10px;border-bottom:1px solid #eef1f4;padding-bottom:7px;break-inside:avoid}.skills strong{font-size:9pt;font-weight:500}.skills span{font-size:8pt;color:#627284}.empty{font-size:10pt;color:#627284}footer{margin-top:28px;padding-top:12px;border-top:1px solid #dde4ea;font-size:8pt;color:#627284}@media screen{body{max-width:800px;margin:0 auto;padding:40px 44px 55px}}@media print{a{color:${accent}}}
  </style></head><body><header><span class="eyebrow">Portfólio acadêmico e de estágio</span><h1>${escape(profile.name || 'Seu nome')}</h1>${profile.headline ? `<h3>${escape(profile.headline)}</h3>` : ''}<div class="education">${[profile.course, profile.institution].filter(Boolean).map(escape).join(' · ')}</div>${contact ? `<div class="contact">${contact}</div>` : ''}${links ? `<div class="links">${links}</div>` : ''}</header>${section('Sobre mim', paragraph(profile.about))}${section('Objetivo', paragraph(profile.objective))}${entries}${skills}${!entries && !data.skills.length && !profile.about ? '<p class="empty">Adicione suas experiências, formação e projetos para compor o portfólio.</p>' : ''}</body></html>`;
}
module.exports = { AcademicPortfolio, portfolioHtml };
