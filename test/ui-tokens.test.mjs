import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { test } from 'node:test';

const publicDir = new URL('../public/', import.meta.url);
const tokensUrl = new URL('tokens.css', publicDir);
const colorLiteralPattern = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\s*\(/gi;
const varUsagePattern = /var\(\s*(--[a-zA-Z0-9_-]+)/g;
const tokenDefinitionPattern = /(--[a-zA-Z0-9_-]+)\s*:/g;
const declarationPattern = /^\s*(--[a-zA-Z0-9_-]+)\s*:\s*([^;]+);/gm;

const expectedTokens = {
  '--md-sys-color-primary': '#005bc0',
  '--md-sys-color-on-primary': '#ffffff',
  '--md-sys-color-primary-container': '#d8e2ff',
  '--md-sys-color-on-primary-container': '#001a41',
  '--md-sys-color-secondary': '#565e71',
  '--md-sys-color-on-secondary': '#ffffff',
  '--md-sys-color-secondary-container': '#dbe2f9',
  '--md-sys-color-on-secondary-container': '#131b2c',
  '--md-sys-color-tertiary': '#715574',
  '--md-sys-color-on-tertiary': '#ffffff',
  '--md-sys-color-tertiary-container': '#fbd7fc',
  '--md-sys-color-on-tertiary-container': '#29132d',
  '--md-sys-color-error': '#ba1a1a',
  '--md-sys-color-on-error': '#ffffff',
  '--md-sys-color-error-container': '#ffdad6',
  '--md-sys-color-on-error-container': '#410002',
  '--md-sys-color-background': '#fefbff',
  '--md-sys-color-on-background': '#1b1b1f',
  '--md-sys-color-surface': '#fefbff',
  '--md-sys-color-on-surface': '#1b1b1f',
  '--md-sys-color-surface-variant': '#e1e2ec',
  '--md-sys-color-on-surface-variant': '#44474f',
  '--md-sys-color-outline': '#74777f',
  '--md-sys-color-outline-variant': '#c4c6d0',
  '--md-sys-color-shadow': '#000000',
  '--md-sys-color-scrim': '#000000',
  '--md-sys-color-inverse-surface': '#303033',
  '--md-sys-color-inverse-on-surface': '#f2f0f4',
  '--md-sys-color-inverse-primary': '#adc7ff',
  '--md-sys-color-surface-container-lowest': '#ffffff',
  '--md-sys-color-surface-container-low': '#f5f3f7',
  '--md-sys-color-surface-container': '#efedf1',
  '--md-sys-color-surface-container-high': '#e9e7ec',
  '--md-sys-color-surface-container-highest': '#e3e2e6',
  '--md-sys-color-surface-dim': '#dbd9dd',
  '--md-sys-color-surface-bright': '#faf9fd',
  '--app-color-connecting': '#7a4e00',
  '--app-color-connected': '#1b7f3a',
  '--app-color-disconnected': '#ba1a1a',
  '--app-player-1': '#005bc0',
  '--app-player-2': '#b3261e',
  '--app-player-3': '#1b7f3a',
  '--app-player-4': '#7a4e00',
  '--app-player-5': '#715574',
  '--app-player-6': '#006b6b',
  '--app-player-7': '#8e457a',
  '--app-player-8': '#3f5e00',
  '--app-player-outline': 'var(--md-sys-color-surface)',
};

async function listPublicFiles(dir = publicDir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const url = new URL(entry.name, dir);
    if (entry.isDirectory()) {
      files.push(...await listPublicFiles(new URL(`${entry.name}/`, dir)));
    } else {
      files.push(url);
    }
  }
  return files;
}

async function readPublicFiles() {
  const files = await listPublicFiles();
  return Promise.all(files.map(async (url) => ({
    name: url.pathname.replace(/^.*\/public\//, ''),
    isTokens: url.pathname === tokensUrl.pathname,
    text: await readFile(url, 'utf8'),
  })));
}

function lineAt(text, index) {
  return text.slice(0, index).split('\n').length;
}

test('color literals are confined to public/tokens.css', async () => {
  const files = await readPublicFiles();
  const offenders = [];
  for (const file of files) {
    if (file.isTokens) continue;
    for (const match of file.text.matchAll(colorLiteralPattern)) {
      offenders.push(`${file.name}:${lineAt(file.text, match.index)}: ${match[0]}`);
    }
  }
  assert.deepEqual(offenders, [], `Found color literals outside tokens.css:\n${offenders.join('\n')}`);
});

test('every var() reference in public/ is defined in tokens.css', async () => {
  const files = await readPublicFiles();
  const tokensFile = files.find((file) => file.isTokens);
  assert.ok(tokensFile, 'public/tokens.css must exist');
  const definitions = new Set(
    [...tokensFile.text.matchAll(tokenDefinitionPattern)].map((match) => match[1]),
  );
  const missing = [];
  for (const file of files) {
    for (const match of file.text.matchAll(varUsagePattern)) {
      const token = match[1];
      if (!definitions.has(token)) {
        missing.push(`${file.name}:${lineAt(file.text, match.index)}: ${token}`);
      }
    }
  }
  assert.deepEqual(missing, [], `Found undefined tokens:\n${missing.join('\n')}`);
});

test('tokens.css contains the approved light palette', async () => {
  const tokensSource = await readFile(tokensUrl, 'utf8');
  const declared = new Map(
    [...tokensSource.matchAll(declarationPattern)].map((match) => [match[1], match[2].trim()]),
  );
  for (const [name, value] of Object.entries(expectedTokens)) {
    assert.equal(declared.get(name), value, `${name} must be ${value}`);
  }
});
