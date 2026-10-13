// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';

// Resolved from this file so the test does not depend on the working directory;
// STYLES_CSS_PATH lets a check run against another copy of the stylesheet.
const CSS_PATH =
  process.env.STYLES_CSS_PATH ??
  fileURLToPath(new URL('../../src/styles/styles.css', import.meta.url));

/** Flat rules repeated verbatim (selector + declarations) in the same context. */
function exactDuplicateRules(css: string): string[] {
  const root = postcss.parse(css);
  const seen = new Map<string, number>();
  const duplicates: string[] = [];
  root.walkRules(rule => {
    if (
      rule.parent?.type === 'atrule' &&
      /keyframes$/.test((rule.parent as postcss.AtRule).name)
    ) {
      return;
    }
    const context: string[] = [];
    for (
      let p = rule.parent;
      p && p.type !== 'root';
      p = p.parent as postcss.Container
    ) {
      context.unshift(
        p.type === 'atrule'
          ? `@${(p as postcss.AtRule).params}`
          : (p as postcss.Rule).selector
      );
    }
    const decls = rule.nodes
      .filter((n): n is postcss.Declaration => n.type === 'decl')
      .map(d => `${d.prop}:${d.value.replace(/\s+/g, ' ')}${d.important ? '!' : ''}`);
    const key = `${context.join('>')}|${rule.selectors.join(',')}|${decls.join(';')}`;
    if (seen.has(key))
      duplicates.push(
        `${rule.selector} (lines ${seen.get(key)} and ${rule.source?.start?.line})`
      );
    else seen.set(key, rule.source?.start?.line ?? 0);
  });
  return duplicates;
}

describe('styles.css', () => {
  it('has no rule repeated verbatim in the same context', () => {
    expect(exactDuplicateRules(readFileSync(CSS_PATH, 'utf8'))).toEqual([]);
  });
});
