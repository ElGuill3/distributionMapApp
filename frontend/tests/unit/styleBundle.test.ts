// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readStyleBundle } from '../../scripts/bundle-styles.mjs';

describe('readStyleBundle', () => {
  let dir: string;
  let entry: string;

  function partial(name: string, css: string): void {
    writeFileSync(join(dir, 'partials', name), css);
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'styles-'));
    mkdirSync(join(dir, 'partials'));
    entry = join(dir, 'styles.css');
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('joins the listed partials in order with one blank line between them', () => {
    partial('b.css', '.b {\n  color: blue;\n}\n');
    partial('a.css', '.a {\n  color: red;\n}\n');
    writeFileSync(
      entry,
      "/* Order matters. */\n@import './partials/b.css';\n@import './partials/a.css';\n"
    );

    const bundle = readStyleBundle(entry);

    expect(bundle.css).toBe('.b {\n  color: blue;\n}\n\n.a {\n  color: red;\n}\n');
    expect(bundle.files).toEqual(['partials/b.css', 'partials/a.css']);
  });

  it('maps a bundle line back to its partial and line', () => {
    partial('b.css', '.b {\n  color: blue;\n}\n');
    partial('a.css', '.a {\n  color: red;\n}\n');
    writeFileSync(entry, "@import './partials/b.css';\n@import './partials/a.css';\n");

    const { locate } = readStyleBundle(entry);

    expect(locate(1)).toBe('partials/b.css:1');
    expect(locate(5)).toBe('partials/a.css:1');
    expect(locate(7)).toBe('partials/a.css:3');
  });

  it('fails when a listed partial does not exist', () => {
    writeFileSync(entry, "@import './partials/missing.css';\n");

    expect(() => readStyleBundle(entry)).toThrow(/partials\/missing\.css/);
  });

  it('fails when a partial is not listed, so no file is silently left out', () => {
    partial('a.css', '.a {\n  color: red;\n}\n');
    partial('orphan.css', '.o {\n  color: red;\n}\n');
    writeFileSync(entry, "@import './partials/a.css';\n");

    expect(() => readStyleBundle(entry)).toThrow(/partials\/orphan\.css/);
  });

  it('fails when the same partial is listed twice', () => {
    partial('a.css', '.a {\n  color: red;\n}\n');
    writeFileSync(entry, "@import './partials/a.css';\n@import './partials/a.css';\n");

    expect(() => readStyleBundle(entry)).toThrow(/listed twice/);
  });

  it('bundles the app stylesheet without leftover imports', () => {
    const bundle = readStyleBundle();

    expect(bundle.files.length).toBeGreaterThan(1);
    expect(bundle.css).not.toMatch(/@import/);
  });
});
