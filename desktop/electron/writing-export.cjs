const { ZipFile } = require('yazl');
const fs = require('node:fs/promises');
const { randomUUID } = require('node:crypto');
const escape = value => String(value).toWellFormed().replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
function usedReferences(doc) { const ids = new Set(doc.sections.filter(s => s.include).flatMap(s => s.blocks.flatMap(b => b.runs.map(r => r.citationId).filter(Boolean)))); const seen = new Set(); return doc.citations.filter(c => { const key = [c.source.kind,c.source.id,c.source.recordId || ''].join(':'); if (!ids.has(c.id) || seen.has(key)) return false; seen.add(key); return true; }); }
function referenceText(citation) { return [citation.authors, citation.title, citation.journal, citation.year, citation.doi ? 'DOI: ' + citation.doi : citation.url].filter(Boolean).join('. ') + '.'; }
function runText(run, doc) { return run.citationId ? doc.citations.find(c => c.id === run.citationId)?.label || '' : run.text; }
function writingHtml(doc) {
  const run = value => { let html = escape(runText(value, doc)).replace(/\n/g, '<br>'); if (value.bold) html = `<strong>${html}</strong>`; if (value.italic) html = `<em>${html}</em>`; return html; };
  const body = doc.sections.filter(s => s.include).map(section => {
    let output = `<h2>${escape(section.title)}</h2>`, list = '';
    for (const block of section.blocks) { const tag = block.type === 'bullet' ? 'ul' : block.type === 'number' ? 'ol' : ''; if (list && list !== tag) { output += `</${list}>`; list = ''; } if (tag && !list) { output += `<${tag}>`; list = tag; } const element = tag ? 'li' : block.type === 'heading' ? 'h3' : block.type === 'quote' ? 'blockquote' : 'p'; output += `<${element}>${block.runs.map(run).join('') || '<br>'}</${element}>`; }
    return output + (list ? `</${list}>` : '');
  }).join('');
  const refs = usedReferences(doc);
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>${escape(doc.title)}</title><style>@page{size:A4;margin:22mm 22mm 25mm}*{box-sizing:border-box}body{font:12pt/1.5 'Times New Roman',serif;color:#000;margin:0;overflow-wrap:anywhere}h1{font-size:22pt;line-height:1.25;margin:0 0 10pt}h2{font-size:14pt;margin:22pt 0 8pt;break-after:avoid}h3{font-size:12pt;margin:16pt 0 6pt;break-after:avoid}p{margin:0 0 10pt;orphans:3;widows:3}blockquote{margin:12pt 0 12pt 24pt}ul,ol{padding-left:22pt}li{margin-bottom:6pt}.byline{margin-bottom:22pt;color:#333}.reference{margin-bottom:10pt;text-align:left}</style></head><body><h1>${escape(doc.title)}</h1>${doc.author || doc.course ? `<p class="byline">${[doc.author,doc.course].filter(Boolean).map(escape).join('<br>')}</p>` : ''}${body}${refs.length ? '<h2>Referências</h2>' + refs.map(c => `<p class="reference">${escape(referenceText(c))}</p>`).join('') : ''}</body></html>`;
}
function docx(doc) {
  let docxNumberSequence = 1;
  const w = value => escape(value);
  const run = value => { const parts = runText(value, doc).split(/(\n|\t)/); return `<w:r><w:rPr>${value.bold ? '<w:b/>' : ''}${value.italic ? '<w:i/>' : ''}</w:rPr>${parts.map(part => part === '\n' ? '<w:br/>' : part === '\t' ? '<w:tab/>' : `<w:t xml:space="preserve">${w(part)}</w:t>`).join('')}</w:r>`; };
  const paragraph = (content, style, extra = '') => `<w:p><w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ''}${extra}</w:pPr>${content}</w:p>`;
  const plain = (value, style) => paragraph(run({text:value}), style);
  let body = plain(doc.title, 'Title'); if (doc.author) body += plain(doc.author, 'Subtitle'); if (doc.course) body += plain(doc.course, 'Subtitle');
  for (const section of doc.sections.filter(s => s.include)) { body += plain(section.title, 'Heading1'); let previous = ''; let numberId = 1;
    for (const block of section.blocks) {
      if (block.type === 'number' && previous !== 'number') numberId = ++docxNumberSequence;
      const properties = ['bullet','number'].includes(block.type) ? `<w:numPr><w:ilvl w:val="0"/><w:numId w:val="${block.type === 'bullet' ? 1 : numberId}"/></w:numPr>` : '';
      body += paragraph(block.runs.map(run).join(''), block.type === 'heading' ? 'Heading2' : block.type === 'quote' ? 'Quote' : '', properties); previous = block.type;
    }
  }
  for (const [index, reference] of usedReferences(doc).entries()) { if (index === 0) body += plain('Referências', 'Heading1'); body += plain(referenceText(reference), 'Reference'); }
  const numberCount = docxNumberSequence;
  body += '<w:sectPr><w:footerReference w:type="default" r:id="rIdFooter"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1247" w:right="1247" w:bottom="1417" w:left="1247" w:header="500" w:footer="600"/></w:sectPr>';
  const xml = value => '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' + value;
  const ns = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const style = (id, name, size, options = '') => `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/><w:pPr>${options}</w:pPr><w:rPr><w:color w:val="000000"/><w:sz w:val="${size}"/>${id.startsWith('Heading') ? '<w:b/>' : ''}</w:rPr></w:style>`;
  const files = {
    '[Content_Types].xml': xml('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' + Object.entries({ '/word/document.xml':'document', '/word/styles.xml':'styles', '/word/numbering.xml':'numbering', '/word/footer1.xml':'footer' }).map(([name,type]) => `<Override PartName="${name}" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${type === 'document' ? 'document.main' : type}+xml"/>`).join('') + '</Types>'),
    '_rels/.rels': xml('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
    'word/document.xml': xml(`<w:document ${ns} xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${body}</w:body></w:document>`),
    'word/_rels/document.xml.rels': xml('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rIdNumbering" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/><Relationship Id="rIdFooter" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/></Relationships>'),
    'word/styles.xml': xml(`<w:styles ${ns}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/><w:color w:val="000000"/><w:sz w:val="24"/><w:lang w:val="pt-BR"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="360" w:lineRule="auto"/><w:widowControl/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>${style('Title','Title',44,'<w:keepNext/><w:spacing w:after="160"/>')}${style('Subtitle','Subtitle',24,'<w:keepNext/>')}${style('Heading1','heading 1',28,'<w:keepNext/><w:outlineLvl w:val="0"/><w:spacing w:before="320" w:after="120"/>')}${style('Heading2','heading 2',24,'<w:keepNext/><w:outlineLvl w:val="1"/><w:spacing w:before="240" w:after="100"/>')}${style('Quote','Quote',24,'<w:ind w:left="480"/>')}${style('Reference','Reference',24)}</w:styles>`),
    'word/numbering.xml': xml(`<w:numbering ${ns}><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:pPr><w:tabs><w:tab w:val="num" w:pos="480"/></w:tabs><w:ind w:left="480" w:hanging="240"/></w:pPr></w:lvl></w:abstractNum><w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:pPr><w:tabs><w:tab w:val="num" w:pos="480"/></w:tabs><w:ind w:left="480" w:hanging="240"/></w:pPr></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>${Array.from({length: Math.max(0,numberCount-1)},(_,i) => `<w:num w:numId="${i+2}"><w:abstractNumId w:val="1"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num>`).join('')}</w:numbering>`),
    'word/footer1.xml': xml(`<w:ftr ${ns}><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:sz w:val="18"/></w:rPr><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p></w:ftr>`),
  };
  return new Promise((resolve,reject) => { const zip = new ZipFile(), chunks = []; zip.outputStream.on('data', chunk => chunks.push(chunk)); zip.outputStream.on('error', reject); zip.on('error', reject); zip.outputStream.on('end', () => resolve(Buffer.concat(chunks))); for (const [name,value] of Object.entries(files)) zip.addBuffer(Buffer.from(value), name); zip.end(); });
}
async function writeExport(file, buffer) { const temporary = file + '.' + randomUUID() + '.tmp'; try { await fs.writeFile(temporary, buffer, {flag:'wx'}); await fs.rename(temporary,file); } finally { await fs.unlink(temporary).catch(() => {}); } }
module.exports = { writingHtml, docx, usedReferences, referenceText, writeExport };
