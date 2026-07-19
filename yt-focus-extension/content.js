// ===== YT FOCUS — CONTENT SCRIPT =====
// Runs on every youtube.com page and directly modifies the DOM

// ===== SETTINGS STATE =====
let settings = {
  blankHomepage: true,
  hideComments: true,
  hideSidebar: true,
  hideShorts: true,
  allowedChannels: [],
  blockedKeywords: [],
  lockMode: false,
};

// ===== LOCK MODE STATE =====
let _lockUnlockUntil = 0; // epoch ms — non-zero means unlocked briefly
let _lockTimer = null;

// Inject end-screen CSS once so we don't have to wait for JS observers
(function injectEndScreenCSS() {
  if (document.getElementById('ytf-endscreen-css')) return;
  const s = document.createElement('style');
  s.id = 'ytf-endscreen-css';
  s.textContent = [
    '.ytp-endscreen-content',
    '.ytp-ce-element',
    '.ytp-ce-covering-overlay',
    '.ytp-ce-element-shadow',
    '.ytp-endscreen-previous',
    '.ytp-endscreen-next',
    'yt-endscreen-renderer',
    'ytd-endscreen-renderer',
    '.html5-endscreen',
  ].join(',') + ' { display: none !important; opacity: 0 !important; pointer-events: none !important; }';
  (document.head || document.documentElement).appendChild(s);
})();

// ===== RULE REGISTRY =====
// One MutationObserver for the whole extension. applyFilters() decides which
// rules are active for the current page + settings; every DOM mutation batch
// re-runs the active rules through a debounce.
const activeRules = new Map(); // name -> idempotent function
let _rulesTimer = null;
let lastUrl = location.href;

const masterObserver = new MutationObserver(scheduleRules);
masterObserver.observe(document.documentElement, { childList: true, subtree: true });

function scheduleRules() {
  if (_rulesTimer) return;
  _rulesTimer = setTimeout(() => {
    _rulesTimer = null;
    if (location.href !== lastUrl) onNavigate();
    runRules();
  }, 100);
}

function runRules() {
  activeRules.forEach(fn => {
    try { fn(); } catch (e) { /* keep other rules running */ }
  });
}

// ===== NAVIGATION (SPA) =====
// yt-navigate-finish is YouTube's own SPA navigation event; the URL check in
// scheduleRules is the fallback if it ever stops firing.
window.addEventListener('yt-navigate-finish', () => {
  if (location.href !== lastUrl) onNavigate();
});

function onNavigate() {
  lastUrl = location.href;
  clearWatchBlock();
  applyFilters();
}

// ===== BOOT =====
loadSettingsAndApply();

function loadSettingsAndApply() {
  chrome.storage.local.get(
    ['blankHomepage', 'hideComments', 'hideSidebar', 'hideShorts',
      'allowedChannels', 'blockedKeywords', 'lockMode', 'lockUnlockUntil'],
    (data) => {
      settings.blankHomepage = data.blankHomepage !== undefined ? data.blankHomepage : true;
      settings.hideComments = data.hideComments !== undefined ? data.hideComments : true;
      settings.hideSidebar = data.hideSidebar !== undefined ? data.hideSidebar : true;
      settings.hideShorts = data.hideShorts !== undefined ? data.hideShorts : true;
      settings.allowedChannels = data.allowedChannels || [];
      settings.blockedKeywords = data.blockedKeywords || [];
      settings.lockMode = data.lockMode || false;
      _lockUnlockUntil = data.lockUnlockUntil || 0;
      applyFilters();
      if (settings.lockMode || Date.now() < _lockUnlockUntil) startLockEnforcer();
    }
  );
}

// React to settings saved from the popup — fires in EVERY YouTube tab,
// so lock mode and filter changes apply everywhere, not just the active tab.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  let dirty = false;
  for (const key of Object.keys(changes)) {
    if (key in settings) {
      settings[key] = changes[key].newValue;
      dirty = true;
    } else if (key === 'lockUnlockUntil') {
      _lockUnlockUntil = changes[key].newValue || 0;
      dirty = true;
    }
  }
  if (!dirty) return;

  if (settings.lockMode || Date.now() < _lockUnlockUntil) startLockEnforcer();
  else stopLockEnforcer();

  restoreAll();
  applyFilters();
});

