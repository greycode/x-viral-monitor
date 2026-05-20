// === X List member GraphQL source (popup context) ===
//
// Mirrors the x-xillot ListMembers endpoint shape. Popup cannot safely write
// page settings from window.postMessage; instead it writes an extension-owned
// request to chrome.storage.local, and the x.com content bridge performs the
// authenticated same-origin fetch.

(function () {
  const REQUEST_KEY = 'xvm_list_member_fetch_request_v1';
  const RESPONSE_KEY = 'xvm_list_member_fetch_response_v1';
  const QUERY_ID = {
    ListByRestId: 't9AbdyHaJVfjL9jsODwgpQ',
    ListMembers: 'l90-8FD7I3dxXqJfyxSEeA',
    ListLatestTweetsTimeline: '7UuJsFvnWuZo0HmxrzU42Q',
  };
  const LIMITS = Object.freeze({
    maxLists: 5,
    maxMembersPerList: 5000,
    maxMembersTotal: 10000,
  });
  const PAGE_SIZE = 100;
  const REQUEST_TIMEOUT_MS = 15000;

  const LIST_FEATURES = Object.freeze({
    rweb_video_screen_enabled: false,
    rweb_cashtags_enabled: true,
    profile_label_improvements_pcf_label_in_post_enabled: true,
    responsive_web_profile_redirect_enabled: false,
    rweb_tipjar_consumption_enabled: false,
    verified_phone_label_enabled: false,
    creator_subscriptions_tweet_preview_api_enabled: true,
    responsive_web_graphql_timeline_navigation_enabled: true,
    responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
    premium_content_api_read_enabled: false,
    communities_web_enable_tweet_community_results_fetch: true,
    c9s_tweet_anatomy_moderator_badge_enabled: true,
    responsive_web_grok_analyze_button_fetch_trends_enabled: false,
    responsive_web_grok_analyze_post_followups_enabled: true,
    rweb_cashtags_composer_attachment_enabled: true,
    responsive_web_jetfuel_frame: true,
    responsive_web_grok_share_attachment_enabled: true,
    responsive_web_grok_annotations_enabled: true,
    articles_preview_enabled: true,
    responsive_web_edit_tweet_api_enabled: true,
    rweb_conversational_replies_downvote_enabled: false,
    graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
    view_counts_everywhere_api_enabled: true,
    longform_notetweets_consumption_enabled: true,
    responsive_web_twitter_article_tweet_consumption_enabled: true,
    content_disclosure_indicator_enabled: true,
    content_disclosure_ai_generated_indicator_enabled: true,
    responsive_web_grok_show_grok_translated_post: true,
    responsive_web_grok_analysis_button_from_backend: true,
    post_ctas_fetch_enabled: false,
    freedom_of_speech_not_reach_fetch_enabled: true,
    standardized_nudges_misinfo: true,
    tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
    longform_notetweets_rich_text_read_enabled: true,
    longform_notetweets_inline_media_enabled: false,
    responsive_web_grok_image_annotation_enabled: true,
    responsive_web_grok_imagine_annotation_enabled: true,
    responsive_web_grok_community_note_auto_translation_is_enabled: true,
    responsive_web_enhance_cards_enabled: false,
  });

  const LIST_METADATA_FEATURES = Object.freeze({
    profile_label_improvements_pcf_label_in_post_enabled: true,
    responsive_web_profile_redirect_enabled: false,
    rweb_tipjar_consumption_enabled: false,
    verified_phone_label_enabled: false,
    responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
    responsive_web_graphql_timeline_navigation_enabled: true,
  });

  function storageSet(obj) {
    return new Promise((resolve, reject) => {
      try {
        chrome.storage.local.set(obj, () => {
          const err = chrome.runtime?.lastError;
          if (err) reject(new Error(err.message));
          else resolve();
        });
      } catch (e) {
        reject(e);
      }
    });
  }

  function storageRemove(keys) {
    try { chrome.storage.local.remove(keys); } catch (_) {}
  }

  function randomId() {
    if (crypto?.randomUUID) return crypto.randomUUID();
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  function extractListId(input) {
    const v = String(input || '').trim();
    if (!v) return '';
    if (/^\d+$/.test(v)) return v;
    const m = v.match(/(?:x\.com|twitter\.com)\/i\/lists\/(\d+)/i)
      || v.match(/\/i\/lists\/(\d+)/i)
      || v.match(/\/lists\/(\d+)(?:[/?#]|$)/i);
    return m?.[1] || '';
  }

  function listUrl(listId) {
    return `https://x.com/i/lists/${listId}`;
  }

  function buildListMembersUrl({ listId, cursor }) {
    const variables = { listId: String(listId), count: PAGE_SIZE };
    if (cursor) variables.cursor = cursor;
    return `https://x.com/i/api/graphql/${QUERY_ID.ListMembers}/ListMembers?` + new URLSearchParams({
      variables: JSON.stringify(variables),
      features: JSON.stringify(LIST_FEATURES),
    }).toString();
  }

  function buildListMetadataUrl({ listId }) {
    return `https://x.com/i/api/graphql/${QUERY_ID.ListByRestId}/ListByRestId?` + new URLSearchParams({
      variables: JSON.stringify({ listId: String(listId) }),
      features: JSON.stringify(LIST_METADATA_FEATURES),
    }).toString();
  }

  function timelineInstructions(data) {
    return data?.data?.list?.members_timeline?.timeline?.instructions
      || data?.data?.list_members_timeline?.timeline?.instructions
      || null;
  }

  function walkObjects(value, visit) {
    if (!value || typeof value !== 'object') return;
    visit(value);
    if (Array.isArray(value)) {
      for (const item of value) walkObjects(item, visit);
      return;
    }
    for (const item of Object.values(value)) walkObjects(item, visit);
  }

  function normalizeScreenName(v) {
    const s = String(v || '').trim().replace(/^@+/, '').toLowerCase();
    return /^[a-z0-9_]{1,15}$/.test(s) ? s : '';
  }

  function flattenUserResult(result) {
    const user = result?.user_results?.result || result?.result || result;
    if (!user || typeof user !== 'object') return null;
    const core = user.core || {};
    const legacy = user.legacy || {};
    const userId = String(user.rest_id || legacy.id_str || '').trim();
    const screenName = normalizeScreenName(core.screen_name || legacy.screen_name);
    if (!userId && !screenName) return null;
    return {
      userId,
      screenName,
      name: String(core.name || legacy.name || screenName || userId).trim(),
      profileImageUrl: String(user.avatar?.image_url || legacy.profile_image_url_https || '').trim(),
    };
  }

  function parseListMembersResponse(data) {
    const instructions = timelineInstructions(data);
    const members = [];
    const seen = new Set();
    let cursor = '';
    walkObjects(instructions, (obj) => {
      const user = obj?.user_results ? flattenUserResult(obj) : null;
      if (user) {
        const key = user.userId || user.screenName;
        if (!seen.has(key)) {
          seen.add(key);
          members.push(user);
        }
      }
      const cur = obj?.cursorType || obj?.cursor_type || obj?.content?.cursorType;
      const val = obj?.value || obj?.cursor?.value || obj?.content?.value || obj?.content?.cursor?.value;
      if (String(cur || '').toLowerCase() === 'bottom' && typeof val === 'string' && val) {
        cursor = val;
      }
    });
    return { members, cursor, metadata: parseListMetadata(data) };
  }

  function parseListMetadata(data) {
    const list = data?.data?.list || data?.data?.list_results?.result || {};
    let name = String(list?.name || list?.core?.name || list?.legacy?.name || list?.list?.name || '').trim();
    let screenName = normalizeScreenName(
      list?.user_results?.result?.core?.screen_name
      || list?.user_results?.result?.legacy?.screen_name
      || list?.user?.core?.screen_name
      || list?.user?.legacy?.screen_name
      || list?.owner?.core?.screen_name
      || list?.owner?.legacy?.screen_name
    );
    let memberCount = Number(list?.member_count || list?.members_count || list?.legacy?.member_count || list?.core?.member_count);
    // Do not deep-walk members_timeline: ListMembers often returns only
    // member UserCells, and deep scanning would mislabel the first member as
    // the List name/owner.
    return { name, screenName, memberCount: Number.isFinite(memberCount) ? memberCount : 0 };
  }

  function parseListByRestIdMetadata(data) {
    const list = data?.data?.list || data?.data?.list_results?.result || {};
    const owner = list?.user_results?.result || list?.user?.result || list?.user || {};
    const ownerCore = owner.core || {};
    const ownerLegacy = owner.legacy || {};
    const memberCount = Number(list?.member_count || list?.members_count || list?.legacy?.member_count || list?.core?.member_count);
    const subscriberCount = Number(list?.subscriber_count || list?.subscribers_count || list?.legacy?.subscriber_count);
    return {
      name: String(list?.name || list?.core?.name || list?.legacy?.name || '').trim(),
      description: String(list?.description || list?.core?.description || list?.legacy?.description || '').trim(),
      screenName: normalizeScreenName(ownerCore.screen_name || ownerLegacy.screen_name),
      ownerName: String(ownerCore.name || ownerLegacy.name || '').trim(),
      ownerUserId: String(owner.rest_id || ownerLegacy.id_str || '').trim(),
      mode: String(list?.mode || list?.legacy?.mode || '').trim(),
      memberCount: Number.isFinite(memberCount) ? memberCount : 0,
      subscriberCount: Number.isFinite(subscriberCount) ? subscriberCount : 0,
    };
  }

  function requestGraphQL(url, op = 'ListMembers', timeoutMs = REQUEST_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
      const requestId = randomId();
      const responseKey = `${RESPONSE_KEY}_${requestId}`;
      let done = false;
      const cleanup = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        try { chrome.storage.onChanged.removeListener(onChanged); } catch (_) {}
        storageRemove([responseKey]);
      };
      const onChanged = (changes, area) => {
        if (area !== 'local') return;
        const response = changes[responseKey]?.newValue || changes[RESPONSE_KEY]?.newValue;
        if (!response || response.requestId !== requestId) return;
        cleanup();
        if (!response.ok) {
          reject(new Error(response.error || `GraphQL fetch failed (${response.status || 'unknown'})`));
          return;
        }
        resolve(response);
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('Open an X.com tab and reload it, then retry fetching List members.'));
      }, timeoutMs);

      try { chrome.storage.onChanged.addListener(onChanged); } catch (e) {
        clearTimeout(timer);
        reject(e);
        return;
      }
      storageSet({
        [REQUEST_KEY]: {
          requestId,
          responseKey,
          op,
          url,
          createdAt: Date.now(),
        },
      }).catch((e) => {
        cleanup();
        reject(e);
      });
    });
  }

  async function fetchListMetadata(listId, timeoutMs) {
    const url = buildListMetadataUrl({ listId });
    const response = await requestGraphQL(url, 'ListByRestId', timeoutMs || REQUEST_TIMEOUT_MS);
    return parseListByRestIdMetadata(response.data);
  }

  function classifyFetchError(error) {
    const msg = String(error?.message || error || '');
    if (/rate limit|429/i.test(msg)) return 'rate-limit';
    if (/401|403|auth|csrf|login/i.test(msg)) return 'auth';
    if (/private|not authorized/i.test(msg)) return 'private';
    if (/Open an X\.com tab|timeout/i.test(msg)) return 'open-x';
    return 'network';
  }

  async function fetchListMembers(input, options = {}) {
    const listId = extractListId(input?.listId || input?.url || input);
    if (!listId) throw new Error('Enter a numeric X List URL or listId.');
    const maxPages = Math.max(1, Math.min(Number(options.maxPages) || 50, 80));
    const maxMembers = Math.max(1, Math.min(Number(options.maxMembers) || LIMITS.maxMembersPerList, LIMITS.maxMembersPerList));
    const members = [];
    const seen = new Set();
    let cursor = '';
    let pages = 0;
    let rateLimit = null;
    let metadata = { name: '', screenName: '', ownerName: '', ownerUserId: '', description: '', mode: '', memberCount: 0, subscriberCount: 0 };
    const startedAt = Date.now();
    options.onProgress?.({ phase: 'start', listId, members: 0, page: 0, maxMembers });
    const metadataPromise = fetchListMetadata(listId, options.timeoutMs || REQUEST_TIMEOUT_MS).catch(() => null);

    try {
      do {
        const url = buildListMembersUrl({ listId, cursor });
        const response = await requestGraphQL(url, 'ListMembers', options.timeoutMs || REQUEST_TIMEOUT_MS);
        rateLimit = response.rateLimit || response.rate_limit || rateLimit;
        const page = parseListMembersResponse(response.data);
        if (page.metadata?.name || page.metadata?.screenName || page.metadata?.memberCount) {
          metadata = {
            name: page.metadata.name || metadata.name,
            screenName: page.metadata.screenName || metadata.screenName,
            memberCount: page.metadata.memberCount || metadata.memberCount,
          };
        }
        pages += 1;
        let addedThisPage = 0;
        for (const m of page.members) {
          const key = m.userId || m.screenName;
          if (!key || seen.has(key)) continue;
          seen.add(key);
          members.push(m);
          addedThisPage += 1;
          if (members.length >= maxMembers) break;
        }
        options.onProgress?.({
          phase: cursor ? 'page' : 'first-page',
          listId,
          members: members.length,
          expected: metadata.memberCount || 0,
          page: pages,
          maxMembers,
        });
        cursor = page.cursor || '';
        if (addedThisPage === 0 && pages > 1) break;
        if (members.length >= maxMembers) break;
      } while (cursor && pages < maxPages);
    } catch (e) {
      e.reason = classifyFetchError(e);
      throw e;
    }

    if (!members.length) throw new Error('List members were not returned. Open the List page on X and retry.');
    const listMetadata = await metadataPromise;
    if (listMetadata) {
      metadata = {
        ...metadata,
        name: listMetadata.name || metadata.name,
        screenName: listMetadata.screenName || metadata.screenName,
        ownerName: listMetadata.ownerName || metadata.ownerName,
        ownerUserId: listMetadata.ownerUserId || metadata.ownerUserId,
        description: listMetadata.description || metadata.description,
        mode: listMetadata.mode || metadata.mode,
        memberCount: listMetadata.memberCount || metadata.memberCount,
        subscriberCount: listMetadata.subscriberCount || metadata.subscriberCount,
      };
    }
    return {
      listId,
      url: input?.url || listUrl(listId),
      name: metadata.name || `List ${listId}`,
      screenName: metadata.screenName || '',
      ownerName: metadata.ownerName || '',
      ownerUserId: metadata.ownerUserId || '',
      description: metadata.description || '',
      mode: metadata.mode || '',
      subscriberCount: metadata.subscriberCount || 0,
      expectedMemberCount: metadata.memberCount || members.length,
      members,
      fetchedAt: Date.now(),
      fetchDurationMs: Date.now() - startedAt,
      source: 'graphql',
      pages,
      rateLimit,
    };
  }

  window.__xvmListMemberSource = {
    REQUEST_KEY,
    RESPONSE_KEY,
    QUERY_ID,
    LIST_FEATURES,
    LIST_METADATA_FEATURES,
    LIMITS,
    extractListId,
    buildListMembersUrl,
    buildListMetadataUrl,
    parseListMembersResponse,
    parseListMetadata,
    parseListByRestIdMetadata,
    classifyFetchError,
    requestGraphQL,
    fetchListMetadata,
    fetchListMembers,
  };
})();
