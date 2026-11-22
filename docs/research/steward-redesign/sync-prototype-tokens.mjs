import fs from 'node:fs';

// Keep the downloadable HTML self-contained without maintaining a second palette.
const tokens = JSON.parse(fs.readFileSync(new URL('./tokens.json', import.meta.url), 'utf8'));
const prototype = new URL('./prototype.html', import.meta.url);
const source = fs.readFileSync(prototype, 'utf8');
const aliases = {
  bg: 'canvas', rail: 'rail', surface: 'surface', 'surface-2': 'surfaceRaised',
  ink: 'ink', muted: 'muted', line: 'border', strong: 'borderStrong',
  'control-border': 'controlBorder', brand: 'action', 'brand-hover': 'actionHover',
  'brand-ink': 'actionInk', soft: 'selection', green: 'success', amber: 'warning',
  'amber-bg': 'warningSurface', red: 'danger', 'red-bg': 'dangerSurface',
  blue: 'progress', 'blue-bg': 'progressSurface', scrim: 'scrim'
};
const rules = Object.entries(tokens.themes).map(([name, theme]) => {
  const colors = Object.entries(aliases).map(([alias, key]) => {
    if (!/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(theme[key])) throw new Error(`Invalid ${name}.${key}`);
    return `--${alias}:${theme[key]}`;
  });
  const selector = name === 'light' ? ':root' : '[data-theme=dark]';
  return `${selector}{color-scheme:${name};${colors.join(';')};--radius:${tokens.layout.panelRadiusPx}px;--font:${tokens.typography.family.join(',')};--shadow:${tokens.depth.shadow}}`;
});
const block = `/* BEGIN GENERATED TOKENS: edit tokens.json, then run sync-prototype-tokens.mjs */\n${rules.join('\n')}\n/* END GENERATED TOKENS */`;
const marker = /\/\* BEGIN GENERATED TOKENS:[\s\S]*?\/\* END GENERATED TOKENS \*\//;
if (!marker.test(source)) throw new Error('Generated palette markers not found');
const output = source.replace(marker, block);
if (process.argv.includes('--check')) {
  if (source !== output) throw new Error('Prototype palette drift: run node docs/research/steward-redesign/sync-prototype-tokens.mjs');
  console.log('Prototype palette matches canonical tokens.json');
} else {
  fs.writeFileSync(prototype, output);
  console.log('Updated self-contained prototype palette from tokens.json');
}
