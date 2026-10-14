// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';
import { readStyleBundle } from '../../scripts/bundle-styles.mjs';

// The served stylesheet: the partials listed in src/styles/styles.css, joined.
// STYLES_CSS_PATH lets a check run against a single bundled copy instead.
type Locate = (line: number) => string;
const byLine: Locate = line => `line ${line}`;

const BUNDLE = process.env.STYLES_CSS_PATH
  ? {
      css: readFileSync(process.env.STYLES_CSS_PATH, 'utf8'),
      locate: byLine,
    }
  : readStyleBundle();

const TS_ROOT = fileURLToPath(new URL('../../src/ts', import.meta.url));
const TEMPLATE_PATH = fileURLToPath(
  new URL('../../templates/index.html', import.meta.url)
);

// Class names built at runtime, so no source spells them out: numbered flood
// classes (`flood-swatch-${value}`) and the forecast freshness states
// (`forecast-${freshness}`). Keep these exact so other classes stay checked.
const DYNAMIC_CLASS_PREFIXES = ['flood-swatch-', 'flood-choropleth-'];
const DYNAMIC_CLASSES = ['forecast-fresh', 'forecast-stale'];

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
function repeatedSelectors(css: string, where: Locate = byLine): string[] {
  const seen = new Map<string, number>();
  const repeated: string[] = [];
  postcss.parse(css).walkRules(rule => {
    if (inKeyframes(rule)) return;
    const key = `${ruleContext(rule)}|${rule.selectors.join(',')}`;
    if (seen.has(key))
      repeated.push(
        `${rule.selector} (${where(seen.get(key) ?? 0)} and ${where(rule.source?.start?.line ?? 0)})`
      );
    else seen.set(key, rule.source?.start?.line ?? 0);
  });
  return repeated;
}

/** Flat rules repeated verbatim (selector + declarations) in the same context. */
function exactDuplicateRules(css: string, where: Locate = byLine): string[] {
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
        `${rule.selector} (${where(seen.get(key) ?? 0)} and ${where(rule.source?.start?.line ?? 0)})`
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
  const css = BUNDLE.css;

  it('has no rule repeated verbatim in the same context', () => {
    expect(exactDuplicateRules(css, BUNDLE.locate)).toEqual([]);
  });

  it.each(Object.entries(CRITICAL_RULES))('still declares %s', (selector, expected) => {
    expect(declarationsFor(css, selector)).toMatchObject(expected);
  });

  it('declares each selector once per context', () => {
    expect(repeatedSelectors(css, BUNDLE.locate)).toEqual([]);
  });

  // Reads string-literal arguments of classList.add/remove/toggle only; names
  // built from template literals or set through className are not checked.
  it('styles every class that TypeScript toggles', () => {
    const styled = selectorClasses(css);
    const toggled = new Set<string>();
    for (const src of tsSources()) {
      for (const call of src.matchAll(/classList\.(?:add|remove|toggle)\(([^)]*)\)/g)) {
        for (const name of call[1].matchAll(
          /^\s*['"]([\w-]+)['"]|,\s*['"]([\w-]+)['"]/g
        ))
          toggled.add(name[1] ?? name[2]);
      }
    }
    expect([...toggled].filter(name => !styled.has(name)).sort()).toEqual([]);
  });

  it('only styles classes the app can render', () => {
    const markup = [...tsSources(), readFileSync(TEMPLATE_PATH, 'utf8')].join('\n');
    const unused = [...selectorClasses(css)].filter(
      name =>
        !name.startsWith('leaflet-') &&
        !DYNAMIC_CLASS_PREFIXES.some(prefix => name.startsWith(prefix)) &&
        !DYNAMIC_CLASSES.includes(name) &&
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