// ===== MAIN APPLY =====
function applyFilters() {
  const path = location.pathname;
  // Only blank the main home/trending/subscriptions feeds — not account pages etc.
  const isHome = path === '/' || path === '/feed/trending' || path === '/feed/subscriptions';
  const isWatch = path.startsWith('/watch');
  const isSearch = path === '/results';
  const isPlaylist = path === '/playlist';

  activeRules.clear();

  // Homepage blanking + search bar
  if (isHome && settings.blankHomepage) {
    activeRules.set('homepage', ruleHomepage);
    activeRules.set('searchbar', ruleHideSearchbar);
  } else {
    removeBlankOverlay();
    const grid = document.querySelector('ytd-rich-grid-renderer');
    if (grid) grid.style.display = '';
    showSearchbar();
  }

  if (isWatch) {
    if (settings.hideComments) activeRules.set('comments', ruleHideComments);

    if (settings.hideSidebar) {
      // Always kill the related-videos panel (even inside playlists)
      activeRules.set('sidebarRelated', ruleHideSidebarRelated);

      const inPlaylist = new URLSearchParams(location.search).has('list');
      if (!inPlaylist) {
        // No playlist — collapse the entire sidebar column
        activeRules.set('sidebarColumn', ruleHideSidebarColumn);
      } else {
        // In a playlist — show the sidebar column (for the queue); related videos stay hidden
        const sec = document.querySelector('#secondary');
        if (sec) sec.style.display = '';
      }
    }

    // Channel whitelist gate
    if (settings.allowedChannels.length > 0) activeRules.set('watchGate', ruleWatchGate);

    activeRules.set('autoplayOff', ruleAutoplayOff);
    activeRules.set('endScreen', ruleHideEndScreen);
  }

  if (isPlaylist) activeRules.set('playlistRec', rulePlaylistRecommended);

  if (settings.hideShorts) activeRules.set('shorts', ruleHideShorts);

  if (settings.allowedChannels.length > 0 && (isHome || isSearch)) {
    activeRules.set('channelCards', ruleChannelCards);
  }

  if (settings.blockedKeywords.length > 0) {
    activeRules.set('keywordCards', ruleKeywordCards);
  }

  activeRules.set('clutter', ruleClutter);

  runRules();
}

// ===== RULES =====
// Each rule is idempotent and re-reads settings, so re-running it on every
// mutation batch keeps YouTube's re-rendered elements hidden.

function hideAll(selector) {
  document.querySelectorAll(selector).forEach(el => {
    if (el.style.display !== 'none') el.style.display = 'none';
  });
}

function ruleHideComments() { hideAll('#comments'); }
function ruleHideSidebarRelated() { hideAll('ytd-watch-next-secondary-results-renderer'); }
function ruleHideSidebarColumn() { hideAll('#secondary'); }

function ruleHomepage() {
  const grid = document.querySelector('ytd-rich-grid-renderer');
  if (grid && grid.style.display !== 'none') grid.style.display = 'none';
  injectCmdOverlay();
}

function ruleHideSearchbar() {
  ['#search', 'ytd-searchbox', '#search-form'].forEach(sel => {
    document.querySelectorAll(sel).forEach(el => {
      if (el.style.visibility !== 'hidden') {
        el.style.visibility = 'hidden';
        el.style.pointerEvents = 'none';
      }
    });
  });
}

function showSearchbar() {
  ['#search', 'ytd-searchbox', '#search-form'].forEach(sel => {
    document.querySelectorAll(sel).forEach(el => {
      el.style.visibility = '';
      el.style.pointerEvents = '';
    });
  });
}

function ruleAutoplayOff() {
  const btn = document.querySelector('.ytp-autonav-toggle-button[aria-checked="true"]');
  if (btn) btn.click();
}

