import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, copyFile, chmod, access, readdir } from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { models, prepareModel } from './transcription-models.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const runtime = path.join(root, 'resources/transcription/runtime');
export const macSources = {
  whisper: { repository: 'https://github.com/ggml-org/whisper.cpp.git', commit: '9386f239401074690479731c1e41683fbbeac557', version: '1.8.4' },
  ffmpeg: { repository: 'https://github.com/FFmpeg/FFmpeg.git', commit: '1041abdc962f4cc4f394aa8de9dc5236c0c3b9e7', version: '8.1.3' },
};
const environment = { ...process.env, MACOSX_DEPLOYMENT_TARGET: '15.0' };
export function run(command, args, cwd = root, capture = false) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: environment, windowsHide: true, stdio: ['ignore',capture ? 'pipe' : 'inherit','inherit'] });
    let output = ''; if (capture) child.stdout.setEncoding('utf8').on('data', chunk => { output += chunk; });
    child.once('error',reject); child.once('exit',code => code === 0 ? resolve(output.trim()) : reject(new Error(`${command} terminou com código ${code}.`)));
  });
}
async function checkout(name, work) {
  const source = macSources[name], directory = path.join(work,name);
  await mkdir(directory,{recursive:true});
  const exists = await access(path.join(directory,'.git')).then(()=>true,()=>false);
  if (!exists) await run('git',['init',directory]);
  const current = await run('git',['rev-parse','--verify','HEAD'],directory,true).catch(()=> '');
  if (current !== source.commit) {
    await run('git',['fetch','--depth=1',source.repository,source.commit],directory);
    await run('git',['checkout','--detach','FETCH_HEAD'],directory);
  }
  if (await run('git',['rev-parse','HEAD'],directory,true) !== source.commit) throw new Error(`Fonte de ${name} não corresponde à revisão esperada.`);
  return directory;
}
async function assertNative(executable) {
  const arch = process.arch === 'arm64' ? 'arm64' : 'x86_64';
  await run('/usr/bin/lipo',[executable,'-verify_arch',arch]);
  const dependencies = await run('/usr/bin/otool',['-L',executable],root,true);
  for (const line of dependencies.split('\n').slice(1)) {
    const dependency = line.trim().split(' (')[0];
    if (dependency && !dependency.startsWith('/usr/lib/') && !dependency.startsWith('/System/Library/')) throw new Error(`Dependência não portátil em ${path.basename(executable)}: ${dependency}`);
  }
}
export async function prepareMacRuntime() {
  if (process.platform !== 'darwin' || !['arm64','x64'].includes(process.arch)) throw new Error('Gere os componentes de Mac em um runner macOS arm64 ou Intel, com Node da mesma arquitetura.');
  const nativeArch = process.arch === 'arm64' ? 'arm64' : 'x86_64';
  const work = path.join(root,'.lume-test-data','mac-native',process.arch);
  await mkdir(runtime,{recursive:true}); await mkdir(work,{recursive:true});
  const speechSource = path.join(root,'electron/speech-macos.swift');
  const marker = JSON.stringify({version:2,arch:process.arch,sources:macSources,speech:createHash('sha256').update(await readFile(speechSource)).digest('hex')});
  const markerFile = path.join(runtime,'macos-runtime.json');
  const programs = [path.join(runtime,'whisper-cli'),path.join(runtime,'ffmpeg/ffmpeg'),path.join(runtime,'lume-speech')];
  const ready = await readFile(markerFile,'utf8').then(value=>value === marker,()=>false) && await Promise.all(programs.map(file=>access(file).then(()=>true,()=>false))).then(values=>values.every(Boolean));
  if (!ready) {
    console.log(`Preparando os componentes macOS ${process.arch}…`);
    const whisper = await checkout('whisper',work), whisperBuild = path.join(work,'whisper-build');
    await run('cmake',['-S',whisper,'-B',whisperBuild,'-DCMAKE_BUILD_TYPE=Release','-DBUILD_SHARED_LIBS=OFF','-DGGML_NATIVE=OFF','-DGGML_METAL=OFF','-DGGML_OPENMP=OFF','-DWHISPER_BUILD_TESTS=OFF','-DWHISPER_BUILD_EXAMPLES=ON',`-DCMAKE_OSX_ARCHITECTURES=${nativeArch}`,'-DCMAKE_OSX_DEPLOYMENT_TARGET=15.0']);
    const jobs = String(Math.max(1,Math.min(4,availableParallelism())));
    await run('cmake',['--build',whisperBuild,'--config','Release','--target','whisper-cli','--parallel',jobs]);
    await copyFile(path.join(whisperBuild,'bin/whisper-cli'),programs[0]);
    await copyFile(path.join(whisper,'LICENSE'),path.join(runtime,'WHISPER-LICENSE.txt'));
    const ffmpeg = await checkout('ffmpeg',work), ffmpegBuild = path.join(work,'ffmpeg-build');
    await mkdir(ffmpegBuild,{recursive:true}); await mkdir(path.join(runtime,'ffmpeg'),{recursive:true});
    await run(path.join(ffmpeg,'configure'),['--disable-shared','--enable-static','--disable-autodetect','--disable-gpl','--disable-nonfree','--disable-network','--disable-doc','--disable-debug','--disable-x86asm','--disable-programs','--disable-everything','--enable-ffmpeg','--enable-protocol=file','--enable-demuxer=mov,mp3,wav,flac','--enable-decoder=aac,mp3,mp3float,flac,pcm_s16le,pcm_s24le,pcm_s32le,pcm_f32le,pcm_f64le','--enable-parser=aac,mpegaudio,flac','--enable-encoder=flac,aac','--enable-muxer=flac,ipod','--enable-filter=aresample,aformat,anull','--enable-pic','--extra-cflags=-mmacosx-version-min=15.0','--extra-ldflags=-mmacosx-version-min=15.0'],ffmpegBuild);
    await run('make',['-j',jobs],ffmpegBuild);
    await copyFile(path.join(ffmpegBuild,'ffmpeg'),programs[1]);
    await copyFile(path.join(ffmpeg,'COPYING.LGPLv2.1'),path.join(runtime,'ffmpeg/LICENSE.txt'));
    await copyFile(path.join(ffmpegBuild,'config.h'),path.join(runtime,'ffmpeg/BUILD-CONFIG.h'));
    const modules = path.join(work,'swift-module-cache'); await mkdir(modules,{recursive:true});
    await run('/usr/bin/xcrun',['swiftc','-O','-swift-version','5','-module-cache-path',modules,'-target',`${nativeArch}-apple-macos15.0`,speechSource,'-o',programs[2]]);
    for (const file of programs) {await chmod(file,0o755);await assertNative(file);}
    await writeFile(path.join(runtime,'MACOS-SOURCES.json'),JSON.stringify({sources:macSources,buildScript:'scripts/prepare-transcription-macos.mjs',cpuOnly:true},null,2));
    await writeFile(markerFile,marker);
  }
  for (const file of programs) await assertNative(file);
  await Promise.all(models.map(model=>prepareModel(model,runtime)));
  console.log(`Componentes macOS ${process.arch} prontos.`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) prepareMacRuntime().catch(error=>{console.error(error.message);process.exitCode=1;});
