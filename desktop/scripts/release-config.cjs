const ownerPattern = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/;
const repoPattern = /^[a-zA-Z0-9_.-]{1,100}$/;
function validateReleaseConfig(raw, repository) {
  const github = { owner: raw?.github?.owner || '', repo: raw?.github?.repo || '' };
  if (repository) { const parts = repository.split('/'); if (parts.length !== 2) throw new Error('Use LUME_RELEASE_REPOSITORY no formato usuario/repositorio.'); [github.owner, github.repo] = parts; }
  if (github.owner || github.repo) if (!ownerPattern.test(github.owner) || !repoPattern.test(github.repo) || ['.', '..'].includes(github.repo)) throw new Error('Preencha o usuário e o repositório GitHub válidos em release.config.json.');
  const publisherName = raw?.publisherName || [];
  if (!Array.isArray(publisherName) || publisherName.some(name => typeof name !== 'string' || !name.trim() || name.length > 200)) throw new Error('publisherName deve conter os nomes do titular do certificado, sem senhas.');
  const store = raw?.store || {};
  for (const key of ['identityName', 'publisher', 'publisherDisplayName']) if (store[key] !== undefined && (typeof store[key] !== 'string' || store[key].length > 256)) throw new Error('Identidade da Store inválida.');
  return { github, publisherName, store: { identityName: store.identityName || '', publisher: store.publisher || '', publisherDisplayName: store.publisherDisplayName || '' } };
}
function assertStore(store) {
  if (!/^[a-zA-Z0-9.-]{3,50}$/.test(store.identityName) || !store.publisher.startsWith('CN=') || !store.publisherDisplayName.trim()) throw new Error('Antes de gerar a versão da Store, preencha identityName, publisher (CN=...) e publisherDisplayName exatamente como aparecem no Partner Center.');
}
module.exports = { validateReleaseConfig, assertStore };
