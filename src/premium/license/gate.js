// === Premium tier gate (M1 step 1 stub) ===
//
// Single source of truth for "what tier is the current user?". Premium
// feature modules MUST query this gate at activation time and NEVER make
// their own tier decisions — that invariant lets us swap the implementation
// later (real Creem license check + 14-day trial + 24h cache) without
// touching feature modules.
//
// Step 1 hardcodes the tier to 'trial' so the rate-filter module can be
// integrated and exercised end-to-end. Step 2 replaces this stub with the
// real check (ADR-0004 pending @Codex).
//
// API (window.__xvmPro):
//   getCurrentTier()          → 'free' | 'trial' | 'pro'
//   onTierChange(fn)          → subscribe; fn(tier) on every change
//   isFeatureEnabled(name)    → boolean; central feature map
//
// Loaded in MAIN world before any premium feature script. See manifest.

(() => {
  if (window.__xvmPro) return; // idempotent on hot reload

  // Feature → minimum tier required.
  // 'free' = always on. Anything else gates by getCurrentTier().
  const FEATURE_TIER = {
    'rate-filter': 'trial', // M1 paid feature
  };

  // Step 1 stub: always report 'trial'. Replaced in step 2 with the real
  // Creem license + trial-window check.
  let _currentTier = 'trial';
  const _subs = [];

  function getCurrentTier() {
    return _currentTier;
  }

  function isFeatureEnabled(name) {
    const need = FEATURE_TIER[name];
    if (!need || need === 'free') return true;
    const tier = getCurrentTier();
    // 'free' < 'trial' < 'pro'. Any of trial/pro unlocks paid features.
    if (need === 'trial') return tier === 'trial' || tier === 'pro';
    if (need === 'pro') return tier === 'pro';
    return false;
  }

  function onTierChange(fn) {
    if (typeof fn === 'function') _subs.push(fn);
  }

  function _setTier(next) {
    // Internal — step 2 license module calls this when license/trial state
    // changes. Step 1 stub never calls it.
    if (next === _currentTier) return;
    _currentTier = next;
    for (const fn of _subs) {
      try { fn(next); } catch (_) {}
    }
  }

  window.__xvmPro = {
    getCurrentTier,
    isFeatureEnabled,
    onTierChange,
    _setTier, // step 2 use only
    _FEATURE_TIER: FEATURE_TIER,
  };
})();
