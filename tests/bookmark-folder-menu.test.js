import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repo = process.cwd();
const manifest = JSON.parse(readFileSync(resolve(repo, 'manifest.json'), 'utf8'));
const bridge = readFileSync(resolve(repo, 'bridge.js'), 'utf8');
const popupHtml = readFileSync(resolve(repo, 'popup.html'), 'utf8');
const popupJs = readFileSync(resolve(repo, 'popup.js'), 'utf8');
const buildScript = readFileSync(resolve(repo, 'scripts/build-dist.mjs'), 'utf8');

describe('bookmark folder menu integration', () => {
  it('loads bookmark-menu.js in the MAIN-world content script bundle', () => {
    const main = manifest.content_scripts.find((cs) => cs.world === 'MAIN');
    expect(main, 'manifest must have a MAIN-world content_scripts entry').toBeTruthy();
    expect(main.js).toContain('bookmark-menu.js');
  });

  it('ships bookmark-menu.js in dist builds', () => {
    expect(buildScript).toContain("'bookmark-menu.js'");
  });

  it('wires the popup toggle to synced featureBookmarkFolders settings', () => {
    expect(popupHtml).toContain('id="feat-bookmark-folders"');
    expect(popupHtml).toContain('data-i18n="featureBookmarkFoldersTitle"');
    expect(popupJs).toContain("featureBookmarkFolders: false");
    expect(popupJs).toContain("document.getElementById('feat-bookmark-folders')");
    expect(popupJs).toContain('chrome.storage.sync.set({ featureBookmarkFolders: bookmarkFolderToggle.checked }');
  });

  it('bridges folder cache refreshes into the MAIN-world menu script', () => {
    expect(bridge).toContain('featureBookmarkFolders: false');
    expect(bridge).toContain('featureBookmarkFolders: !!raw?.featureBookmarkFolders');
    expect(bridge).toContain("type: 'XVM_FOLDERS_UPDATE'");
    expect(bridge).toContain("type === 'XVM_REQUEST_FOLDER_REFRESH'");
    expect(bridge).toContain('bookmarkFoldersCache');
    expect(bridge).toContain('BookmarkFoldersSlice');
  });
});
