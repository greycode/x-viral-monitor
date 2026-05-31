#!/usr/bin/env node
// Package the current channel build into ./release for manual upload.
//
// Usage: node scripts/package-zip.mjs --channel store|community-dev

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'dist');
const releaseDir = resolve(root, 'release');
const CHANNELS = new Set(['store', 'community-dev']);

function readChannel(argv) {
  const idx = argv.indexOf('--channel');
  const raw = idx >= 0 ? argv[idx + 1] : 'store';
  if (!CHANNELS.has(raw)) {
    throw new Error(`[package-zip] invalid --channel ${raw || '(missing)'}; expected store or community-dev`);
  }
  return raw;
}

function zipName(channel) {
  const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
  const suffix = channel === 'community-dev' ? 'community-dev' : 'chrome-web-store';
  return `x-viral-monitor-v${pkg.version}-${suffix}.zip`;
}

function main() {
  const channel = readChannel(process.argv.slice(2));
  if (!existsSync(dist)) throw new Error('[package-zip] dist/ missing; run build first');
  mkdirSync(releaseDir, { recursive: true });
  const out = resolve(releaseDir, zipName(channel));
  if (existsSync(out)) rmSync(out, { force: true });

  if (process.platform === 'win32') {
    const command = [
      '$ErrorActionPreference = "Stop";',
      `$items = Get-ChildItem -LiteralPath '${dist.replaceAll("'", "''")}';`,
      `Compress-Archive -Path $items.FullName -DestinationPath '${out.replaceAll("'", "''")}' -CompressionLevel Optimal`,
    ].join(' ');
    execFileSync('powershell', ['-NoProfile', '-Command', command], { stdio: 'inherit' });
  } else {
    execFileSync('zip', ['-r', out, '.'], { cwd: dist, stdio: 'inherit' });
  }
  console.log(`[package-zip] wrote ${out}`);
}

main();
