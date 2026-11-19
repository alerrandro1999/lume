const { BrowserWindow, dialog } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const html = value => String(value || '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const md = value => String(value || '').replace(/[\\`*_{}\[\]<>#|]/g, '\\$&');
const safeName = value => String(value).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '').slice(0, 90) || 'Livro';
async function exportNotes(parent, entry, notebook, format) {
  if (!['md', 'pdf'].includes(format)) throw new Error('Formato de exportação inválido.');
  const title = entry.title || entry.name.replace(/\.(pdf|epub)$/i, '');
  const result = await dialog.showSaveDialog(parent, { title: 'Exportar anotações', defaultPath: `${safeName(title)} - anotações.${format}`, filters: [{ name: format === 'pdf' ? 'PDF' : 'Markdown', extensions: [format] }] });
  if (result.canceled || !result.filePath) return null;
  const unit = entry.format === 'epub' ? 'Seção' : 'Página';
  const records = [...notebook.annotations].sort((a, b) => a.page - b.page || a.createdAt.localeCompare(b.createdAt));
  let data;
  if (format === 'md') {
    const sections = [`# Anotações — ${md(title)}`, entry.author ? `Autor: ${md(entry.author)}` : '', `Arquivo: ${md(entry.name)}`, `Exportado em ${new Date().toLocaleString('pt-BR')}.`];
    for (const note of records) sections.push(`## ${unit} ${note.page}`, note.quote ? note.quote.split(/\r?\n/).map(line => `> ${md(line)}`).join('\n') : '', md(note.note), note.location ? `Localização EPUB: ${md(note.location)}` : '');
    if (notebook.bookmarks.length) sections.push('## Marcadores', ...notebook.bookmarks.map(mark => `- ${unit} ${mark.page}: ${md(mark.label)}${mark.location ? ` — ${md(mark.location)}` : ''}`));
    data = sections.filter(Boolean).join('\n\n') + '\n';
  } else {
    const content = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>${html(title)}</title><style>@page{margin:20mm}body{font:12pt Georgia,serif;color:#242820;line-height:1.6}h1{font-size:24pt}h2{font-size:15pt}article{border-top:1px solid #ddd;margin-top:20px;padding-top:10px}blockquote{border-left:3px solid #a07c3d;padding-left:14px;margin-left:0}p{white-space:pre-wrap;overflow-wrap:anywhere}small{font:9pt Arial,sans-serif;color:#555;overflow-wrap:anywhere}</style></head><body><h1>${html(title)}</h1>${entry.author ? `<p>${html(entry.author)}</p>` : ''}<small>Anotações · ${html(entry.name)} · ${html(new Date().toLocaleString('pt-BR'))}</small>${records.map(note => `<article><h2>${unit} ${note.page}</h2>${note.quote ? `<blockquote><p>${html(note.quote)}</p></blockquote>` : ''}<p>${html(note.note)}</p>${note.location ? `<small>${html(note.location)}</small>` : ''}</article>`).join('')}${notebook.bookmarks.length ? '<h2>Marcadores</h2>' + notebook.bookmarks.map(mark => `<p>${unit} ${mark.page} — ${html(mark.label)}</p>`).join('') : ''}</body></html>`;
    const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false } });
    try { await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(content)}`); data = await window.webContents.printToPDF({ printBackground: true, pageSize: 'A4', preferCSSPageSize: true }); }
    finally { window.destroy(); }
  }
  await fs.writeFile(result.filePath, data); return result.filePath;
}
module.exports = { exportNotes, safeName };
