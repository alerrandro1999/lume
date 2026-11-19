import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile, access, readdir } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run, prepareMacRuntime } from './prepare-transcription-macos.mjs';
const require=createRequire(import.meta.url), root=fileURLToPath(new URL('../',import.meta.url));
export function macBuildConfig(pkg,{signed=false,arch=process.arch}={}) {
  if(!['arm64','x64'].includes(arch))throw new Error('Escolha arm64 para chip Apple ou x64 para Intel.');
  return {
    ...pkg.build, directories:{...pkg.build.directories,output:'release/macos'},
    extraMetadata:{lumeRelease:{channel:'direct',github:null}}, publish:null,
    extraResources:[{from:'resources/ocr',to:'ocr'},{from:'resources/transcription',to:'transcription',filter:['**/*','!runtime/**/*.exe','!runtime/**/*.dll']}],
    forceCodeSigning:signed,
    mac:{target:[{target:'dmg',arch:[arch]},{target:'zip',arch:[arch]}],category:'public.app-category.education',minimumSystemVersion:'15.0',icon:'.lume-test-data/mac-branding/lume.icns',
      artifactName:`Lume-\${version}-mac-\${arch}${signed?'':'-preview'}.\${ext}`,
      hardenedRuntime:signed,notarize:signed,...(!signed?{identity:'-'}:{}),
      entitlements:'resources/branding/entitlements.mac.plist',entitlementsInherit:'resources/branding/entitlements.mac.inherit.plist',
      extendInfo:{NSMicrophoneUsageDescription:'O Lume usa o microfone quando você inicia a gravação de um ensaio de apresentação.'},
    },
    dmg:{title:'Lume',contents:[{x:140,y:180,type:'file'},{x:420,y:180,type:'link',path:'/Applications'}]},
  };
}
async function icon() {
  await run(require('electron'),[path.join(root,'scripts/prepare-macos-icon.cjs')]);
  const directory=path.join(root,'.lume-test-data/mac-branding'), iconset=path.join(directory,'lume.iconset');
  await mkdir(iconset,{recursive:true});
  for(const size of [16,32,128,256,512])for(const scale of [1,2])await run('/usr/bin/sips',['-z',String(size*scale),String(size*scale),path.join(directory,'icon.png'),'--out',path.join(iconset,`icon_${size}x${size}${scale===2?'@2x':''}.png`)]);
  await run('/usr/bin/iconutil',['-c','icns',iconset,'-o',path.join(directory,'lume.icns')]);
}
export async function main(args=process.argv.slice(2)) {
  if(process.platform!=='darwin')throw new Error('O instalador de Mac precisa ser gerado em macOS. Execute o workflow macOS no GitHub Actions.');
  if(args.some(arg=>!['--signed'].includes(arg)))throw new Error('Opção inválida. Use --signed para distribuição com assinatura Apple.');
  const signed=args.includes('--signed');
  if(signed&&(!process.env.CSC_LINK||!process.env.APPLE_ID||!process.env.APPLE_APP_SPECIFIC_PASSWORD||!process.env.APPLE_TEAM_ID))throw new Error('Configure o certificado Developer ID e a autenticação Apple nos segredos do runner para assinar e notarizar.');
  await access(path.join(root,'dist/index.html')); await prepareMacRuntime(); await icon();
  const pkg=JSON.parse(await readFile(path.join(root,'package.json'),'utf8')), config=macBuildConfig(pkg,{signed});
  const {build,Platform,Arch}=require('electron-builder');
  await build({targets:Platform.MAC.createTarget(['dmg','zip'],process.arch==='arm64'?Arch.arm64:Arch.x64),publish:'never',config});
  const directory=path.join(root,'release/macos'), names=(await readdir(directory)).filter(name=>name.startsWith(`Lume-${pkg.version}-mac-${process.arch}`)&&/\.(dmg|zip)$/.test(name));
  if(names.length!==2)throw new Error('A geração não produziu o DMG e o ZIP esperados.');
  for(const name of names){const hash=createHash('sha256');for await(const chunk of createReadStream(path.join(directory,name)))hash.update(chunk);await writeFile(path.join(directory,name+'.sha256'),hash.digest('hex')+'  '+name+'\n');}
  console.log(signed?'Pacotes assinados e notarizados em release/macos.':'Prévia de teste em release/macos. A assinatura Developer ID e a notarização ainda são necessárias para distribuição aos clientes.');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error.message);process.exitCode=1;});