function ruleHideEndScreen() {
  // CSS handles most of it; this catches inline-styled stragglers
  [
    '.ytp-endscreen-content', '.ytp-ce-element', '.ytp-ce-covering-overlay',
    '.ytp-ce-element-shadow', '.ytp-endscreen-previous', '.ytp-endscreen-next',
    'yt-endscreen-renderer', 'ytd-endscreen-renderer', '.html5-endscreen',
  ].forEach(sel => {
    document.querySelectorAll(sel).forEach(el => {
      if (el.style.display !== 'none') {
        el.style.setProperty('display', 'none', 'important');
        el.style.setProperty('opacity', '0', 'important');
        el.style.setProperty('pointer-events', 'none', 'important');
      }
    });
  });
}

function ruleHideShorts() {
  [
    'ytd-reel-shelf-renderer',
    'ytd-rich-shelf-renderer[is-shorts]',
    '#guide-inner-content ytd-guide-entry-renderer a[href="/shorts"]',
    'ytd-mini-guide-entry-renderer a[href="/shorts"]',
    'ytd-search-filter-group-renderer',
  ].forEach(hideAll);
  document.querySelectorAll('yt-chip-cloud-chip-renderer').forEach(chip => {
    if (chip.style.display === 'none') return;
    const link = chip.querySelector('a');
    const label = chip.textContent?.trim().toLowerCase();
    if (label === 'shorts' || link?.href?.includes('EgIQAQ')) chip.style.display = 'none';
  });
}

function ruleClutter() {
  hideAll('ytd-masthead .ytd-notification-topbar-button-renderer');
}

// Playlist page — hide recommended sections below the queue
function rulePlaylistRecommended() {
  document.querySelectorAll(
    'ytd-browse ytd-item-section-renderer, ' +
    'ytd-section-list-renderer > #contents > ytd-item-section-renderer'
  ).forEach(el => {
    // Never hide the section that contains the actual playlist video list —
    // that's what shows Watch Later / Liked Videos / playlist titles.
    if (el.querySelector('ytd-playlist-video-list-renderer')) return;
    if (el.style.display !== 'none') el.style.display = 'none';
  });
}

// ===== CHANNEL FILTER (home & search cards) =====
function ruleChannelCards() {
  const allowed = settings.allowedChannels.map(c => c.toLowerCase().trim()).filter(Boolean);
  if (!allowed.length) return;
  // Covers both home (rich-item) and search (video-renderer) cards
  ['ytd-rich-item-renderer', 'ytd-video-renderer'].forEach(sel => {
    document.querySelectorAll(sel).forEach(card => {
      const ch = card.querySelector(
        'ytd-channel-name a, #channel-name a, #text.ytd-channel-name, .ytd-channel-name'
      );
      if (!ch) return;
      const name = ch.textContent?.trim().toLowerCase() || '';
      const show = allowed.some(a => name.includes(a));
      const want = show ? '' : 'none';
      if (card.style.display !== want) card.style.display = want;
    });
  });
}

// ===== KEYWORD FILTER =====
function ruleKeywordCards() {
  const keywords = settings.blockedKeywords.map(k => k.toLowerCase().trim()).filter(Boolean);
  if (!keywords.length) return;
  [
    'ytd-rich-item-renderer',
    'ytd-video-renderer',
    'ytd-compact-video-renderer',
    'ytd-playlist-video-renderer',
  ].forEach(sel => {
    document.querySelectorAll(sel).forEach(card => {
      if (card.style.display === 'none') return;
      const titleEl = card.querySelector('#video-title, h3 a, a#video-title');
      if (!titleEl) return;
      const title = titleEl.textContent?.trim().toLowerCase() || '';
      if (keywords.some(k => title.includes(k))) card.style.display = 'none';
    });
  });
}

// ===== CHANNEL WHITELIST — WATCH PAGE GATE =====
let _watchGateDone = false;   // channel resolved for the current watch page
let _blockPlayback = false;   // while true, any play attempt is paused

// Single capture-phase listener; the flag decides whether it acts, so
// unblocking (settings change / navigation) doesn't leave a dead player.
document.addEventListener('play', (e) => {
  if (_blockPlayback && e.target instanceof HTMLMediaElement) e.target.pause();
}, { capture: true });

