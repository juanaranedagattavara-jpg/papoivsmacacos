// Empaqueta el cliente con esbuild.
//   node tools/build.js               -> public/game.js (para el servidor)
//   node tools/build.js --watch       -> recompila al guardar
//   node tools/build.js --standalone  -> dist/papois-vs-macacos.html (un solo archivo, modo bots offline)
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const watch = args.includes('--watch');
const standalone = args.includes('--standalone');

const common = {
  entryPoints: [path.join(root, 'client/main.js')],
  bundle: true,
  format: 'esm',
  target: ['es2020', 'chrome90', 'safari15', 'firefox90'],
  minify: true,
  legalComments: 'none',
  logLevel: 'warning',
};

if (standalone) {
  const out = await esbuild.build({ ...common, write: false, sourcemap: false });
  const js = out.outputFiles[0].text;
  const css = fs.readFileSync(path.join(root, 'public/style.css'), 'utf8');
  let html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
  html = html
    .replace(/<link rel="manifest"[^>]*>\n?/, '')
    .replace(/<link rel="icon"[^>]*>\n?/, '')
    .replace('<link rel="stylesheet" href="style.css">', () => `<style>\n${css}\n</style>`)
    .replace('<script type="module" src="game.js"></script>', () => `<script>window.PVM_STANDALONE = true;</script>\n<script type="module">\n${js.replace(/<\/script/g, '<\\/script')}\n</script>`);
  fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
  const file = path.join(root, 'dist/papois-vs-macacos.html');
  fs.writeFileSync(file, html);
  console.log(`Standalone: ${path.relative(root, file)} (${(html.length / 1024).toFixed(0)} KB)`);
} else if (watch) {
  const ctx = await esbuild.context({ ...common, outfile: path.join(root, 'public/game.js'), sourcemap: true });
  await ctx.watch();
  console.log('Compilando en modo watch…');
} else {
  await esbuild.build({ ...common, outfile: path.join(root, 'public/game.js'), sourcemap: true });
  const size = fs.statSync(path.join(root, 'public/game.js')).size;
  console.log(`Cliente compilado: public/game.js (${(size / 1024).toFixed(0)} KB)`);
}
