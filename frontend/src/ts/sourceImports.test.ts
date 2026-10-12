import { readFileSync } from 'node:fs';
import { URL as NodeURL } from 'node:url';
import { expect, it } from 'vitest';

it('loads sidebar modules from authored sources rather than generated output', () => {
  const source = readFileSync(new NodeURL('./main.ts', import.meta.url), 'utf8');
  const imports = [...source.matchAll(/import\('([^']*sidebar\/[^']+)'\)/g)].map(
    match => match[1]
  );
  expect(imports).toEqual([
    './sidebar/taskFlow.js',
    './sidebar/variableSelector.js',
    './sidebar/configPanel.js',
    './sidebar/modoSection.js',
  ]);
});
