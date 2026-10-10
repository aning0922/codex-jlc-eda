import { build, transform } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await mkdir(path.join(root, 'dist'), { recursive: true });
await mkdir(path.join(root, '.build'), { recursive: true });
const geometry = await transform(await readFile(path.join(root, 'src/board-geometry.ts'), 'utf8'), {loader:'ts', format:'esm', target:'node20'});
await writeFile(path.join(root, 'src/board-geometry.mjs'), geometry.code);
const geometryTest = await transform((await readFile(path.join(root, 'tests/board-geometry.test.ts'), 'utf8')).replace('../src/board-geometry.js','../src/board-geometry.mjs'), {loader:'ts', format:'esm', target:'node20'});
await writeFile(path.join(root, '.build/board-geometry.test.mjs'), geometryTest.code);
const result = await build({
  absWorkingDir: root, entryPoints: {server:'src/server.mjs',cli:'src/cli.mjs'}, outdir: 'dist',
  outExtension: { '.js': '.mjs' },
  bundle: true, platform: 'node', format: 'esm', target: 'node20', packages: 'bundle',
  // Do not inherit a parent workspace tsconfig when the same source is relocated.
  tsconfigRaw: {compilerOptions:{alwaysStrict:true}},
  metafile: true, sourcemap: false, legalComments: 'inline',
  banner: { js: "import { createRequire as __jlcCreateRequire } from 'node:module'; const require = __jlcCreateRequire(import.meta.url);" }
});
const packages = new Set();
for (const input of Object.keys(result.metafile.inputs)) {
  const absolute = path.resolve(root, input);
  const index = absolute.lastIndexOf('/node_modules/');
  if (index < 0) continue;
  const parts = absolute.slice(index + '/node_modules/'.length).split('/');
  const name = parts[0].startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
  packages.add(absolute.slice(0, index + '/node_modules/'.length) + name);
}
const notices = [];
for (const dir of [...packages].sort()) {
  const pkg = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8'));
  let license = '';
  for (const f of ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'license', 'LICENSE-MIT']) {
    try { license = await readFile(path.join(dir, f), 'utf8'); break; } catch {}
  }
  if (!pkg.license || !license.trim()) throw new Error('Missing license for ' + pkg.name);
  notices.push(pkg.name + ' ' + pkg.version + ' (' + String(pkg.license) + ')\n' + license);
}
await writeFile(path.join(root, 'THIRD_PARTY_NOTICES.txt'), notices.join('\n\n---\n\n') + '\n');
await writeFile(path.join(root, '.build/metafile.json'), JSON.stringify(result.metafile, null, 2)+'\n');
console.log(JSON.stringify({ built: ['dist/server.mjs','dist/cli.mjs'], bundledPackages: packages.size }));
