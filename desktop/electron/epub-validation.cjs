const yauzl = require('yauzl');

function validateEpub(data) {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(data, { lazyEntries: true, strictFileNames: true, validateEntrySizes: true }, (error, zip) => {
      if (error) return reject(new Error('O arquivo não contém um EPUB válido.'));
      let count = 0, expanded = 0, mimetype = false, container = false, settled = false;
      const fail = message => { if (settled) return; settled = true; zip.close(); reject(new Error(message)); };
      zip.on('error', () => fail('Não foi possível ler o arquivo EPUB. Ele pode estar danificado.'));
      zip.on('entry', entry => {
        count++; expanded += entry.uncompressedSize;
        if (count > 20000 || expanded > 512 * 1024 * 1024 || entry.uncompressedSize > 100 * 1024 * 1024) return fail('O EPUB excede o limite de conteúdo descompactado desta versão.');
        if (entry.isEncrypted() || entry.fileName.toLowerCase() === 'meta-inf/rights.xml') return fail('Este EPUB possui proteção DRM ou criptografia que o Lume ainda não abre.');
        if (entry.fileName === 'META-INF/container.xml') container = true;
        if (entry.fileName !== 'mimetype') { zip.readEntry(); return; }
        if (entry.uncompressedSize > 64) return fail('O tipo do arquivo EPUB é inválido.');
        zip.openReadStream(entry, (error, stream) => {
          if (error) return fail('Não foi possível validar o EPUB.');
          const chunks = [];
          stream.on('data', chunk => chunks.push(chunk));
          stream.on('error', () => fail('Não foi possível validar o EPUB.'));
          stream.on('end', () => {
            if (settled) return;
            mimetype = Buffer.concat(chunks).toString('utf8').trim() === 'application/epub+zip';
            zip.readEntry();
          });
        });
      });
      zip.on('end', () => {
        if (settled) return;
        if (!mimetype || !container) return fail('O arquivo não contém a estrutura de um livro EPUB válido.');
        settled = true; zip.close(); resolve();
      });
      zip.readEntry();
    });
  });
}
module.exports = { validateEpub };
