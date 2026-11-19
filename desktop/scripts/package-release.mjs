import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { validateReleaseConfig, assertStore } = require('./release-config.cjs');
const root = fileURLToPath(new URL('../', import.meta.url));
export function buildConfig(pkg, settings, mode) {
  const store = mode === 'store', github = settings.github;
  const configured = !!github.owner && !!github.repo;
  if (store) assertStore(settings.store);
  if (mode === 'release' && !configured) throw new Error('Crie um repositório público para as versões e preencha github.owner e github.repo em release.config.json. Depois execute release:prepare novamente.');
  return {
    ...pkg.build,
    directories: { ...pkg.build.directories, output: store ? 'release/store' : 'release/installers' },
    extraMetadata: { lumeRelease: { channel: store ? 'store' : 'direct', github: store ? null : configured ? github : null } },
    win: {
      ...pkg.build.win,
      target: store ? 'appx' : 'nsis',
      ...(settings.publisherName.length && !store ? { publisherName: settings.publisherName, signExecutable: true } : {}),
    },
    publish: !store && configured ? { provider: 'github', ...github, releaseType: 'draft', private: false } : null,
    nsis: { include: 'resources/branding/lume-installer.nsh', oneClick: false, perMachine: false, allowElevation: false, allowToChangeInstallationDirectory: true, deleteAppDataOnUninstall: false, runAfterFinish: false, createDesktopShortcut: true, createStartMenuShortcut: true, shortcutName: 'Lume', uninstallDisplayName: 'Lume', artifactName: 'Lume-Setup-${version}-${arch}.${ext}', installerLanguages: ['pt_BR', 'en_US'], language: '1046' },
    ...(store ? {
      appx: {
        ...settings.store,
        applicationId: 'Lume',
        displayName: 'Lume Leitor',
        languages: ['pt-BR'],
        artifactName: 'Lume-Store-${version}-${arch}.${ext}',
        backgroundColor: '#f8f7f4',
        showNameOnTiles: true,
      },
    } : {}),
  };
}
export async function main(mode = process.argv[2]) {
  if (!['installer', 'store', 'release', 'check'].includes(mode)) throw new Error('Escolha installer, store, release ou check.');
  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const settings = validateReleaseConfig(JSON.parse(await readFile(path.join(root, 'release.config.json'), 'utf8')), process.env.LUME_RELEASE_REPOSITORY);
  if (mode === 'check') { console.log(`Lume ${pkg.version}\nGitHub: ${settings.github.owner ? `${settings.github.owner}/${settings.github.repo}` : 'aguardando repositório; consultas de atualização desativadas'}\nStore: ${settings.store.identityName || 'aguardando identidade do Partner Center'}\nO empacotamento local não publica arquivos na internet.`); return; }
  const config = buildConfig(pkg, settings, mode);
  const staging = path.join(root, '.lume-test-data', 'packaging'); await mkdir(staging, { recursive: true });
  const configFile = path.join(staging, `${mode}.json`); await writeFile(configFile, JSON.stringify(config, null, 2));
  const cli = require.resolve('electron-builder/cli.js');
  const child = spawn(process.execPath, [cli, '--config', configFile, '--win', mode === 'store' ? 'appx' : 'nsis', '--x64', '--publish', 'never'], { cwd: root, stdio: 'inherit', windowsHide: true });
  const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', resolve); });
  if (code !== 0) throw new Error(`O empacotamento terminou com código ${code}.`);
  console.log(mode === 'release' ? 'Arquivos preparados em release/installers. Confira e envie o instalador, o .blockmap e latest.yml para a mesma release pública no GitHub.' : mode === 'store' ? 'Pacote em release/store. A publicação e a certificação são realizadas no Partner Center.' : 'Instalador em release/installers. Nenhum arquivo foi publicado.');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
