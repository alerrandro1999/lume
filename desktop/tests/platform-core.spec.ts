import {test,expect} from '@playwright/test';
import {createRequire} from 'node:module';
import path from 'node:path';
const require=createRequire(import.meta.url);
const {transcriptionTools,speechHelper}=require('../electron/native-runtime.cjs');
test('seleciona executáveis por plataforma sem reutilizar o motor Windows no Mac',()=>{
  const runtime=path.resolve('runtime');expect(transcriptionTools(runtime,'win32')).toEqual({whisper:path.join(runtime,'whisper-cli.exe'),ffmpeg:path.join(runtime,'ffmpeg/ffmpeg.exe')});
  expect(transcriptionTools(runtime,'darwin')).toEqual({whisper:path.join(runtime,'whisper-cli'),ffmpeg:path.join(runtime,'ffmpeg/ffmpeg')});
  expect(speechHelper('darwin',runtime,true)).toBe(path.join(runtime,'transcription/runtime/lume-speech'));expect(speechHelper('darwin',runtime,false)).toBe(path.resolve('resources/transcription/runtime/lume-speech'));
  expect(()=>transcriptionTools(runtime,'linux')).toThrow('Windows e macOS');
});
test('distingue a prévia de Mac da distribuição assinada e inclui a permissão do microfone',async()=>{
  const script='../scripts/package-macos.mjs', {macBuildConfig}=await import(script),pkg=require('../package.json');
  const preview=macBuildConfig(pkg,{arch:'arm64'}),signed=macBuildConfig(pkg,{arch:'x64',signed:true});
  expect(preview.appId).toBe(pkg.build.appId);expect(preview.publish).toBe(null);expect(preview.mac.identity).toBe('-');expect(preview.mac.notarize).toBe(false);expect(preview.mac.hardenedRuntime).toBe(false);expect(preview.mac.artifactName).toContain('-preview.');
  expect(signed.forceCodeSigning).toBe(true);expect(signed.mac.notarize).toBe(true);expect(signed.mac.hardenedRuntime).toBe(true);expect(signed.mac.artifactName).not.toContain('-preview');expect(signed.mac.extendInfo.NSMicrophoneUsageDescription).toContain('microfone');
  expect(preview.extraResources[1].filter).toContain('!runtime/**/*.exe');expect(preview.extraResources[1].filter).toContain('!runtime/**/*.dll');expect(()=>macBuildConfig(pkg,{arch:'ia32'})).toThrow('arm64');
  const builderRequire=createRequire(require.resolve('electron-builder')),{validateConfiguration}=builderRequire('app-builder-lib/out/util/config/config.js');
  await validateConfiguration(preview,{isEnabled:false});await validateConfiguration(signed,{isEnabled:false});
});
test('verifica o tamanho e o SHA-256 dos downloads antes de aceitar os modelos',async()=>{
  const script='../scripts/transcription-models.mjs', {download}=await import(script),hash='ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
  expect((await download('data:text/plain,abc',3,hash)).toString()).toBe('abc');await expect(download('data:text/plain,abc',4,hash)).rejects.toThrow('SHA-256');await expect(download('data:text/plain,abc',3,'0'.repeat(64))).rejects.toThrow('SHA-256');
});
test('no Windows impede uma geração de Mac com executáveis da plataforma errada',async()=>{
  test.skip(process.platform!=='win32');const script='../scripts/package-macos.mjs',{main}=await import(script);await expect(main([])).rejects.toThrow('macOS');
});
