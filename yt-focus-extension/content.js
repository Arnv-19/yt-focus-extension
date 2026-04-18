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

// Persistent MutationObserver handles for elements we keep hidden across SPA navs
let _sidebarObserver = null;
let _searchbarObserver = null;
let _commentsObserver = null;
// Channel whitelist gate state
let _watchGateActive = false;

// ===== BOOT =====
loadSettingsAndApply();

// Re-apply when YouTube navigates (SPA)
let lastUrl = location.href;
const navObserver = new MutationObserver(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    _watchGateActive = false; // reset per-navigation so new video/channel is re-checked
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
      settings.hideComments = data.hideComments !== undefined ? data.hideComments : true;
      settings.hideSidebar = data.hideSidebar !== undefined ? data.hideSidebar : true;
      settings.hideShorts = data.hideShorts !== undefined ? data.hideShorts : true;
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
  const isHome = path === '/' || path === '/feed/trending' || path === '/feed/subscriptions';
  const isWatch = path.startsWith('/watch');
  const isSearch = path === '/results';
  const isPlaylist = path === '/playlist';

  handleHomepage(isHome);

  // Hide homepage search bar
  if (isHome) {
    hideSearchbar();
  } else {
    showSearchbar();
  }

  if (isWatch) {
    if (settings.hideComments) persistHide('#comments', '_commentsObserver');

    if (settings.hideSidebar) {
      // Always hide the "related videos" panel — whether in a playlist or not.
      // When in a playlist we keep the playlist queue (#playlist) but kill recommendations.
      persistHide('ytd-watch-next-secondary-results-renderer', '_sidebarObserver');

      const inPlaylist = new URLSearchParams(location.search).has('list');
      if (!inPlaylist) {
        // No playlist — hide the entire sidebar column
        persistHide('#secondary', '_sidebar2Observer');
      } else {
        // In a playlist — restore the sidebar column so the queue is visible
        if (window._sidebar2Observer) { window._sidebar2Observer.disconnect(); window._sidebar2Observer = null; }
        const sec = document.querySelector('#secondary');
        if (sec) sec.style.display = '';
      }
    }

    // Channel whitelist gate on watch pages
    if (settings.allowedChannels.length > 0) {
      checkWatchPageChannel();
    }

    disableAutoplay();
  } else {
    // Not on a watch page — stop any sidebar/comments persistent hiders
    if (_sidebarObserver) { _sidebarObserver.disconnect(); _sidebarObserver = null; }
    if (_commentsObserver) { _commentsObserver.disconnect(); _commentsObserver = null; }
  }

  // Hide recommended videos below the playlist queue
  if (isPlaylist) hidePlaylistRecommended();

  if (settings.hideShorts) hideShorts();

  if (settings.allowedChannels.length > 0) {
    if (isHome) filterCardsByChannel('ytd-rich-item-renderer');
    if (isSearch) filterCardsByChannel('ytd-video-renderer');
  }

  if (settings.blockedKeywords.length > 0) {
    filterCardsByKeyword('ytd-rich-item-renderer');
    filterCardsByKeyword('ytd-video-renderer');
    filterCardsByKeyword('ytd-compact-video-renderer');
    filterCardsByKeyword('ytd-playlist-video-renderer');
  }

  hideClutter();
}

// ===== HOMEPAGE BLANKING =====
let overlayInjected = false;

function handleHomepage(isHome) {
  const overlay = document.getElementById('ytf-blank-overlay');

  if (!isHome || !settings.blankHomepage) {
    if (overlay) overlay.remove();
    overlayInjected = false;
    const grid = document.querySelector('ytd-rich-grid-renderer');
    if (grid) grid.style.display = '';
    return;
  }

  const grid = document.querySelector('ytd-rich-grid-renderer');
  if (grid) grid.style.display = 'none';

  if (!overlayInjected) {
    injectCmdOverlay();
    overlayInjected = true;
  }
}

// ===== HOMEPAGE SEARCH BAR =====
function hideSearchbar() {
  if (_searchbarObserver) return; // already running
  const selectors = ['#search', 'ytd-searchbox', '#search-form'];
  const hide = () => {
    selectors.forEach(sel => {
      document.querySelectorAll(sel).forEach(el => { el.style.visibility = 'hidden'; el.style.pointerEvents = 'none'; });
    });
  };
  hide();
  _searchbarObserver = new MutationObserver(hide);
  _searchbarObserver.observe(document.body, { childList: true, subtree: true });
}

