// Type check, then the client (vite), then the server (esbuild). Stops at the first failure.
// Inside the app fence only .build/ and dist/ may be written, so Vite loads its config with
// its module runner (no temp file beside node_modules) and keeps its cache under .build/.
import { spawnSync } from 'node:child_process';
import { build } from 'esbuild';

for (const args of [
  ['node_modules/typescript/bin/tsc', '--noEmit'],
  ['node_modules/vite/bin/vite.js', 'build', '--configLoader', 'runner'],
]) {
  const r = spawnSync(process.execPath, args, { stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status || 1);
}

try {
  await build({
    entryPoints: ['src/index.ts'],
    bundle: true,
    platform: 'node',
    packages: 'external',
    keepNames: true,
    ignoreAnnotations: true,
    target: 'node' + process.versions.node,
    format: 'esm',
    sourcemap: true,
    logLevel: 'warning',
    outfile: '.build/index.mjs',
  });
} catch {
  process.exit(1);
}
