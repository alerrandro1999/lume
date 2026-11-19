import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { models, prepareModel, download } from './transcription-models.mjs';

const root = fileURLToPath(new URL('../resources/transcription/', import.meta.url));
const runtime = path.join(root, 'runtime');
const version = '1.8.4';
const archiveHash = '74f973345cb52ef5ba3ec9e7e7af8e48cc8c71722d1528603b80588a11f82e3e';
const engineFiles = ['whisper-cli.exe', 'whisper.dll', 'ggml.dll', 'ggml-base.dll', 'ggml-cpu.dll'];
const manifest = [archiveHash, models[0].hash, ...engineFiles].join('\n');
const ffmpegRelease = 'autobuild-2026-11-16-15-29';
const ffmpegArchive = 'ffmpeg-n8.1.3-35-gf1acb0a266-win64-lgpl-shared-8.1.zip';
const ffmpegHash = 'dd923de0811e9a26f13142e22f30a9e555454e0dd0561785bcca23b8809a58a0';
const ffmpegFiles = ['ffmpeg.exe', 'avcodec-62.dll', 'avdevice-62.dll', 'avfilter-11.dll', 'avformat-62.dll', 'avutil-60.dll', 'swresample-6.dll', 'swscale-9.dll', 'LICENSE.txt'];

async function engineReady() {
  try {
    if (await readFile(path.join(runtime, 'version.txt'), 'utf8') !== manifest) return false;
    const files = await Promise.all(engineFiles.map(file => stat(path.join(runtime, file))));
    return files.every(file => file.isFile() && file.size > 0);
  } catch { return false; }
}

async function prepareEngine() {
  if (await engineReady()) return;
  const archive = await download(`https://github.com/ggml-org/whisper.cpp/releases/download/v${version}/whisper-bin-x64.zip`, 4078768, archiveHash);
  const zip = await JSZip.loadAsync(archive);
  const files = new Map(Object.values(zip.files).filter(file => !file.dir).map(file => [path.posix.basename(file.name), file]));

  await rm(path.join(runtime, 'version.txt'), { force: true });
  for (const name of engineFiles) {
    const file = files.get(name);
    if (!file) throw new Error(`O pacote do Whisper não contém ${name}.`);
    await writeFile(path.join(runtime, name), await file.async('nodebuffer'));
  }
  await rm(path.join(runtime, 'SDL2.dll'), { force: true });
  await writeFile(path.join(runtime, 'version.txt'), manifest);
}

async function prepareFfmpeg() {
  const directory = path.join(runtime, 'ffmpeg');
  const marker = path.join(directory, 'version.txt');
  try {
    if (await readFile(marker, 'utf8') === ffmpegHash) {
      const files = await Promise.all(ffmpegFiles.map(file => stat(path.join(directory, file))));
      if (files.every(file => file.isFile() && file.size > 0)) return;
    }
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  console.log('Baixando FFmpeg para importar áudio de MP4 e M4A (80 MB)…');
  const archive = await download(`https://github.com/FFmpeg-Builds/FFmpeg-Builds/releases/download/${ffmpegRelease}/${ffmpegArchive}`, 80289577, ffmpegHash);
  const zip = await JSZip.loadAsync(archive);
  const files = new Map(Object.values(zip.files).filter(file => !file.dir).map(file => [path.posix.basename(file.name), file]));
  await mkdir(directory, { recursive: true });
  await rm(marker, { force: true });
  for (const name of ffmpegFiles) {
    const file = files.get(name);
    if (!file) throw new Error(`O pacote do FFmpeg não contém ${name}.`);
    await writeFile(path.join(directory, name), await file.async('nodebuffer'));
  }
  await writeFile(marker, ffmpegHash);
}

export async function prepareTranscription() {
  if (process.platform === 'darwin') { const { prepareMacRuntime } = await import('./prepare-transcription-macos.mjs'); return prepareMacRuntime(); }
  if (process.platform !== 'win32') throw new Error('A preparação dos componentes locais exige Windows ou macOS.');
  await mkdir(runtime, { recursive: true });
  await Promise.all([prepareEngine(), prepareFfmpeg(), ...models.map(model => prepareModel(model,runtime))]);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await prepareTranscription().catch(error => {
    console.error(`Não foi possível preparar o Estúdio de Transcrição. ${error.message} Execute npm run transcription:prepare com acesso à internet.`);
    process.exitCode = 1;
  });
}
