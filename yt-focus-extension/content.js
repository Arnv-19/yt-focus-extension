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
};

// ===== MODULE-LEVEL OBSERVER REGISTRY =====
// All persistent observers stored here — single source of truth.
// Keys map to window[key] for easy lookup; we also track them here for restoreAll().
const OBS = {
  _sidebarObserver:      null,   // ytd-watch-next-secondary-results-renderer
  _sidebar2Observer:     null,   // #secondary (non-playlist watch pages)
  _commentsObserver:     null,   // #comments
  _searchbarObserver:    null,   // homepage search bar
  _shortsObserver:       null,   // shorts shelf + chips
  _playlistRecObserver:  null,   // playlist page recommendations
  _channelFilterObs:     null,   // home/search channel allow-list cards
  _keywordFilterObs:     null,   // keyword blocklist cards
};

// Channel whitelist gate state — reset on every SPA navigation
let _watchGateActive = false;

// ===== BOOT =====
loadSettingsAndApply();

// Re-apply when YouTube navigates (SPA)
let lastUrl = location.href;
const navObserver = new MutationObserver(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    // Reset per-page watch gate
    _watchGateActive = false;
    const wb = document.getElementById('ytf-watch-block');
    if (wb) wb.remove();
    ['#player', '#movie_player', '#player-container', 'ytd-watch-flexy'].forEach(sel => {
      document.querySelectorAll(sel).forEach(el => { el.style.visibility = ''; });
    });
    setTimeout(applyFilters, 600);
  }
});
navObserver.observe(document.body, { childList: true, subtree: true });

// ===== LOAD SETTINGS =====
function loadSettingsAndApply() {
  chrome.storage.local.get(
    ['blankHomepage', 'hideComments', 'hideSidebar', 'hideShorts',
      'allowedChannels', 'blockedKeywords'],
    (data) => {
      settings.blankHomepage = data.blankHomepage !== undefined ? data.blankHomepage : true;
      settings.hideComments  = data.hideComments  !== undefined ? data.hideComments  : true;
      settings.hideSidebar   = data.hideSidebar   !== undefined ? data.hideSidebar   : true;
      settings.hideShorts    = data.hideShorts    !== undefined ? data.hideShorts    : true;
      settings.allowedChannels = data.allowedChannels || [];
      settings.blockedKeywords = data.blockedKeywords || [];
      applyFilters();
    }
  );
}

// ===== MAIN APPLY =====
function applyFilters() {
  const path = location.pathname;
  // Only blank the main home/trending/subscriptions feeds — not account pages etc.
  const isHome     = path === '/' || path === '/feed/trending' || path === '/feed/subscriptions';
  const isWatch    = path.startsWith('/watch');
  const isSearch   = path === '/results';
  const isPlaylist = path === '/playlist';

  handleHomepage(isHome);

  // Hide/restore homepage search bar
  if (isHome) hideSearchbar(); else showSearchbar();

  if (isWatch) {
    if (settings.hideComments) persistHide('#comments', '_commentsObserver');

    if (settings.hideSidebar) {
      // Always kill the related-videos panel (even inside playlists)
      persistHide('ytd-watch-next-secondary-results-renderer', '_sidebarObserver');

      const inPlaylist = new URLSearchParams(location.search).has('list');
      if (!inPlaylist) {
        // No playlist — collapse the entire sidebar column
        persistHide('#secondary', '_sidebar2Observer');
      } else {
        // In a playlist — show the sidebar column (for the queue) but related videos stay hidden above
        disconnectObs('_sidebar2Observer');
        const sec = document.querySelector('#secondary');
        if (sec) sec.style.display = '';
      }
    }

    // Channel whitelist gate
    if (settings.allowedChannels.length > 0) checkWatchPageChannel();

    disableAutoplay();
  } else {
    // Leaving a watch page — release watch-page-only observers
    disconnectObs('_sidebarObserver');
    disconnectObs('_sidebar2Observer');
    disconnectObs('_commentsObserver');
  }

  // Playlist page — hide recommended sections below the queue
  if (isPlaylist) {
    hidePlaylistRecommended();
  } else {
    disconnectObs('_playlistRecObserver');
  }

  if (settings.hideShorts) hideShorts();

  if (settings.allowedChannels.length > 0) {
    if (isHome)   filterCardsByChannel('ytd-rich-item-renderer');
    if (isSearch) filterCardsByChannel('ytd-video-renderer');
  }

  if (settings.blockedKeywords.length > 0) {
    filterCardsByKeyword([
      'ytd-rich-item-renderer',
      'ytd-video-renderer',
      'ytd-compact-video-renderer',
      'ytd-playlist-video-renderer',
    ]);
  }

  hideClutter();
}

// ===== OBSERVER HELPERS =====

/** Disconnect and null out a named observer from the OBS registry */
function disconnectObs(key) {
  if (OBS[key]) { OBS[key].disconnect(); OBS[key] = null; }
  if (window[key]) { window[key].disconnect(); window[key] = null; }
}