function ruleWatchGate() {
  if (_watchGateDone) return;

  const chanEl = document.querySelector(
    '#channel-name a, ytd-channel-name a, #owner #channel-name a, ' +
    '#upload-info ytd-channel-name a, #owner-name a'
  );
  if (!chanEl) return; // channel not rendered yet — next mutation batch retries

  _watchGateDone = true;
  const chanName = chanEl.textContent?.trim().toLowerCase() || '';
  // Only check if channel name contains the allowed term, never the reverse —
  // avoids "tom" matching any channel whose name starts with "t".
  const allowed = settings.allowedChannels.map(c => c.toLowerCase().trim()).filter(Boolean);
  const isAllowed = allowed.some(a => chanName.includes(a));

  if (!isAllowed) injectWatchBlockScreen(chanEl.textContent?.trim() || 'this channel');
}

function injectWatchBlockScreen(channelName) {
  if (document.getElementById('ytf-watch-block')) return;

  const div = document.createElement('div');
  div.id = 'ytf-watch-block';
  div.innerHTML = `
    <div class="ytf-cmd-window">
      <div class="ytf-cmd-titlebar">
        <span class="ytf-cmd-title">C:\\Users\\focus&gt; yt-focus.exe — access denied</span>
        <div class="ytf-cmd-dots">
          <span class="ytf-dot ytf-dot-r"></span>
          <span class="ytf-dot ytf-dot-y"></span>
          <span class="ytf-dot ytf-dot-g"></span>
        </div>
      </div>
      <div class="ytf-cmd-body">
        <div class="ytf-line ytf-dim">&gt; checking channel whitelist...</div>
        <div class="ytf-line" style="color:#ff5f57">&gt; ACCESS DENIED</div>
        <div class="ytf-line"><span style="color:#606070">channel:</span> <span style="color:#febc2e">${escapeHtmlSimple(channelName)}</span></div>
        <div class="ytf-line ytf-dim">&gt; this channel is not on your allow-list</div>
        <div class="ytf-line ytf-dim">──────────────────────────────────────</div>
        <div class="ytf-line">&gt; add channels via the extension popup → Settings</div>
        <div class="ytf-line ytf-dim">──────────────────────────────────────</div>
        <div class="ytf-shortcuts">
          <a href="#" class="ytf-shortcut" id="ytf-block-back">[← go back]</a>
          <a href="https://www.youtube.com" class="ytf-shortcut">[home]</a>
        </div>
        <div class="ytf-line ytf-dim" style="margin-top:20px;">&gt; C:\\Users\\focus&gt; <span class="ytf-cursor">█</span></div>
      </div>
    </div>
  `;
  document.body.appendChild(div);

  // javascript: URLs are blocked by YouTube's CSP — wire it up properly
  div.querySelector('#ytf-block-back')?.addEventListener('click', (e) => {
    e.preventDefault();
    history.back();
  });

  // Pause + mute the video so it stops playing in the background
  _blockPlayback = true;
  const vid = document.querySelector('video');
  if (vid) { vid.pause(); vid.muted = true; }

  // Visually hide the player area
  ['#player', '#movie_player', '#player-container'].forEach(sel => {
    document.querySelectorAll(sel).forEach(el => { el.style.visibility = 'hidden'; });
  });
}

function clearWatchBlock() {
  _watchGateDone = false;
  _blockPlayback = false;
  const wb = document.getElementById('ytf-watch-block');
  if (wb) wb.remove();
  ['#player', '#movie_player', '#player-container', 'ytd-watch-flexy'].forEach(sel => {
    document.querySelectorAll(sel).forEach(el => { el.style.visibility = ''; });
  });
}

