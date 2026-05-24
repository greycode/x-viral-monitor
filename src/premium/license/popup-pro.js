// === XVM Pro popup wiring (popup context) ===
//
// Renders the tier banner + license activation/management section in the
// extension popup. Popup runs in extension context so it has direct
// chrome.storage + fetch access — but we keep tier resolution logic
// IDENTICAL to src/premium/license/isolated.js to maintain the ADR-0004
// "single tier resolution path" invariant in spirit (any future change to
// tier rules must be made in BOTH places, which the license-slice tests
// will catch via duplicated invariant assertions).
//
// Buy URLs (Creem checkout). Product IDs are still the pre-price-change IDs
// until the $2.9/mo and $29/yr Creem products are created and wired.
//   Monthly $2.9 display — prod_7f7t9EHK3RJlOK37DWr7J (TODO: replace product id)
//   Annual  $29 display  — prod_69yTiXGXb04DKm46DNVbN9 (TODO: replace product id)

(() => {
  const LICENSE_PROXY_URL = 'https://xmp-license.lengkuxiaomao.workers.dev';
  const BUY_URL_MONTHLY = 'https://www.creem.io/payment/prod_7f7t9EHK3RJlOK37DWr7J';
  const BUY_URL_ANNUAL  = 'https://www.creem.io/payment/prod_69yTiXGXb04DKm46DNVbN9';
  console.warn('[xvm pro] Checkout URLs still use old Creem product IDs; replace when $2.9/mo and $29/yr products are available.');

  // All tier-resolution logic lives in tier-logic.js (loaded BEFORE us via
  // <script> in popup.html). Single source of truth; eliminates mirror
  // drift between this file and isolated.js.
  const TL = globalThis.__xvmTierLogic;
  if (!TL) {
    console.error('[xvm pro] tier-logic.js not loaded before popup-pro.js — popup.html script order broken');
    return;
  }
  const { isXvmProduct, licenseStatusFrom, resolveTierFrom } = TL;

  const STORAGE_KEY = 'xvm_license_v1';
  const TRIAL_KEY = 'xvm_trial_v1';
  const KEY_RE = /^[A-Za-z0-9_\-]{8,128}$/;

  // chrome.i18n wrapper — falls back to the key itself if the locale file
  // is missing the entry (defensive; never block rendering on a stray
  // i18n miss).
  function t(key, ...subs) {
    try {
      const v = chrome?.i18n?.getMessage?.(key, subs.length ? subs.map(String) : undefined);
      if (v) return v;
    } catch (_) {}
    return key;
  }

  // ─── chrome.storage promises ────────────────────────────────────────
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
  // Non-blocker #2 fix: deactivate previously used a bare chrome.storage.local.remove.
  // Wrap consistently so an unavailable storage layer doesn't throw.
  function storageRemove(key) {
    return new Promise((resolve) => {
      try { chrome.storage.local.remove(key, resolve); }
      catch (_) { resolve(); }
    });
  }

  // ─── Tier resolver — delegates to tier-logic.js pure helpers ────────
  async function resolveTier() {
    const stored = await storageGet(STORAGE_KEY, null);
    const trial  = await storageGet(TRIAL_KEY, null);
    // Non-blocker #3 fix: tier-logic.js threads lic.source (expired /
    // wrong_product / etc.) through the free path, so popup diagnostics
    // are now accurate.
    return resolveTierFrom(stored, trial, Date.now());
  }

  // ─── Activate via Worker proxy ──────────────────────────────────────
  async function activate(rawKey) {
    const key = String(rawKey || '').trim();
    if (!KEY_RE.test(key)) return { ok: false, error: 'invalid_format' };
    if (LICENSE_PROXY_URL === '__XVM_LICENSE_WORKER__') {
      return { ok: false, error: 'worker_url_unset' };
    }
    let deviceId = await storageGet('xvm_device_id', null);
    if (!deviceId) {
      deviceId = crypto.randomUUID();
      await storageSet({ xvm_device_id: deviceId });
    }
    let envelope;
    try {
      const res = await fetch(`${LICENSE_PROXY_URL}/activate`, {
        method: 'POST',
        headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, instance_name: `Popup — ${deviceId.slice(0, 8)}` }),
      });
      envelope = await res.json();
    } catch (e) {
      return { ok: false, error: 'network', message: String(e?.message || e) };
    }
    if (!envelope?.ok) return { ok: false, error: 'activation_failed', detail: envelope };
    const data = envelope.data || {};
    if (data.product_id && !isXvmProduct(data.product_id)) {
      return { ok: false, error: 'wrong_product', detail: { actual: data.product_id } };
    }
    const inst = data.instance || {};
    const record = {
      key, instanceId: inst.id || null, instanceName: inst.name || null,
      deviceId, activatedAt: Date.now(), lastChecked: Date.now(), lastTriedAt: Date.now(),
      status: data.status || 'active',
      activationLimit: data.activation_limit ?? null,
      activationUsage: data.activation ?? null,
      expiresAt: data.expires_at ? new Date(data.expires_at).getTime() : null,
      productId: data.product_id || null,
    };
    await storageSet({ [STORAGE_KEY]: record });
    return { ok: true, record };
  }

  async function deactivate() {
    const stored = await storageGet(STORAGE_KEY, null);
    if (!stored?.key) return { ok: true };
    if (LICENSE_PROXY_URL !== '__XVM_LICENSE_WORKER__' && stored.instanceId) {
      try {
        await fetch(`${LICENSE_PROXY_URL}/deactivate`, {
          method: 'POST',
          headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: stored.key, instance_id: stored.instanceId }),
        });
      } catch (_) {}
    }
    await storageRemove(STORAGE_KEY);
    return { ok: true };
  }

  // ─── Mask license key for display ───────────────────────────────────
  function maskKey(k) {
    if (!k) return '';
    if (k.length <= 8) return '••••••••';
    return `${k.slice(0, 4)}••••${k.slice(-4)}`;
  }

  // ─── Render (Pro tab banner, mock A) ───────────────────────────────
  // Inside #xvm-pro-section (.pro-banner): big TIER label + sub + CTA
  // row (or Pro meta when active). Tabs are the navigation, so no 3-dot
  // menu. The header tier-chip syncs from body.dataset.tier.
  function render(container, info) {
    const tier = info.tier;
    const days = info.daysLeft;
    container.dataset.tier = tier;
    document.body.dataset.tier = tier;
    window.__xvmProDays = (tier === 'trial') ? days : null;
    window.dispatchEvent(new CustomEvent('xvm-pro-days', { detail: { days, tier } }));
    container.innerHTML = '';

    // Tier giant label
    const tierEl = document.createElement('div');
    tierEl.className = 'tier-big';
    tierEl.textContent = tier === 'pro' ? 'PRO' : tier === 'trial' ? 'TRIAL' : 'FREE';
    container.appendChild(tierEl);

    // Tier subtitle
    const sub = document.createElement('div');
    sub.className = 'tier-sub';
    if (tier === 'trial') {
      sub.textContent = days === 1 ? t('heroTrialDayOne') : t('heroTrialDaysLeft', days);
    } else if (tier === 'pro') {
      sub.textContent = t('heroProActive');
    } else {
      sub.textContent = t('heroFreeTagline');
    }
    container.appendChild(sub);

    if (tier !== 'pro') {
      const row = document.createElement('div');
      row.className = 'pro-cta-row';
      // Primary CTA = annual (save 17%)
      const annual = document.createElement('a');
      annual.className = 'pro-cta';
      annual.href = BUY_URL_ANNUAL; annual.target = '_blank'; annual.rel = 'noopener';
      annual.innerHTML = `<svg><use href="#icon-sparkles"/></svg> <span></span>`;
      annual.querySelector('span').textContent = t('heroCtaUpgradeAnnual');
      row.appendChild(annual);
      // Secondary CTAs
      const monthly = document.createElement('a');
      monthly.className = 'pro-cta secondary';
      monthly.href = BUY_URL_MONTHLY; monthly.target = '_blank'; monthly.rel = 'noopener';
      monthly.textContent = t('heroCtaUpgradeMonthly');
      row.appendChild(monthly);
      // "Activate existing license" — opens inline form
      const actLink = document.createElement('button');
      actLink.type = 'button';
      actLink.className = 'pro-cta secondary';
      actLink.textContent = t('heroActivateExistingLink');
      actLink.addEventListener('click', () => {
        window.dispatchEvent(new CustomEvent('xvm-pro-nav', { detail: { view: 'activate' } }));
      });
      row.appendChild(actLink);
      container.appendChild(row);
    } else {
      const row = document.createElement('div');
      row.className = 'pro-cta-row';
      const manage = document.createElement('a');
      manage.className = 'pro-cta secondary';
      manage.href = 'https://www.creem.io/dashboard';
      manage.target = '_blank'; manage.rel = 'noopener';
      manage.textContent = t('proManageBtn');
      row.appendChild(manage);
      container.appendChild(row);

      const rec = info.record || {};
      const meta = document.createElement('div');
      meta.className = 'pro-meta';
      meta.innerHTML = `
        <div class="row"><span></span><code>${maskKey(rec.key)}</code></div>
        ${rec.activatedAt ? `<div class="row"><span></span><span>${new Date(rec.activatedAt).toLocaleDateString()}</span></div>` : ''}
        ${rec.expiresAt   ? `<div class="row"><span></span><span>${new Date(rec.expiresAt).toLocaleDateString()}</span></div>` : ''}
      `;
      const labels = ['proLicenseField'];
      if (rec.activatedAt) labels.push('proActivatedField');
      if (rec.expiresAt)   labels.push('proExpiresField');
      meta.querySelectorAll('.row > span:first-child').forEach((el, i) => {
        el.textContent = t(labels[i] || '');
      });
      container.appendChild(meta);
    }
  }

  // === Activation submit handler — wired by popup-dashboard via the
  // view-activate form. Imported here so the activate() logic stays
  // co-located with the rest of license operations.
  function wireActivateView() {
    const btn   = document.getElementById('activate-submit');
    const cancel = document.getElementById('activate-cancel');
    const keyEl = document.getElementById('activate-key');
    const msg   = document.getElementById('activate-msg');
    if (!btn || !keyEl || !msg) return;
    cancel?.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('xvm-pro-nav', { detail: { view: 'dashboard' } }));
    });
    btn.addEventListener('click', async () => {
      const key = keyEl.value.trim();
      if (!KEY_RE.test(key)) {
        msg.textContent = t('proActErrFormat');
        msg.dataset.kind = 'err';
        return;
      }
      btn.disabled = true; btn.textContent = t('proActivating');
      const res = await activate(key);
      btn.disabled = false; btn.textContent = t('proActivateBtn');
      if (res.ok) {
        msg.textContent = t('proActivatedOk');
        msg.dataset.kind = 'ok';
        // Auto-return to dashboard so user sees the new Pro hero.
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('xvm-pro-nav', { detail: { view: 'dashboard' } }));
        }, 800);
        refresh();
      } else if (res.error === 'worker_url_unset') {
        msg.textContent = t('proActErrWorkerUnset');
        msg.dataset.kind = 'err';
      } else {
        const detail = res.error + (res.message ? ' — ' + res.message : '');
        msg.textContent = t('proActErrGeneric', detail);
        msg.dataset.kind = 'err';
      }
    });
  }
  document.addEventListener('DOMContentLoaded', wireActivateView);

  async function refresh() {
    const container = document.getElementById('xvm-pro-section');
    if (!container) return;
    const info = await resolveTier();
    render(container, info);
  }

  // Re-render on storage changes (license activate/deactivate from elsewhere)
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (STORAGE_KEY in changes || TRIAL_KEY in changes) refresh();
    });
  } catch (_) {}

  // Seed trial in popup context too (defensive — isolated.js does this on
  // any x.com page load, but popup may open before user visits x.com on a
  // fresh install).
  (async () => {
    const rec = await storageGet(TRIAL_KEY, null);
    if (!rec || !Number.isFinite(rec.startAt)) {
      await storageSet({ [TRIAL_KEY]: { startAt: Date.now() } });
    }
    refresh();
  })();

  // Expose for popup.js if it wants to manually trigger refresh.
  window.__xvmProPopup = { refresh, resolveTier };
})();
