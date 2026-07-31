import { cp, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const root = dirname(scriptsDir);
const dist = join(root, 'dist');

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await cp(join(root, 'index.html'), join(dist, 'index.html'));
await cp(join(root, 'src'), join(dist, 'src'), { recursive: true });
// لا ننشر مسودة Gemini القديمة ما دام التطبيق غير مرتبط بـ Supabase.
await rm(join(dist, 'src', 'services', 'geminiReview.js'), { force: true });
await writeFile(join(dist, '.nojekyll'), '');

const info = await stat(join(dist, 'index.html'));
if (!info.isFile()) throw new Error('Build failed: dist/index.html was not created.');
console.log('Static GitHub Pages build created in dist/.');