function showSearchbar() {
  if (_searchbarObserver) { _searchbarObserver.disconnect(); _searchbarObserver = null; }
  ['#search', 'ytd-searchbox', '#search-form'].forEach(sel => {
    document.querySelectorAll(sel).forEach(el => {
      el.style.visibility = '';
      el.style.pointerEvents = '';
    });
  });
}

function injectCmdOverlay() {
  if (document.getElementById('ytf-blank-overlay')) return;

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
        <div class="ytf-line ytf-dim">> initializing YT Focus v2.0 ...</div>
        <div class="ytf-line ytf-green">> homepage recommendations [BLOCKED]</div>
        <div class="ytf-line ytf-green">> comments              [BLOCKED]</div>
        <div class="ytf-line ytf-green">> shorts                [BLOCKED]</div>
        <div class="ytf-line ytf-green">> sidebar suggestions   [BLOCKED]</div>
        <div class="ytf-line ytf-green">> end-screen cards      [BLOCKED]</div>
        <div class="ytf-line ytf-green">> autoplay              [DISABLED]</div>
        <div class="ytf-line ytf-dim">──────────────────────────────────────</div>
        <div class="ytf-line">> use the extension popup to search</div>
        <div class="ytf-line">> or navigate directly below</div>
        <div class="ytf-line ytf-dim">──────────────────────────────────────</div>
        <div class="ytf-shortcuts">
          <a href="https://www.youtube.com/playlist?list=WL"   class="ytf-shortcut">[watch later]</a>

        </div>
        <div class="ytf-line ytf-dim" style="margin-top:20px;">> C:\\Users\\focus&gt; <span class="ytf-cursor">█</span></div>
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

// ===== HIDE HELPERS =====

// One-shot hide (for non-persistent use)
function hideEl(selector) {
  const el = document.querySelector(selector);
  if (el) { el.style.display = 'none'; return; }
  const obs = new MutationObserver(() => {
    const found = document.querySelector(selector);
    if (found) { found.style.display = 'none'; obs.disconnect(); }
  });
  obs.observe(document.body, { childList: true, subtree: true });
}

// Persistent hide — keeps element hidden even when YouTube re-renders it
function persistHide(selector, observerKey) {
  // Apply immediately
  document.querySelectorAll(selector).forEach(el => { el.style.display = 'none'; });

  // Only create one observer per key
  if (window[observerKey]) return;

  const obs = new MutationObserver(() => {
    document.querySelectorAll(selector).forEach(el => { el.style.display = 'none'; });
  });
  obs.observe(document.body, { childList: true, subtree: true });
  window[observerKey] = obs;

  // Also store on module-level so we can disconnect later
  if (observerKey === '_sidebarObserver') _sidebarObserver = obs;
  if (observerKey === '_commentsObserver') _commentsObserver = obs;
}

function hideShorts() {
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
  new MutationObserver(applyHide).observe(document.body, { childList: true, subtree: true });
}

function hideClutter() {
  ['ytd-masthead .ytd-notification-topbar-button-renderer'].forEach(sel => {
    document.querySelectorAll(sel).forEach(el => { el.style.display = 'none'; });
  });
}

// ===== PLAYLIST PAGE — hide recommended sections below the queue =====
function hidePlaylistRecommended() {
  const run = () => {
    // YouTube injects "Up next" / related videos in item-section-renderers after the playlist header.
    // The playlist itself lives inside ytd-playlist-video-list-renderer.
    // Any ytd-item-section-renderer that appears outside that scope is recommendations.
    document.querySelectorAll(
      'ytd-browse ytd-item-section-renderer, ' +
      '#contents > ytd-item-section-renderer, ' +
      'ytd-section-list-renderer > #contents > ytd-item-section-renderer'
    ).forEach(el => { el.style.display = 'none'; });
  };
  run();
  new MutationObserver(run).observe(document.body, { childList: true, subtree: true });
}

// ===== CHANNEL WHITELIST — WATCH PAGE GATE =====

function checkWatchPageChannel() {
  if (_watchGateActive) return;
  _watchGateActive = true;

  const allowed = settings.allowedChannels.map(c => c.toLowerCase().trim());

  const tryBlock = () => {
    // Try multiple selectors YouTube uses for the channel name under a video
    const chanEl = document.querySelector(
      '#channel-name a, ytd-channel-name a, #owner #channel-name a, #upload-info ytd-channel-name a, #owner-name a'
    );
    if (!chanEl) return false;

    const chanName = chanEl.textContent?.trim().toLowerCase() || '';
    const isAllowed = allowed.some(a => chanName.includes(a) || a.includes(chanName));

    if (!isAllowed) {
      injectWatchBlockScreen(chanEl.textContent?.trim() || 'this channel');
    }
    return true;
  };

  if (!tryBlock()) {
    // Channel name not yet in DOM — wait for it
    const obs = new MutationObserver(() => {
      if (tryBlock()) obs.disconnect();
    });
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

  // Pause + mute the actual video element so it stops playing in the background
  const pauseVideo = () => {
    const vid = document.querySelector('video');
    if (vid) {
      vid.pause();
      vid.muted = true;
      // Keep it paused — YouTube sometimes tries to resume
      vid.addEventListener('play', () => { vid.pause(); }, { capture: true });
    }
  };
  pauseVideo();
  // Also try after a short delay in case the player isn't ready yet
  setTimeout(pauseVideo, 800);
  setTimeout(pauseVideo, 2000);

  // Visually hide the player area too
  ['#player', '#movie_player', '#player-container'].forEach(sel => {
    document.querySelectorAll(sel).forEach(el => { el.style.visibility = 'hidden'; });
  });
}

function escapeHtmlSimple(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ===== CHANNEL FILTER =====
function filterCardsByChannel(cardSelector) {
  const allowed = settings.allowedChannels.map(c => c.toLowerCase().trim());
  const run = () => {
    document.querySelectorAll(cardSelector).forEach(card => {
      const ch = card.querySelector('ytd-channel-name a, #channel-name a, #text.ytd-channel-name, .ytd-channel-name');
      if (!ch) return;
      const name = ch.textContent?.trim().toLowerCase() || '';
      card.style.display = allowed.some(a => name.includes(a) || a.includes(name)) ? '' : 'none';
    });
  };
  run();
  new MutationObserver(run).observe(document.body, { childList: true, subtree: true });
}

// ===== KEYWORD FILTER =====
function filterCardsByKeyword(cardSelector) {
  const keywords = settings.blockedKeywords.map(k => k.toLowerCase().trim()).filter(Boolean);
  if (!keywords.length) return;
  const run = () => {
    document.querySelectorAll(cardSelector).forEach(card => {
      const titleEl = card.querySelector('#video-title, h3 a, a#video-title');
      if (!titleEl) return;
      const title = titleEl.textContent?.trim().toLowerCase() || '';
      if (keywords.some(k => title.includes(k))) card.style.display = 'none';
    });
  };
  run();
  new MutationObserver(run).observe(document.body, { childList: true, subtree: true });
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

// ===== MESSAGE LISTENER =====
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'getWatchLater') {
    sendResponse({ videos: extractWatchLaterVideos() });
    return true;
  }
  if (message.action === 'applyFilters') {
    Object.assign(settings, message.settings || {});
    overlayInjected = false;
    const old = document.getElementById('ytf-blank-overlay');
    if (old) old.remove();
    restoreAll();
    setTimeout(applyFilters, 100);
    sendResponse({ ok: true });
    return true;
  }
});

function restoreAll() {
  // Disconnect persistent observers before restoring
  if (_sidebarObserver) { _sidebarObserver.disconnect(); _sidebarObserver = null; }
  if (_commentsObserver) { _commentsObserver.disconnect(); _commentsObserver = null; }
  if (window._sidebarObserver) { window._sidebarObserver.disconnect(); window._sidebarObserver = null; }
  if (window._commentsObserver) { window._commentsObserver.disconnect(); window._commentsObserver = null; }

  ['#comments', '#secondary', 'ytd-rich-grid-renderer'].forEach(sel => {
    document.querySelectorAll(sel).forEach(el => { el.style.display = ''; });
  });

  // Remove watch block screen if present
  const wb = document.getElementById('ytf-watch-block');
  if (wb) wb.remove();
  ['#player', '#movie_player', '#player-container', 'ytd-watch-flexy'].forEach(sel => {
    document.querySelectorAll(sel).forEach(el => { el.style.visibility = ''; });
  });

  _watchGateActive = false;
}
