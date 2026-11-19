import { cp, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const root = path.dirname(require.resolve('pdfjs-dist/package.json'));
for (const directory of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
  await mkdir(`public/pdfjs/${directory}`, { recursive: true });
  await cp(path.join(root, directory), `public/pdfjs/${directory}`, { recursive: true });
}
