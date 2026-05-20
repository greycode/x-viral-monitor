// === Pro List-member filter (M2 PoC — MAIN world) ===
//
// Filters the current X timeline to tweets authored by members of one or
// more cached X Lists. Popup/bridge own chrome.storage.local; this MAIN-world
// runtime only consumes XVM_LIST_MEMBER_FILTER_UPDATE and marks its own hides
// with data-xvm-list-member-hidden so OFF/gate revoke never touches other UI.

(() => {
  if (window.__xvmListMemberFilter) return;

  const STORAGE_KEY = 'xvm_list_member_filter_v1';
  const HIDE_ATTR = 'data-xvm-list-member-hidden';
  const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
  const DEFAULT_SETTINGS = {
    enabled: false,
    ttlMs: DEFAULT_TTL_MS,
    scopes: { home: false, list: false, profile: false, status: true },
    lists: [],
  };

  let SETTINGS = normalizeSettings(DEFAULT_SETTINGS);
  const OTHER_HIDE_ATTRS = ['data-xvm-rate-hidden'];
  const mo = new MutationObserver(() => applyHidesNow());

  function gateOpen() {
    return window.__xvmPro?.isFeatureEnabled('list-member-filter') === true;
  }

  function normalizeHandle(v) {
    const s = String(v || '').trim().replace(/^@+/, '').toLowerCase();
    return /^[a-z0-9_]{1,15}$/.test(s) ? s : '';
  }

  function normalizeMember(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const screenName = normalizeHandle(raw.screenName || raw.handle || raw.username);
    const userId = String(raw.userId || raw.id || '').trim();
    if (!screenName && !userId) return null;
    return { userId, screenName };
  }

  function normalizeList(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const members = Array.isArray(raw.members)
      ? raw.members.map(normalizeMember).filter(Boolean)
      : [];
    return {
      listId: String(raw.listId || raw.id || '').trim(),
      url: String(raw.url || '').trim(),
      name: String(raw.name || '').trim(),
      screenName: normalizeHandle(raw.screenName || raw.ownerScreenName || raw.owner),
      enabled: raw.enabled !== false,
      members,
      fetchedAt: Number.isFinite(raw.fetchedAt) ? raw.fetchedAt : 0,
      ttlMs: Number.isFinite(raw.ttlMs) ? raw.ttlMs : DEFAULT_TTL_MS,
      lastError: raw.lastError ? String(raw.lastError) : '',
    };
  }

  function normalizeSettings(raw) {
    const scopes = raw?.scopes && typeof raw.scopes === 'object' ? raw.scopes : {};
    const lists = Array.isArray(raw?.lists)
      ? raw.lists.map(normalizeList).filter(Boolean)
      : [];
    return {
      enabled: raw?.enabled === true,
      ttlMs: Number.isFinite(raw?.ttlMs) ? raw.ttlMs : DEFAULT_TTL_MS,
      scopes: {
        home: scopes.home === true,
        list: scopes.list === true,
        profile: scopes.profile === true,
        status: scopes.status !== false,
      },
      lists,
    };
  }

  function getScopeFromPath(pathname = location.pathname) {
    const p = String(pathname || '/');
    if (/^\/(home|i\/following|i\/verified-choose)$/.test(p)) return 'home';
    if (/^\/i\/lists\/[^/]+/.test(p) || /^\/[^/]+\/lists\/[^/]+/.test(p)) return 'list';
    if (/^\/[^/]+\/status\/\d+/.test(p)) return 'status';
    if (/^\/[^/]+\/?$/.test(p)) return 'profile';
    return 'home';
  }

  function scopeAllowed() {
    const scope = getScopeFromPath();
    return SETTINGS.scopes[scope] !== false;
  }

  function getActiveMemberSets(now = Date.now()) {
    const handles = new Set();
    const userIds = new Set();
    for (const list of SETTINGS.lists) {
      if (!list.enabled) continue;
      const ttlMs = Number.isFinite(list.ttlMs) ? list.ttlMs : SETTINGS.ttlMs;
      if (list.fetchedAt && ttlMs > 0 && now - list.fetchedAt > ttlMs) continue;
      for (const m of list.members) {
        if (m.screenName) handles.add(m.screenName);
        if (m.userId) userIds.add(m.userId);
      }
    }
    return { handles, userIds };
  }

  function articleAuthor(art) {
    const explicit = art?.getAttribute?.('data-xvm-author-handle');
    const byData = normalizeHandle(explicit);
    if (byData) return byData;

    const links = Array.from(art?.querySelectorAll?.('a[href*="/status/"]') || []);
    for (const a of links) {
      const href = a.getAttribute('href') || '';
      const m = href.match(/^\/([^/?#]+)\/status\/\d+/);
      const handle = normalizeHandle(m?.[1]);
      if (handle && !['i', 'home'].includes(handle)) return handle;
    }
    return '';
  }

  function cellForArticle(art) {
    return art.closest('[data-testid="cellInnerDiv"]') || art;
  }

  function hasOtherXvmHideMarker(art) {
    return OTHER_HIDE_ATTRS.some((attr) => art.hasAttribute(attr));
  }

  function restoreCellIfNoOtherXvmMarker(art, cell = cellForArticle(art)) {
    if (!hasOtherXvmHideMarker(art)) cell.style.display = '';
  }

  function revoke() {
    for (const art of document.querySelectorAll(`article[${HIDE_ATTR}]`)) {
      const cell = cellForArticle(art);
      art.removeAttribute(HIDE_ATTR);
      restoreCellIfNoOtherXvmMarker(art, cell);
    }
  }

  function hideArticle(art, reason) {
    const cell = cellForArticle(art);
    cell.style.display = 'none';
    art.setAttribute(HIDE_ATTR, reason);
  }

  function applyHidesNow() {
    if (!gateOpen() || !SETTINGS.enabled || !scopeAllowed()) {
      revoke();
      return;
    }
    const members = getActiveMemberSets();
    if (!members.handles.size && !members.userIds.size) {
      revoke();
      return;
    }
    for (const art of document.querySelectorAll('article[data-testid="tweet"]')) {
      const handle = articleAuthor(art);
      if (handle && members.handles.has(handle)) {
        if (art.hasAttribute(HIDE_ATTR)) {
          const cell = cellForArticle(art);
          art.removeAttribute(HIDE_ATTR);
          restoreCellIfNoOtherXvmMarker(art, cell);
        }
        continue;
      }
      hideArticle(art, `not-list-member:${handle || 'unknown'}`);
    }
  }

  function updateSettings(raw) {
    SETTINGS = normalizeSettings(raw);
    applyHidesNow();
  }

  function connectObserver() {
    if (document.documentElement) {
      mo.observe(document.documentElement, { childList: true, subtree: true });
    }
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const d = event.data;
    if (!d || d.type !== 'XVM_LIST_MEMBER_FILTER_UPDATE') return;
    updateSettings(d.settings);
  });

  window.__xvmPro?.onTierChange?.(() => applyHidesNow());
  window.addEventListener('popstate', () => applyHidesNow());
  document.addEventListener('DOMContentLoaded', () => applyHidesNow(), { once: true });
  connectObserver();
  window.postMessage({ type: 'XVM_LIST_MEMBER_FILTER_REQUEST', storageKey: STORAGE_KEY }, '*');

  window.__xvmListMemberFilter = {
    updateSettings,
    applyHidesNow,
    getSettings: () => JSON.parse(JSON.stringify(SETTINGS)),
    _debug: {
      STORAGE_KEY,
      HIDE_ATTR,
      normalizeSettings,
      getScopeFromPath,
      articleAuthor,
      getActiveMemberSets,
      hasOtherXvmHideMarker,
      restoreCellIfNoOtherXvmMarker,
      revoke,
    },
  };
})();
