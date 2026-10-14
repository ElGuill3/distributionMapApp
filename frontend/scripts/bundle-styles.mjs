// Joins the stylesheet partials listed in frontend/src/styles/styles.css into
// the single file the app serves. The entry is an ordered list of
// `@import './partials/<name>.css';` lines; any other line (comments) is
// ignored. Order is the cascade order, so the list must not be sorted.
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const STYLES_ENTRY = fileURLToPath(
  new URL('../src/styles/styles.css', import.meta.url)
);

const IMPORT_LINE = /^@import\s+['"]\.\/(.+\.css)['"];\s*$/;

/**
 * @typedef {object} StyleBundle
 * @property {string} css The partials joined with one blank line between them.
 * @property {string[]} files Partials in cascade order, relative to the entry.
 * @property {(line: number) => string} locate Maps a 1-based bundle line to
 *   `partial:line`.
 */

/**
 * Read the entry and every partial it lists.
 * @param {string} [entry]
 * @returns {StyleBundle}
 */
export function readStyleBundle(entry = STYLES_ENTRY) {
  const base = path.dirname(entry);
  const files = [];
  for (const line of readFileSync(entry, 'utf8').split('\n')) {
    const match = IMPORT_LINE.exec(line.trim());
    if (!match) continue;
    if (files.includes(match[1]))
      throw new Error(`${match[1]} is listed twice in ${entry}`);
    files.push(match[1]);
  }
  if (files.length === 0) throw new Error(`${entry} lists no partials`);

  // A partial left out of the list would silently drop its rules.
  const listed = new Set(files);
  for (const dir of new Set(files.map(file => path.dirname(file)))) {
    for (const name of readdirSync(path.join(base, dir))) {
      const file = path.posix.join(dir, name);
      if (name.endsWith('.css') && !listed.has(file))
        throw new Error(`${file} is not listed in ${entry}`);
    }
  }

  const starts = [];
  const parts = [];
  let nextLine = 1;
  for (const file of files) {
    let text;
    try {
      text = readFileSync(path.join(base, file), 'utf8');
    } catch (error) {
      throw new Error(`${file} listed in ${entry} cannot be read: ${error.message}`);
    }
    if (!text.endsWith('\n')) text += '\n';
    starts.push(nextLine);
    parts.push(text);
    // Each partial adds its own lines plus the blank separator line.
    nextLine += text.split('\n').length;
  }

  return {
    css: parts.join('\n'),
    files,
    locate(line) {
      let index = 0;
      while (index + 1 < starts.length && starts[index + 1] <= line) index++;
      return `${files[index]}:${line - starts[index] + 1}`;
    },
  };
}
