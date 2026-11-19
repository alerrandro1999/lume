import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
export const models = [
  { name: 'ggml-base-q5_1.bin', size: 59707625, hash: '422f1ae452ade6f30a004d7e5c6a43195e4433bc370bf23fac9cc591f01a8898' },
  { name: 'ggml-small-q5_1.bin', size: 190085487, hash: 'ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb' },
];
const modelRevision = '5359861c739e955e79d9a303bcbc70fb988958b1';
export async function download(url, size, digest) {
  const response=await fetch(url,{signal:AbortSignal.timeout(180000)});
  if(!response.ok)throw new Error(`Download de ${new URL(url).hostname}: HTTP ${response.status}.`);
  const bytes=Buffer.from(await response.arrayBuffer());
  if(bytes.length!==size||createHash('sha256').update(bytes).digest('hex')!==digest)throw new Error(`O arquivo de ${new URL(url).hostname} não corresponde ao SHA-256 esperado.`);
  return bytes;
}
export async function prepareModel({name,size,hash},directory) {
  const destination=path.join(directory,name);
  try {if((await stat(destination)).size===size){const existing=createHash('sha256');for await(const chunk of createReadStream(destination))existing.update(chunk);if(existing.digest('hex')===hash)return;}}catch(error){if(error.code!=='ENOENT')throw error;}
  console.log(`Baixando ${name} (${Math.round(size/1000000)} MB)…`);
  const bytes=await download(`https://huggingface.co/ggerganov/whisper.cpp/resolve/${modelRevision}/${name}`,size,hash),temporary=destination+'.download';
  try{await writeFile(temporary,bytes);await rename(temporary,destination);}finally{await rm(temporary,{force:true});}
}
