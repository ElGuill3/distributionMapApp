// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';

// Resolved from this file so the test does not depend on the working directory;
// STYLES_CSS_PATH lets a check run against another copy of the stylesheet.
const CSS_PATH =
  process.env.STYLES_CSS_PATH ??
  fileURLToPath(new URL('../../src/styles/styles.css', import.meta.url));

const TS_ROOT = fileURLToPath(new URL('../../src/ts', import.meta.url));
const TEMPLATE_PATH = fileURLToPath(
  new URL('../../templates/index.html', import.meta.url)
);

// Class names built from a prefix at runtime, e.g. `flood-swatch-${value}`.
const DYNAMIC_CLASS_PREFIXES = [
  'flood-swatch-',
  'flood-choropleth-',
  'forecast-',
  'tflow-step--',
];

function tsSources(dir = TS_ROOT): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return tsSources(path);
    return path.endsWith('.ts') ? [readFileSync(path, 'utf8')] : [];
  });
}

/** Class names used in rule selectors (comments and declarations ignored). */
function selectorClasses(css: string): Set<string> {
  const classes = new Set<string>();
  postcss.parse(css).walkRules(rule => {
    for (const m of rule.selector.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) classes.add(m[1]);
  });
  return classes;
}

/** Context (enclosing at-rules and rules) of a rule, outermost first. */
function ruleContext(rule: postcss.Rule): string {
  const context: string[] = [];
  for (let p = rule.parent; p && p.type !== 'root'; p = p.parent as postcss.Container) {
    context.unshift(
      p.type === 'atrule'
        ? `@${(p as postcss.AtRule).name} ${(p as postcss.AtRule).params}`
        : (p as postcss.Rule).selector
    );
  }
  return context.join('>');
}

function inKeyframes(rule: postcss.Rule): boolean {
  return (
    rule.parent?.type === 'atrule' &&
    /keyframes$/.test((rule.parent as postcss.AtRule).name)
  );
}

/** Selector lists declared by more than one rule in the same context. */
function repeatedSelectors(css: string): string[] {
  const seen = new Map<string, number>();
  const repeated: string[] = [];
  postcss.parse(css).walkRules(rule => {
    if (inKeyframes(rule)) return;
    const key = `${ruleContext(rule)}|${rule.selectors.join(',')}`;
    if (seen.has(key))
      repeated.push(
        `${rule.selector} (lines ${seen.get(key)} and ${rule.source?.start?.line})`
      );
    else seen.set(key, rule.source?.start?.line ?? 0);
  });
  return repeated;
}

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
          ? `@${(p as postcss.AtRule).name} ${(p as postcss.AtRule).params}`
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

/** Declarations of every top-level rule whose selector list contains `selector`. */
function declarationsFor(css: string, selector: string): Record<string, string> {
  const found: Record<string, string> = {};
  postcss.parse(css).walkRules(rule => {
    if (rule.parent?.type !== 'root' || !rule.selectors.includes(selector)) return;
    rule.walkDecls(d => {
      found[d.prop] = `${d.value}${d.important ? ' !important' : ''}`;
    });
  });
  return found;
}

// Utilities toggled from TypeScript whose loss would change behaviour, not
// only looks: guards against deleting the last copy of a rule.
const CRITICAL_RULES: Record<string, Record<string, string>> = {
  '.hidden': { display: 'none !important' },
  '.sr-only': { position: 'absolute', width: '1px', height: '1px' },
  '.tflow-step.disabled': { 'pointer-events': 'none' },
  '.municipios-grid': { display: 'none' },
  'body.flood-risk-mode-active .municipios-grid': { display: 'grid' },
};

describe('styles.css', () => {
  const css = readFileSync(CSS_PATH, 'utf8');

  it('has no rule repeated verbatim in the same context', () => {
    expect(exactDuplicateRules(css)).toEqual([]);
  });

  it.each(Object.entries(CRITICAL_RULES))('still declares %s', (selector, expected) => {
    expect(declarationsFor(css, selector)).toMatchObject(expected);
  });

  it('declares each selector once per context', () => {
    expect(repeatedSelectors(css)).toEqual([]);
  });

  it('only styles classes the app can render', () => {
    const markup = [...tsSources(), readFileSync(TEMPLATE_PATH, 'utf8')].join('\n');
    const unused = [...selectorClasses(css)].filter(
      name =>
        !name.startsWith('leaflet-') &&
        !DYNAMIC_CLASS_PREFIXES.some(prefix => name.startsWith(prefix)) &&
        !new RegExp(`[\\s'"\`.]${name}(?![\\w-])`).test(markup)
    );
    expect(unused.sort()).toEqual([]);
  });

  it('tells rules under different at-rules with the same params apart', () => {
    const rule = '.x { color: red; }';
    expect(
      exactDuplicateRules(`@media print { ${rule} } @supports print { ${rule} }`)
    ).toEqual([]);
    expect(
      exactDuplicateRules(`@media print { ${rule} } @media print { ${rule} }`)
    ).toHaveLength(1);
  });
});
