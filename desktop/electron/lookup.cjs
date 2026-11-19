const { session } = require('electron');
let lookupSession;
async function json(url) {
  if (!lookupSession) {
    lookupSession = session.fromPartition('lume-lookup');
    lookupSession.webRequest.onBeforeRequest((request, callback) => {
      const url = new URL(request.url);
      callback({ cancel: url.protocol !== 'https:' || !['pt.wiktionary.org', 'api.mymemory.translated.net'].includes(url.hostname) });
    });
  }
  try {
    const response = await lookupSession.fetch(url, { signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'LumeReader/0.5 (desktop reading application)' } });
    if (!response.ok) throw new Error('Serviço indisponível.');
    const text = await response.text(); if (text.length > 2000000) throw new Error('Resposta muito grande.'); return JSON.parse(text);
  } catch { throw new Error('Não foi possível consultar o serviço. Verifique sua conexão e tente novamente.'); }
}
async function lookup(value) {
  if (!value || typeof value.text !== 'string' || !value.text.trim()) throw new Error('Selecione um trecho para consultar.');
  const text = value.text.trim();
  if (value.kind === 'dictionary') {
    if (text.length > 100 || text.split(/\s+/).length > 5) throw new Error('Para o dicionário, selecione uma palavra ou expressão de até cinco palavras.');
    const url = new URL('https://pt.wiktionary.org/w/api.php');
    Object.entries({ action: 'parse', page: text.toLocaleLowerCase('pt-BR'), prop: 'text', format: 'json', formatversion: '2', redirects: '1' }).forEach(([key, value]) => url.searchParams.set(key, value));
    const result = await json(url.href);
    if (!result.parse?.text) throw new Error('Palavra não encontrada no Wikcionário. Tente a forma no singular ou no infinitivo.');
    return { html: result.parse.text, source: 'Wikcionário · CC BY-SA', url: `https://pt.wiktionary.org/wiki/${encodeURIComponent(result.parse.title)}` };
  }
  if (value.kind !== 'translate' || Buffer.byteLength(text, 'utf8') > 500 || !['pt', 'en', 'es', 'fr', 'de', 'it'].includes(value.from) || !['pt', 'en', 'es', 'fr', 'de', 'it'].includes(value.to) || value.from === value.to) throw new Error('Escolha idiomas diferentes e um trecho de até 500 bytes para traduzir.');
  const url = new URL('https://api.mymemory.translated.net/get'); url.searchParams.set('q', text); url.searchParams.set('langpair', `${value.from}|${value.to}`);
  const result = await json(url.href);
  if (Number(result.responseStatus) !== 200 || typeof result.responseData?.translatedText !== 'string') throw new Error('A tradução está indisponível ou o limite diário do serviço foi atingido.');
  return { text: result.responseData.translatedText, source: 'MyMemory · tradução automática', url: 'https://mymemory.translated.net/' };
}
module.exports = { lookup };
