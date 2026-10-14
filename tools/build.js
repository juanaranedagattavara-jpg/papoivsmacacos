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
const standalone = args.includes('--standalone') || args.includes('--artifact');
const artifact = args.includes('--artifact');
const cloud = args.includes('--cloud');

const common = {
  entryPoints: [path.join(root, 'client/main.js')],
  bundle: true,
  format: 'esm',
  target: ['es2020', 'chrome90', 'safari15', 'firefox90'],
  minify: true,
  legalComments: 'none',
  logLevel: 'warning',
};

if (cloud) {
  // Versión para la nube de Claude: página mínima (sin atributos id en el HTML) + game.js.
  // La interfaz se inyecta desde JS; los ids viajan como data-pvmid y se restauran al cargar.
  const css = fs.readFileSync(path.join(root, 'public/style.css'), 'utf8');
  const index = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
  let body = index.slice(index.indexOf('<body>') + 6, index.indexOf('<script type="module"'));
  body = body.replace(/<!--[\s\S]*?-->/g, '').replace(/\sid="/g, ' data-pvmid="').trim();
  const banner = `(function(){var s=document.createElement('style');s.textContent=${JSON.stringify(css)};document.head.appendChild(s);` +
    `document.body.insertAdjacentHTML('afterbegin',${JSON.stringify(body)});` +
    `var l=document.querySelectorAll('[data-pvmid]');for(var i=0;i<l.length;i++){l[i].setAttribute('i'+'d',l[i].getAttribute('data-pvmid'));l[i].removeAttribute('data-pvmid');}` +
    `window.PVM_STANDALONE=true;window.PVM_CLOUD=true;})();`;
  const out = await esbuild.build({ ...common, write: false, sourcemap: false, banner: { js: banner } });
  const dir = path.join(root, 'dist/cloud');
  fs.mkdirSync(dir, { recursive: true });
  const fonts = index.match(/<link href="https:\/\/fonts[^>]*>/)[0];
  const page = [
    '<title>Papois vs Macacos</title>',
    '<link rel="preconnect" href="https://fonts.googleapis.com">',
    fonts,
    '<style>:root{color-scheme:dark}html,body{height:100%;margin:0;background:#0f1626;color:#f4f7ff;overflow:hidden;font-family:Nunito,system-ui,sans-serif}</style>',
    '<script type="module" src="game.js"></script>',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(dir, 'index.html'), page);
  fs.writeFileSync(path.join(dir, 'game.js'), out.outputFiles[0].text);
  console.log(`Nube de Claude: dist/cloud/index.html (${page.length} B) + dist/cloud/game.js (${(out.outputFiles[0].text.length / 1024).toFixed(0)} KB)`);
} else if (standalone) {
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
  if (artifact) {
    // Variante sin <html>/<head>/<body> para publicar como página alojada (el host agrega el esqueleto)
    const fonts = html.match(/<link href="https:\/\/fonts[^>]*>/)[0];
    const style = html.slice(html.indexOf('<style>'), html.indexOf('</style>') + 8);
    const body = html.slice(html.indexOf('<body>') + 6, html.lastIndexOf('</body>'));
    html = `<title>Papois vs Macacos</title>\n<link rel="preconnect" href="https://fonts.googleapis.com">\n${fonts}\n${style}\n${body}`;
  }
  const file = path.join(root, artifact ? 'dist/artifact.html' : 'dist/papois-vs-macacos.html');
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
