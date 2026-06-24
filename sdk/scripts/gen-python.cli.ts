/**
 * CLI for the Python generator: writes the generated package to `sdk/python/`.
 * Run with `npm run gen:python`.
 */
import { mkdirSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { generatePython } from './generatePython';

const outRoot = resolve(__dirname, '..', 'python');
const files = generatePython();
for (const [rel, content] of Object.entries(files)) {
  const full = join(outRoot, rel);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content, 'utf8');
  // eslint-disable-next-line no-console
  console.log(`wrote ${full}`);
}
