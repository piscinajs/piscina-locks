import { defineConfig } from 'tsup';
import { copyFile } from 'node:fs/promises';
import { join } from 'node:path';

export default defineConfig({
  outDir: 'dist/lib',
  entry: ['./lib/index.ts'],
  format: ['cjs', 'esm'],
  target: 'node18',
  sourcemap: true,
  clean: true,
  minify: false,
  shims: true,
  dts: true,
  async onSuccess () {
    await copyFile(
      join(__dirname, 'package.json'),
      join(__dirname, 'dist/package.json')
    );
  }
});
