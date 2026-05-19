// #45 step 3 follow-up — rate-filter popup settings UI.
// User dev1 test caught: PoC popup settings UI was not migrated to xvm.
// This test pins the wiring so it can't silently drop again.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..');
const html      = readFileSync(resolve(repo, 'popup.html'), 'utf8');
const popupRf   = readFileSync(resolve(repo, 'src/premium/rate-filter/popup-rate-filter.js'), 'utf8');
const filter    = readFileSync(resolve(repo, 'src/premium/rate-filter/filter.js'), 'utf8');
const isolated  = readFileSync(resolve(repo, 'src/premium/license/isolated.js'), 'utf8');
const manifest  = JSON.parse(readFileSync(resolve(repo, 'manifest.json'), 'utf8'));

describe('#45 rate-filter popup settings (dev1 gap fix)', () => {
  it('popup.html includes #rate-filter-section and loads popup-rate-filter.js', () => {
    expect(/id="rate-filter-section"/.test(html),
      'popup.html must contain <section id="rate-filter-section">'
    ).toBe(true);
    expect(/<script\s+src="src\/premium\/rate-filter\/popup-rate-filter\.js"/.test(html),
      'popup.html must load popup-rate-filter.js'
    ).toBe(true);
  });

  it('popup-rate-filter.js owns xvm_rate_filter_v1 storage key', () => {
    expect(/STORAGE_KEY\s*=\s*['"]xvm_rate_filter_v1['"]/.test(popupRf),
      'popup-rate-filter.js must declare STORAGE_KEY = "xvm_rate_filter_v1"'
    ).toBe(true);
  });

  it('popup-rate-filter.js defaults match locked decisions (#45)', () => {
    // enabled defaults to false (opt-in)
    expect(/enabled:\s*false/.test(popupRf),
      'default enabled must be false (opt-in per locked decision)'
    ).toBe(true);
    // Short: 50 / 10000, Long: 10 / 2000 (PoC defaults)
    expect(/shortRateThreshold:\s*50/.test(popupRf)).toBe(true);
    expect(/shortAbsoluteThreshold:\s*10000/.test(popupRf)).toBe(true);
    expect(/longRateThreshold:\s*10/.test(popupRf)).toBe(true);
    expect(/longAbsoluteThreshold:\s*2000/.test(popupRf)).toBe(true);
  });

  it('popup-rate-filter.js is tier-aware (locks form when free)', () => {
    expect(/setLocked\s*\(/.test(popupRf),
      'must define setLocked()'
    ).toBe(true);
    expect(/tier\s*===\s*['"]free['"]/.test(popupRf),
      'must check tier === "free" to set locked'
    ).toBe(true);
    expect(/__xvmTierLogic/.test(popupRf),
      'must use tier-logic.js for tier resolution (not its own)'
    ).toBe(true);
  });

  it('isolated.js forwards rate-filter settings to MAIN world', () => {
    expect(/RATE_FILTER_KEY\s*=\s*['"]xvm_rate_filter_v1['"]/.test(isolated),
      'isolated.js must declare RATE_FILTER_KEY'
    ).toBe(true);
    expect(/XVM_RATE_SETTINGS_UPDATE/.test(isolated),
      'isolated.js must emit XVM_RATE_SETTINGS_UPDATE postMessage'
    ).toBe(true);
    expect(/pushRateSettings/.test(isolated),
      'isolated.js must have pushRateSettings() helper'
    ).toBe(true);
  });

  it('filter.js listens for XVM_RATE_SETTINGS_UPDATE and calls updateSettings', () => {
    expect(/XVM_RATE_SETTINGS_UPDATE/.test(filter),
      'filter.js must listen for XVM_RATE_SETTINGS_UPDATE'
    ).toBe(true);
    expect(/updateSettings\s*\(\s*event\.data\.settings/.test(filter),
      'filter.js must call updateSettings(event.data.settings) on the message'
    ).toBe(true);
  });

  it('manifest loads popup-rate-filter.js NEVER (popup-only)', () => {
    // popup-rate-filter.js is a popup-context script; it must NOT appear
    // in manifest content_scripts (would run on x.com unnecessarily and
    // attempt to access DOM elements that don't exist there).
    for (const cs of manifest.content_scripts || []) {
      const js = cs.js || [];
      expect(js.includes('src/premium/rate-filter/popup-rate-filter.js'),
        'popup-rate-filter.js must NOT be in content_scripts (popup-only)'
      ).toBe(false);
    }
  });

  it('i18n keys for rate filter present in en + zh_CN locales', () => {
    const en = JSON.parse(readFileSync(resolve(repo, '_locales/en/messages.json'), 'utf8'));
    const zh = JSON.parse(readFileSync(resolve(repo, '_locales/zh_CN/messages.json'), 'utf8'));
    const required = [
      'rfTitle', 'rfLockedHint', 'rfEnabled',
      'rfScopeLegend', 'rfScopeHome', 'rfScopeList',
      'rfShortLegend', 'rfLongLegend',
      'rfRatePerMin', 'rfAbsoluteViews',
      'rfRuleHint', 'rfReset', 'rfSave', 'rfSavedOk', 'rfResetOk',
    ];
    for (const k of required) {
      expect(en[k]?.message, `en must declare ${k}`).toBeTruthy();
      expect(zh[k]?.message, `zh_CN must declare ${k}`).toBeTruthy();
    }
  });
});
