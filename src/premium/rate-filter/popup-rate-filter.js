// === Rate filter settings (popup context) ===
//
// Renders the rate-filter settings form below the Pro tier banner. Owns
// chrome.storage.local.xvm_rate_filter_v1; isolated.js watches that key
// and pushes XVM_RATE_SETTINGS_UPDATE to MAIN-world filter.js.
//
// Tier-aware: when getCurrentTier() ∈ {trial, pro} the form is editable;
// when 'free' the form is shown but disabled with an "upgrade to unlock"
// hint above it. Settings persist across tier changes so a user who
// upgrades sees their previous configuration restored.

(function () {
  const STORAGE_KEY = 'xvm_rate_filter_v1';

  const DEFAULTS = {
    enabled: false,           // opt-in per locked decision 2026-05-19
    shortRateThreshold: 50,
    shortAbsoluteThreshold: 10000,
    longRateThreshold: 10,
    longAbsoluteThreshold: 2000,
    scopeHome: true,
    scopeList: true,
  };

  const BOOL_KEYS = ['enabled', 'scopeHome', 'scopeList'];
  const NUM_KEYS  = ['shortRateThreshold', 'shortAbsoluteThreshold',
                     'longRateThreshold',  'longAbsoluteThreshold'];

  function t(key, ...subs) {
    try {
      const v = chrome?.i18n?.getMessage?.(key, subs.length ? subs.map(String) : undefined);
      if (v) return v;
    } catch (_) {}
    return key;
  }

  function storageGet(key, fallback) {
    return new Promise((resolve) => {
      try { chrome.storage.local.get(key, (o) => resolve(o?.[key] ?? fallback)); }
      catch (_) { resolve(fallback); }
    });
  }
  function storageSet(obj) {
    return new Promise((resolve) => {
      try { chrome.storage.local.set(obj, resolve); }
      catch (_) { resolve(); }
    });
  }

  function normalize(raw) {
    const out = { ...DEFAULTS };
    if (!raw || typeof raw !== 'object') return out;
    for (const k of BOOL_KEYS) if (k in raw) out[k] = raw[k] !== false;
    for (const k of NUM_KEYS) {
      const v = Number(raw[k]);
      out[k] = Number.isFinite(v) && v >= 0 ? v : DEFAULTS[k];
    }
    return out;
  }

  // Resolve tier independently (popup-pro.js already uses tier-logic.js for
  // banner; we can read again — cheap, and avoids cross-script coupling).
  async function resolveTier() {
    const TL = globalThis.__xvmTierLogic;
    if (!TL) return { tier: 'free', daysLeft: 0, source: 'tier-logic-missing' };
    const lic = await storageGet('xvm_license_v1', null);
    const trial = await storageGet('xvm_trial_v1', null);
    return TL.resolveTierFrom(lic, trial, Date.now());
  }

  function buildSection() {
    const section = document.getElementById('rate-filter-section');
    if (!section) return null;
    section.innerHTML = `
      <h2 class="rf-title" data-k="rfTitle"></h2>
      <p class="rf-locked-hint" id="rf-locked-hint" data-k="rfLockedHint" hidden></p>

      <label class="rf-row rf-toggle">
        <input type="checkbox" id="rf-enabled" />
        <span data-k="rfEnabled"></span>
      </label>

      <fieldset class="rf-fieldset">
        <legend data-k="rfScopeLegend"></legend>
        <label class="rf-row"><input type="checkbox" id="rf-scopeHome" /> <span data-k="rfScopeHome"></span></label>
        <label class="rf-row"><input type="checkbox" id="rf-scopeList" /> <span data-k="rfScopeList"></span></label>
      </fieldset>

      <fieldset class="rf-fieldset">
        <legend data-k="rfShortLegend"></legend>
        <label class="rf-row"><span data-k="rfRatePerMin"></span> <input type="number" id="rf-shortRateThreshold" min="0" step="1" /></label>
        <label class="rf-row"><span data-k="rfAbsoluteViews"></span> <input type="number" id="rf-shortAbsoluteThreshold" min="0" step="100" /></label>
      </fieldset>

      <fieldset class="rf-fieldset">
        <legend data-k="rfLongLegend"></legend>
        <label class="rf-row"><span data-k="rfRatePerMin"></span> <input type="number" id="rf-longRateThreshold" min="0" step="1" /></label>
        <label class="rf-row"><span data-k="rfAbsoluteViews"></span> <input type="number" id="rf-longAbsoluteThreshold" min="0" step="100" /></label>
      </fieldset>

      <p class="rf-rule-hint" data-k="rfRuleHint"></p>

      <div class="rf-actions">
        <button type="button" id="rf-reset" class="rf-btn-ghost" data-k="rfReset"></button>
        <button type="button" id="rf-save"  class="rf-btn"       data-k="rfSave"></button>
      </div>
      <div class="rf-msg" id="rf-msg"></div>
    `;
    section.querySelectorAll('[data-k]').forEach((el) => { el.textContent = t(el.dataset.k); });
    return section;
  }

  function applyTo(section, settings) {
    for (const k of BOOL_KEYS) section.querySelector('#rf-' + k).checked = !!settings[k];
    for (const k of NUM_KEYS)  section.querySelector('#rf-' + k).value   = settings[k];
  }
  function readFrom(section) {
    const out = {};
    for (const k of BOOL_KEYS) out[k] = section.querySelector('#rf-' + k).checked;
    for (const k of NUM_KEYS)  {
      const v = Number(section.querySelector('#rf-' + k).value);
      out[k] = Number.isFinite(v) && v >= 0 ? v : DEFAULTS[k];
    }
    return out;
  }

  function setLocked(section, locked) {
    section.dataset.locked = locked ? '1' : '0';
    const inputs = section.querySelectorAll('input, button');
    for (const el of inputs) el.disabled = !!locked;
    const hint = section.querySelector('#rf-locked-hint');
    if (hint) hint.hidden = !locked;
  }

  async function mount() {
    const section = buildSection();
    if (!section) return;

    const stored = normalize(await storageGet(STORAGE_KEY, DEFAULTS));
    applyTo(section, stored);

    const { tier } = await resolveTier();
    setLocked(section, tier === 'free');

    section.querySelector('#rf-save').addEventListener('click', async () => {
      const payload = readFrom(section);
      await storageSet({ [STORAGE_KEY]: payload });
      const msg = section.querySelector('#rf-msg');
      msg.textContent = t('rfSavedOk');
      msg.dataset.kind = 'ok';
      setTimeout(() => { msg.textContent = ''; delete msg.dataset.kind; }, 1500);
    });

    section.querySelector('#rf-reset').addEventListener('click', async () => {
      applyTo(section, DEFAULTS);
      await storageSet({ [STORAGE_KEY]: DEFAULTS });
      const msg = section.querySelector('#rf-msg');
      msg.textContent = t('rfResetOk');
      msg.dataset.kind = 'ok';
      setTimeout(() => { msg.textContent = ''; delete msg.dataset.kind; }, 1500);
    });

    // Re-evaluate lock when tier changes (license activation / deactivation
    // happens in the same popup; storage onChanged fires).
    try {
      chrome.storage.onChanged.addListener(async (changes, area) => {
        if (area !== 'local') return;
        if ('xvm_license_v1' in changes || 'xvm_trial_v1' in changes) {
          const r = await resolveTier();
          setLocked(section, r.tier === 'free');
        }
        if (STORAGE_KEY in changes) {
          const next = normalize(changes[STORAGE_KEY].newValue);
          applyTo(section, next);
        }
      });
    } catch (_) {}
  }

  document.addEventListener('DOMContentLoaded', mount);

  // Expose for popup.js / tests.
  window.__xvmRateFilterPopup = { STORAGE_KEY, DEFAULTS, mount };
})();
