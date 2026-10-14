// Production build for GitHub Pages: bundles the local scripts in index.html into one minified
// file, minifies the stylesheet, and writes index.html pointing at both into dist/.
// Usage: npm run build
// The game itself still runs straight from the source files with no build step.
import { transform } from 'esbuild';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'dist');
const target = 'es2020';

const hash = (text) => createHash('sha256').update(text).digest('hex').slice(0, 8);
const kb = (n) => (n / 1024).toFixed(1) + ' KB';

async function emit(path, text) {
  await mkdir(dirname(join(out, path)), { recursive: true });
  await writeFile(join(out, path), text);
}

let html = await readFile(join(root, 'index.html'), 'utf8');

// Local scripts, in page order. CDN scripts (Three.js) are left alone.
const scriptTag = /^[ \t]*<script src="(?!https?:)([^"]+)"><\/script>\r?\n/gm;
const scripts = [...html.matchAll(scriptTag)].map((m) => m[1]);
if (!scripts.length) throw new Error('No local <script src> tags found in index.html');

// Every file is a self-contained IIFE sharing state through window.AF, so concatenating them in
// order is equivalent to loading them separately. The ';' stops one IIFE being parsed as a call
// on the previous one. Without a format, esbuild keeps top-level names and mangles the rest.
const sources = await Promise.all(scripts.map((src) => readFile(join(root, src), 'utf8')));
const js = (await transform(sources.join('\n;\n'), { loader: 'js', minify: true, target })).code;
const jsPath = `js/app.${hash(js)}.js`;
await rm(out, { recursive: true, force: true });
await emit(jsPath, js);

// Each script tag is removed; the bundle goes where the first one was.
let first = true;
html = html.replace(scriptTag, (tag) => {
  if (!first) return '';
  first = false;
  return tag.replace(/src="[^"]+"/, `src="${jsPath}"`);
});

// Local stylesheets.
let cssIn = 0, cssOut = 0;
for (const [tag, href] of [...html.matchAll(/<link rel="stylesheet" href="(?!https?:)([^"]+)">/g)]) {
  const source = await readFile(join(root, href), 'utf8');
  const css = (await transform(source, { loader: 'css', minify: true, target })).code;
  const cssPath = href.replace(/\.css$/, `.${hash(css)}.css`);
  await emit(cssPath, css);
  html = html.replace(tag, tag.replace(href, cssPath));
  cssIn += source.length;
  cssOut += css.length;
}

// Light HTML minification: drop comments and indentation. Line breaks stay as whitespace.
html = html.replace(/<!--[\s\S]*?-->/g, '').replace(/^[ \t]+/gm, '').replace(/\n{2,}/g, '\n');
await emit('index.html', html);

const jsIn = sources.reduce((n, s) => n + s.length, 0);
console.log(`JS:  ${scripts.length} files, ${kb(jsIn)} -> ${kb(js.length)}  (${jsPath})`);
console.log(`CSS: ${kb(cssIn)} -> ${kb(cssOut)}`);
console.log(`Built to ${out}`);