function escapeHtmlSimple(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ===== HOMEPAGE OVERLAY =====
function injectCmdOverlay() {
  if (document.getElementById('ytf-blank-overlay')) return; // DOM is the single guard

  const div = document.createElement('div');
  div.id = 'ytf-blank-overlay';
  div.innerHTML = `
    <div class="ytf-cmd-window">
      <div class="ytf-cmd-titlebar">
        <span class="ytf-cmd-title">C:\\Users\\focus&gt; yt-focus.exe</span>
        <div class="ytf-cmd-dots">
          <span class="ytf-dot ytf-dot-r"></span>
          <span class="ytf-dot ytf-dot-y"></span>
          <span class="ytf-dot ytf-dot-g"></span>
        </div>
      </div>
      <div class="ytf-cmd-body">
        <div class="ytf-line ytf-dim">&gt; initializing YT Focus v2.0 ...</div>
        <div class="ytf-line ytf-green">&gt; homepage recommendations [BLOCKED]</div>
        <div class="ytf-line ytf-green">&gt; comments              [BLOCKED]</div>
        <div class="ytf-line ytf-green">&gt; shorts                [BLOCKED]</div>
        <div class="ytf-line ytf-green">&gt; sidebar suggestions   [BLOCKED]</div>
        <div class="ytf-line ytf-green">&gt; end-screen cards      [BLOCKED]</div>
        <div class="ytf-line ytf-green">&gt; autoplay              [DISABLED]</div>
        <div class="ytf-line ytf-dim">──────────────────────────────────────</div>
        <div class="ytf-line">&gt; use the extension popup to search</div>
        <div class="ytf-line">&gt; or navigate directly below</div>
        <div class="ytf-line ytf-dim">──────────────────────────────────────</div>
        <div class="ytf-shortcuts">
          <a href="https://www.youtube.com/playlist?list=WL" class="ytf-shortcut">[watch later]</a>
        </div>
        <div class="ytf-line ytf-dim" style="margin-top:20px;">&gt; C:\\Users\\focus&gt; <span class="ytf-cursor">█</span></div>
      </div>
    </div>
  `;

  const primaryContent = document.querySelector('ytd-browse, #primary, #contents, ytd-page-manager');
  if (primaryContent) primaryContent.insertAdjacentElement('afterbegin', div);
  else document.body.appendChild(div);
}

// ===== AUTOPLAY / END SCREEN =====
function disableAutoplay() {
  const tryClick = () => {
    const btn = document.querySelector('.ytp-autonav-toggle-button[aria-checked="true"]');
    if (btn) { btn.click(); obs.disconnect(); }
  };
  const obs = new MutationObserver(tryClick);
  obs.observe(document.body, { childList: true, subtree: true });
  tryClick();
}

// ===== END SCREEN HIDER (persistent) =====
function hideEndScreenCards() {
  const endScreenSelectors = [
    '.ytp-endscreen-content',
    '.ytp-ce-element',
    '.ytp-ce-covering-overlay',
    '.ytp-ce-element-shadow',
    '.ytp-endscreen-previous',
    '.ytp-endscreen-next',
    'yt-endscreen-renderer',
    'ytd-endscreen-renderer',
    '.html5-endscreen',
  ];
  endScreenSelectors.forEach(sel => {
    document.querySelectorAll(sel).forEach(el => {
      el.style.setProperty('display', 'none', 'important');
      el.style.setProperty('opacity', '0', 'important');
      el.style.setProperty('pointer-events', 'none', 'important');
    });
  });
}

// ===== ONE-SHOT HIDE =====
function hideEl(selector) {
  const el = document.querySelector(selector);
  if (el) { el.style.display = 'none'; return; }
  const obs = new MutationObserver(() => {
    const found = document.querySelector(selector);
    if (found) { found.style.display = 'none'; obs.disconnect(); }
  });
  obs.observe(document.body, { childList: true, subtree: true });
}

// ===== SHORTS =====
function hideShorts() {
  // Singleton guard — never create more than one observer (issue #2)
  if (OBS._shortsObserver) return;

  const selectors = [
    'ytd-reel-shelf-renderer',
    'ytd-rich-shelf-renderer[is-shorts]',
    '#guide-inner-content ytd-guide-entry-renderer a[href="/shorts"]',
    'ytd-mini-guide-entry-renderer a[href="/shorts"]',
    'ytd-search-filter-group-renderer',
  ];
  const applyHide = () => {
    selectors.forEach(sel => {
      document.querySelectorAll(sel).forEach(el => { el.style.display = 'none'; });
    });
    document.querySelectorAll('yt-chip-cloud-chip-renderer').forEach(chip => {
      const link = chip.querySelector('a');
      const label = chip.textContent?.trim().toLowerCase();
      if (label === 'shorts' || link?.href?.includes('EgIQAQ')) chip.style.display = 'none';
    });
  };
  applyHide();
  const obs = new MutationObserver(applyHide);
  obs.observe(document.body, { childList: true, subtree: true });
  OBS._shortsObserver = obs;
  window._shortsObserver = obs;
}

// ===== CLUTTER =====
function hideClutter() {
  document.querySelectorAll('ytd-masthead .ytd-notification-topbar-button-renderer')
    .forEach(el => { el.style.display = 'none'; });
}

// ===== PLAYLIST PAGE — hide recommended sections below the queue =====
function hidePlaylistRecommended() {
  // Singleton guard (issue #2)
  if (OBS._playlistRecObserver) return;

  const run = () => {
    document.querySelectorAll(
      'ytd-browse ytd-item-section-renderer, ' +
      'ytd-section-list-renderer > #contents > ytd-item-section-renderer'
    ).forEach(el => {
      // Never hide the section that contains the actual playlist video list —
      // that's what shows Watch Later / Liked Videos / playlist titles.
      if (el.querySelector('ytd-playlist-video-list-renderer')) return;
      el.style.display = 'none';
    });
  };
  run();
  const obs = new MutationObserver(run);
  obs.observe(document.body, { childList: true, subtree: true });
  OBS._playlistRecObserver = obs;
  window._playlistRecObserver = obs;
}

// ===== CHANNEL WHITELIST — WATCH PAGE GATE =====
function checkWatchPageChannel() {
  if (_watchGateActive) return;
  _watchGateActive = true;

  // Fixed matching (issue #5): only check if channel name contains the allowed term,
  // never the reverse — avoids "tom" matching any channel whose name starts with "t".
  const allowed = settings.allowedChannels.map(c => c.toLowerCase().trim());

  const tryBlock = () => {
    const chanEl = document.querySelector(
      '#channel-name a, ytd-channel-name a, #owner #channel-name a, ' +
      '#upload-info ytd-channel-name a, #owner-name a'
    );
    if (!chanEl) return false;

    const chanName = chanEl.textContent?.trim().toLowerCase() || '';
    const isAllowed = allowed.some(a => chanName.includes(a)); // fixed: dropped a.includes(chanName)

    if (!isAllowed) injectWatchBlockScreen(chanEl.textContent?.trim() || 'this channel');
    return true;
  };

  if (!tryBlock()) {
    const obs = new MutationObserver(() => { if (tryBlock()) obs.disconnect(); });
    obs.observe(document.body, { childList: true, subtree: true });
  }
}

function injectWatchBlockScreen(channelName) {
  if (document.getElementById('ytf-watch-block')) return;

  const div = document.createElement('div');
  div.id = 'ytf-watch-block';
  div.innerHTML = `
    <div class="ytf-cmd-window">
      <div class="ytf-cmd-titlebar">
        <span class="ytf-cmd-title">C:\\Users\\focus&gt; yt-focus.exe — access denied</span>
        <div class="ytf-cmd-dots">
          <span class="ytf-dot ytf-dot-r"></span>
          <span class="ytf-dot ytf-dot-y"></span>
          <span class="ytf-dot ytf-dot-g"></span>
        </div>
      </div>
      <div class="ytf-cmd-body">
        <div class="ytf-line ytf-dim">&gt; checking channel whitelist...</div>
        <div class="ytf-line" style="color:#ff5f57">&gt; ACCESS DENIED</div>
        <div class="ytf-line"><span style="color:#606070">channel:</span> <span style="color:#febc2e">${escapeHtmlSimple(channelName)}</span></div>
        <div class="ytf-line ytf-dim">&gt; this channel is not on your allow-list</div>
        <div class="ytf-line ytf-dim">──────────────────────────────────────</div>
        <div class="ytf-line">&gt; add channels via the extension popup → Settings</div>
        <div class="ytf-line ytf-dim">──────────────────────────────────────</div>
        <div class="ytf-shortcuts">
          <a href="javascript:history.back()" class="ytf-shortcut">[← go back]</a>
          <a href="https://www.youtube.com" class="ytf-shortcut">[home]</a>
        </div>
        <div class="ytf-line ytf-dim" style="margin-top:20px;">&gt; C:\\Users\\focus&gt; <span class="ytf-cursor">█</span></div>
      </div>
    </div>
  `;
  document.body.appendChild(div);

  // Pause + mute the video so it stops playing in the background
  const pauseVideo = () => {
    const vid = document.querySelector('video');
    if (vid) {
      vid.pause();
      vid.muted = true;
      vid.addEventListener('play', () => { vid.pause(); }, { capture: true });
    }
  };
  pauseVideo();
  setTimeout(pauseVideo, 800);
  setTimeout(pauseVideo, 2000);

  // Visually hide the player area
  ['#player', '#movie_player', '#player-container'].forEach(sel => {
    document.querySelectorAll(sel).forEach(el => { el.style.visibility = 'hidden'; });
  });
}

function escapeHtmlSimple(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ===== CHANNEL FILTER (home & search cards) =====
function filterCardsByChannel(cardSelector) {
  // Singleton guard — only one observer across all calls (issue #2)
  if (OBS._channelFilterObs) return;

  const allowed = settings.allowedChannels.map(c => c.toLowerCase().trim());

  // Debounced runner (issue #10)
  let _t;
  const run = () => {
    clearTimeout(_t);
    _t = setTimeout(() => {
      document.querySelectorAll(cardSelector).forEach(card => {
        const ch = card.querySelector(
          'ytd-channel-name a, #channel-name a, #text.ytd-channel-name, .ytd-channel-name'
        );
        if (!ch) return;
        const name = ch.textContent?.trim().toLowerCase() || '';
        card.style.display = allowed.some(a => name.includes(a)) ? '' : 'none';
      });
    }, 32);
  };

  run();
  const obs = new MutationObserver(run);
  obs.observe(document.body, { childList: true, subtree: true });
  OBS._channelFilterObs = obs;
  window._channelFilterObs = obs;
}

// ===== KEYWORD FILTER =====
function filterCardsByKeyword(cardSelectors) {
  const keywords = settings.blockedKeywords.map(k => k.toLowerCase().trim()).filter(Boolean);
  if (!keywords.length) return;

  // Singleton guard (issue #2)
  if (OBS._keywordFilterObs) return;

  // Debounced runner (issue #10)
  let _t;
  const run = () => {
    clearTimeout(_t);
    _t = setTimeout(() => {
      cardSelectors.forEach(sel => {
        document.querySelectorAll(sel).forEach(card => {
          const titleEl = card.querySelector('#video-title, h3 a, a#video-title');
          if (!titleEl) return;
          const title = titleEl.textContent?.trim().toLowerCase() || '';
          if (keywords.some(k => title.includes(k))) card.style.display = 'none';
        });
      });
    }, 32);
  };

  run();
  const obs = new MutationObserver(run);
  obs.observe(document.body, { childList: true, subtree: true });
  OBS._keywordFilterObs = obs;
  window._keywordFilterObs = obs;
}

// ===== WATCH LATER SCRAPER =====
function extractWatchLaterVideos() {
  const items = [], seen = new Set();
  document.querySelectorAll('ytd-playlist-video-renderer, ytd-video-renderer').forEach(el => {
    try {
      const titleEl = el.querySelector('#video-title, h3 a, a#video-title');
      const channelEl = el.querySelector('ytd-channel-name a, .ytd-channel-name a, #channel-name a');
      if (!titleEl) return;
      const title = titleEl.textContent?.trim();
      const href = titleEl.href || titleEl.getAttribute('href') || '';
      const channel = channelEl?.textContent?.trim() || '';
      const match = href.match(/[?&]v=([^&]+)/);
      const id = match ? match[1] : href;
      if (title && id && !seen.has(id)) {
        seen.add(id);
        items.push({ id, title, channel, url: `https://www.youtube.com/watch?v=${id}` });
      }
    } catch (e) { /* skip */ }
  });
  return items;
}

// ===== LOCK MODE =====
function injectLockScreen() {
  if (document.getElementById('ytf-lock-screen')) return;

  const div = document.createElement('div');
  div.id = 'ytf-lock-screen';
  div.style.cssText = [
    'position:fixed', 'inset:0', 'z-index:2147483647',
    'background:#0a0a0b', 'display:flex', 'align-items:center',
    'justify-content:center', 'flex-direction:column',
  ].join(';');

  div.innerHTML = `
    <div style="font-family:'IBM Plex Mono',monospace;text-align:center;padding:40px 32px;max-width:440px;">
      <div style="font-size:11px;color:#606070;letter-spacing:.12em;text-transform:uppercase;margin-bottom:24px;">yt-focus · lock mode active</div>
      <div style="font-size:36px;margin-bottom:20px;">🔒</div>
      <div style="font-size:14px;color:#e8e8ec;font-weight:600;line-height:1.6;margin-bottom:12px;">YouTube is locked.</div>
      <div style="font-size:11px;color:#00d4aa;letter-spacing:.04em;line-height:1.8;border:1px solid #1a3a32;padding:12px 20px;margin-bottom:28px;background:rgba(0,212,170,.05);">
        &ldquo; Spend your time wisely&nbsp;&mdash;<br>don&rsquo;t wander off. &rdquo;
      </div>
      <div style="font-size:10px;color:#3a3a40;">Toggle off Lock Mode in the extension popup to continue.</div>
    </div>
  `;

  document.documentElement.appendChild(div);

  // Pause any playing video
  const vid = document.querySelector('video');
  if (vid) { vid.pause(); vid.muted = true; }
}

function removeLockScreen() {
  const el = document.getElementById('ytf-lock-screen');
  if (el) el.remove();
}

function injectUnlockCountdown(remaining) {
  let el = document.getElementById('ytf-unlock-countdown');
  if (!el) {
    el = document.createElement('div');
    el.id = 'ytf-unlock-countdown';
    el.style.cssText = [
      'position:fixed', 'bottom:0', 'left:0', 'right:0', 'z-index:2147483647',
      'background:#0a0a0b', 'border-top:1px solid #1a3a32',
      'font-family:\'IBM Plex Mono\',monospace', 'font-size:11px',
      'color:#00d4aa', 'text-align:center', 'padding:10px',
      'letter-spacing:.06em',
    ].join(';');
    document.documentElement.appendChild(el);
  }
  const text = `🔓 Lock mode off — browsing unlocked in ${remaining}s`;
  if (el.textContent !== text) el.textContent = text;
}

function removeUnlockCountdown() {
  const el = document.getElementById('ytf-unlock-countdown');
  if (el) el.remove();
}

// Interval instead of requestAnimationFrame: rAF burns a check on every frame
// and is throttled/paused in background tabs, which let locked tabs slip.
function startLockEnforcer() {
  if (_lockTimer) return;
  _lockTimer = setInterval(enforceLock, 300);
  enforceLock();
}

function enforceLock() {
  if (settings.lockMode) {
    removeUnlockCountdown();
    injectLockScreen();
    return;
  }
  const now = Date.now();
  if (_lockUnlockUntil > now) {
    injectUnlockCountdown(Math.ceil((_lockUnlockUntil - now) / 1000));
    injectLockScreen();
  } else {
    stopLockEnforcer();
  }
}

function stopLockEnforcer() {
  if (_lockTimer) {
    clearInterval(_lockTimer);
    _lockTimer = null;
  }
  removeLockScreen();
  removeUnlockCountdown();
}

// ===== MESSAGE LISTENER =====
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'getWatchLater') {
    sendResponse({ videos: extractWatchLaterVideos() });
  }
  // Settings changes propagate via chrome.storage.onChanged (all tabs);
  // keep accepting explicit pushes for backwards compatibility.
  if (message.action === 'applyFilters') {
    Object.assign(settings, message.settings || {});
    if (message.lockUnlockUntil !== undefined) _lockUnlockUntil = message.lockUnlockUntil;
    if (settings.lockMode || Date.now() < _lockUnlockUntil) startLockEnforcer();
    else stopLockEnforcer();
    restoreAll();
    applyFilters();
    sendResponse({ ok: true });
  }
});

// ===== RESTORE ALL =====
function restoreAll() {
  activeRules.clear();

  // Restore hidden elements
  ['#comments', '#secondary', 'ytd-rich-grid-renderer',
    'ytd-watch-next-secondary-results-renderer', 'ytd-item-section-renderer',
    'ytd-rich-item-renderer', 'ytd-video-renderer', 'ytd-compact-video-renderer',
    'ytd-playlist-video-renderer'].forEach(sel => {
      document.querySelectorAll(sel).forEach(el => { el.style.display = ''; });
    });

  showSearchbar();
  removeBlankOverlay();
  clearWatchBlock();
}
