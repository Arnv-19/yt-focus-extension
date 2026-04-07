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

// ===== BOOT =====
loadSettingsAndApply();

// Re-apply when YouTube navigates (SPA)
let lastUrl = location.href;
const navObserver = new MutationObserver(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
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
  const isHome = path === '/' || path === '/feed/trending' || path === '/feed/subscriptions';
  const isWatch = path.startsWith('/watch');
  const isSearch = path === '/results';

  handleHomepage(isHome);

  if (isWatch) {
    if (settings.hideComments) hideEl('#comments');

    if (settings.hideSidebar) {
      const inPlaylist = new URLSearchParams(location.search).has('list');
      if (!inPlaylist) {
        hideEl('#secondary');
      } else {
        const sec = document.querySelector('#secondary');
        if (sec) sec.style.display = '';
      }
    }

    disableAutoplay();
  }

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
function hideEl(selector) {
  const el = document.querySelector(selector);
  if (el) { el.style.display = 'none'; return; }
  const obs = new MutationObserver(() => {
    const found = document.querySelector(selector);
    if (found) { found.style.display = 'none'; obs.disconnect(); }
  });
  obs.observe(document.body, { childList: true, subtree: true });
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
  ['#comments', '#secondary', 'ytd-rich-grid-renderer'].forEach(sel => {
    document.querySelectorAll(sel).forEach(el => { el.style.display = ''; });
  });
}