/** Disconnect ALL registered observers */
function disconnectAllObs() {
  Object.keys(OBS).forEach(disconnectObs);
}

/**
 * persistHide — keeps an element hidden even when YouTube re-renders it.
 * Singleton: only one observer per key is ever created.
 */
function persistHide(selector, key) {
  // Immediately apply
  document.querySelectorAll(selector).forEach(el => { el.style.display = 'none'; });

  // Guard — don't create a second observer if one already exists
  if (OBS[key]) return;

  const obs = new MutationObserver(() => {
    document.querySelectorAll(selector).forEach(el => { el.style.display = 'none'; });
  });
  obs.observe(document.body, { childList: true, subtree: true });
  OBS[key] = obs;
  window[key] = obs; // keep window ref consistent for any external checks
}

// ===== HOMEPAGE BLANKING =====
// Trust the DOM check alone — no redundant boolean needed (issue #12)
function handleHomepage(isHome) {
  const overlay = document.getElementById('ytf-blank-overlay');

  if (!isHome || !settings.blankHomepage) {
    if (overlay) overlay.remove();
    const grid = document.querySelector('ytd-rich-grid-renderer');
    if (grid) grid.style.display = '';
    return;
  }

  const grid = document.querySelector('ytd-rich-grid-renderer');
  if (grid) grid.style.display = 'none';

  // injectCmdOverlay already guards via getElementById — no extra flag needed
  injectCmdOverlay();
}

// ===== HOMEPAGE SEARCH BAR =====
function hideSearchbar() {
  if (OBS._searchbarObserver) return; // already running
  const selectors = ['#search', 'ytd-searchbox', '#search-form'];
  const hide = () => {
    selectors.forEach(sel => {
      document.querySelectorAll(sel).forEach(el => {
        el.style.visibility = 'hidden';
        el.style.pointerEvents = 'none';
      });
    });
  };
  hide();
  const obs = new MutationObserver(hide);
  obs.observe(document.body, { childList: true, subtree: true });
  OBS._searchbarObserver = obs;
  window._searchbarObserver = obs;
}

function showSearchbar() {
  disconnectObs('_searchbarObserver');
  ['#search', 'ytd-searchbox', '#search-form'].forEach(sel => {
    document.querySelectorAll(sel).forEach(el => {
      el.style.visibility = '';
      el.style.pointerEvents = '';
    });
  });
}

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
      const link  = chip.querySelector('a');
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
      '#contents > ytd-item-section-renderer, ' +
      'ytd-section-list-renderer > #contents > ytd-item-section-renderer'
    ).forEach(el => { el.style.display = 'none'; });
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

    const chanName  = chanEl.textContent?.trim().toLowerCase() || '';
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
      const titleEl   = el.querySelector('#video-title, h3 a, a#video-title');
      const channelEl = el.querySelector('ytd-channel-name a, .ytd-channel-name a, #channel-name a');
      if (!titleEl) return;
      const title   = titleEl.textContent?.trim();
      const href    = titleEl.href || titleEl.getAttribute('href') || '';
      const channel = channelEl?.textContent?.trim() || '';
      const match   = href.match(/[?&]v=([^&]+)/);
      const id      = match ? match[1] : href;
      if (title && id && !seen.has(id)) {
        seen.add(id);
        items.push({ id, title, channel, url: `https://www.youtube.com/watch?v=${id}` });
      }
    } catch (e) { /* skip */ }
  });
  return items;
}

// ===== MESSAGE LISTENER =====
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'getWatchLater') {
    sendResponse({ videos: extractWatchLaterVideos() });
    return true;
  }
  if (message.action === 'applyFilters') {
    Object.assign(settings, message.settings || {});
    const old = document.getElementById('ytf-blank-overlay');
    if (old) old.remove();
    restoreAll();
    setTimeout(applyFilters, 100);
    sendResponse({ ok: true });
    return true;
  }
});

// ===== RESTORE ALL =====
function restoreAll() {
  // Disconnect every registered observer (issue #3)
  disconnectAllObs();

  // Restore hidden elements
  ['#comments', '#secondary', 'ytd-rich-grid-renderer',
    'ytd-watch-next-secondary-results-renderer', 'ytd-item-section-renderer'].forEach(sel => {
    document.querySelectorAll(sel).forEach(el => { el.style.display = ''; });
  });

  // Restore search bar visibility
  ['#search', 'ytd-searchbox', '#search-form'].forEach(sel => {
    document.querySelectorAll(sel).forEach(el => {
      el.style.visibility = ''; el.style.pointerEvents = '';
    });
  });

  // Remove watch block screen
  const wb = document.getElementById('ytf-watch-block');
  if (wb) wb.remove();
  ['#player', '#movie_player', '#player-container', 'ytd-watch-flexy'].forEach(sel => {
    document.querySelectorAll(sel).forEach(el => { el.style.visibility = ''; });
  });

  _watchGateActive = false;
}
