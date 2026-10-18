// ===== YT FOCUS v2.0 — CONTENT SCRIPT =====

let settings = {
  blankHomepage: true,
  hideThumbnails: true,
  hideComments: true,
  hideSidebar: true,
  hideShorts: true,
  focusMode: false, // Strict Focus Mode toggle
  allowedChannels: [],
  blockedChannels: [],
  blockedKeywords: [],
  productiveGroups: {},
  savedPlaylists: [
    { name: 'watch later', url: 'https://www.youtube.com/playlist?list=WL' }
  ],
  dailyLimitMinutes: 60,
  watchedSecondsToday: 0,
  lockMode: false,
  lockReason: ''
};

let _lockUnlockUntil = 0;
let _lockTimer = null;
let _watchGateDone = false;
let _blockPlayback = false;
let lastUrl = location.href;

document.addEventListener('play', (e) => {
  if ((_blockPlayback || isLockedNow()) && e.target instanceof HTMLMediaElement) {
    e.target.pause();
  }
}, { capture: true });

document.addEventListener('keydown', (e) => {
  if (_blockPlayback || isLockedNow()) {
    if ([' ', 'k', 'K', 'j', 'J', 'l', 'L', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
      e.stopPropagation();
      e.preventDefault();
    }
  }
}, { capture: true });

function isLockedNow() {
  return settings.lockMode || Date.now() < _lockUnlockUntil;
}

setInterval(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    clearWatchBlock();
    document.getElementById('ytf-channel-page-bar')?.remove();
    applyFilters();
  }
}, 150);

setInterval(() => {
  if (!location.pathname.startsWith('/watch')) return;
  if (isLockedNow() || _blockPlayback) return;
  const vid = document.querySelector('video');
  if (vid && !vid.paused && !vid.ended && vid.readyState > 2) {
    chrome.runtime.sendMessage({ action: 'watchHeartbeat', seconds: 5 }, (res) => {
      if (chrome.runtime.lastError) return;
      if (res?.watchedSecondsToday !== undefined) settings.watchedSecondsToday = res.watchedSecondsToday;
      if (res?.locked) {
        settings.lockMode = true;
        startLockEnforcer();
      }
    });
  }
}, 5000);

const activeRules = new Map();
let _rulesTimer = null;
const masterObserver = new MutationObserver(() => {
  if (_rulesTimer) return;
  _rulesTimer = setTimeout(() => {
    _rulesTimer = null;
    runRules();
  }, 150);
});
masterObserver.observe(document.documentElement, { childList: true, subtree: true });

function runRules() {
  activeRules.forEach(fn => {
    try { fn(); } catch (e) { }
  });
}

window.addEventListener('yt-navigate-finish', onNavigate);
window.addEventListener('popstate', onNavigate);

function onNavigate() {
  lastUrl = location.href;
  clearWatchBlock();
  applyFilters();
}

loadSettingsAndApply();

function loadSettingsAndApply() {
  chrome.storage.local.get(null, (data) => {
    syncSettingsFromData(data);
    applyFilters();
    if (isLockedNow()) startLockEnforcer();
  });
}

function syncSettingsFromData(data) {
  if (!data) return;
  Object.keys(settings).forEach(k => {
    if (data[k] !== undefined) settings[k] = data[k];
  });
  if (data.lockUnlockUntil !== undefined) _lockUnlockUntil = data.lockUnlockUntil || 0;
  document.documentElement.classList.toggle('ytf-hide-thumbnails', !!settings.hideThumbnails);
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  chrome.storage.local.get(null, (data) => {
    syncSettingsFromData(data);
    if (isLockedNow()) startLockEnforcer(); else stopLockEnforcer();
    restoreAll();
    applyFilters();
  });
});

function applyFilters() {
  document.documentElement.classList.toggle('ytf-hide-thumbnails', !!settings.hideThumbnails);
  const path = location.pathname;
  const isHome = path === '/' || path === '/feed/trending';
  const isWatch = path.startsWith('/watch');
  const isPlaylist = path === '/playlist';
  const isChannelPage = path.startsWith('/@') || path.startsWith('/channel/') || path.startsWith('/c/') || path.startsWith('/user/');

  activeRules.clear();

  if (isHome && settings.blankHomepage) activeRules.set('homepage', ruleHomepage);
  else {
    removeBlankOverlay();
    const grid = document.querySelector('ytd-rich-grid-renderer');
    if (grid) grid.style.display = '';
  }

  if (isWatch) {
    if (settings.hideComments) activeRules.set('comments', () => hideAll('#comments'));
    if (settings.hideSidebar) {
      activeRules.set('sidebarRelated', () => hideAll('ytd-watch-next-secondary-results-renderer'));
      if (!new URLSearchParams(location.search).has('list')) activeRules.set('sidebarColumn', () => hideAll('#secondary'));
      else { const sec = document.querySelector('#secondary'); if (sec) sec.style.display = ''; }
    }
    // Strict Focus Mode or standard Watch Gate check
    if (settings.focusMode || settings.allowedChannels.length > 0 || settings.blockedChannels.length > 0) {
      activeRules.set('watchGate', ruleWatchGate);
    }
    activeRules.set('autoplayOff', ruleAutoplayOff);
  }

  if (isChannelPage) activeRules.set('channelPageBanner', ruleChannelPageBanner);
  if (isPlaylist) activeRules.set('playlistRec', rulePlaylistRecommended);
  if (settings.hideShorts) activeRules.set('shorts', ruleHideShorts);

  // Apply card filtering if focus mode is on or allow-lists/block-lists are active
  if ((settings.focusMode || settings.allowedChannels.length > 0 || settings.blockedChannels.length > 0) && !isHome && !isChannelPage) {
    activeRules.set('channelCards', ruleChannelCards);
  }

  if (settings.blockedKeywords.length > 0) activeRules.set('keywordCards', ruleKeywordCards);
  activeRules.set('channelActionPills', ruleInjectChannelPills);
  activeRules.set('searchAds', ruleHideSearchAds);
  activeRules.set('clutter', () => hideAll('ytd-masthead .ytd-notification-topbar-button-renderer'));
  runRules();
}

function hideAll(selector) {
  document.querySelectorAll(selector).forEach(el => {
    if (el.style.display !== 'none') el.style.display = 'none';
  });
}

function ruleHomepage() {
  const grid = document.querySelector('ytd-rich-grid-renderer');
  if (grid && grid.style.display !== 'none') grid.style.display = 'none';
  injectCmdOverlay();
}

function removeBlankOverlay() { document.getElementById('ytf-blank-overlay')?.remove(); }
function ruleAutoplayOff() { document.querySelector('.ytp-autonav-toggle-button[aria-checked="true"]')?.click(); }

function ruleHideShorts() {
  ['ytd-reel-shelf-renderer', 'ytd-rich-shelf-renderer[is-shorts]', '#guide-inner-content ytd-guide-entry-renderer a[href="/shorts"]', 'ytd-mini-guide-entry-renderer a[href="/shorts"]', 'ytd-reel-item-renderer'].forEach(hideAll);
  document.querySelectorAll('ytd-video-renderer').forEach(card => {
    const a = card.querySelector('a#thumbnail, a#video-title');
    if (a && a.getAttribute('href')?.startsWith('/shorts/')) card.style.display = 'none';
  });
}

function ruleHideSearchAds() {
  // Target only distinct ad modules, never search result containers
  document.querySelectorAll('ytd-promoted-sparkles-web-renderer, ytd-search-pyv-renderer, #masthead-ad, ytd-ad-slot-renderer').forEach(el => {
    el.style.display = 'none';
  });
}

function rulePlaylistRecommended() {
  document.querySelectorAll('ytd-browse ytd-item-section-renderer').forEach(el => {
    if (!el.querySelector('ytd-playlist-video-list-renderer') && el.style.display !== 'none') el.style.display = 'none';
  });
}

function isChannelPermitted(channelName) {
  const norm = (channelName || '').trim().toLowerCase();

  // 1. If Focus Mode is OFF, everything is permitted by default (unless explicitly blocked)
  if (!settings.focusMode) {
    const blocked = settings.blockedChannels.map(c => c.toLowerCase().trim()).filter(Boolean);
    if (blocked.some(b => norm.includes(b.replace(/^@/, '')))) return false;
    return true; // Never block unwhitelisted channels when Focus Mode is off!
  }

  // 2. If Focus Mode is ON, it must be explicitly on the allow-list
  if (!norm) return false;
  const blocked = settings.blockedChannels.map(c => c.toLowerCase().trim()).filter(Boolean);
  if (blocked.some(b => norm.includes(b.replace(/^@/, '')))) return false;

  const allowed = settings.allowedChannels.map(c => c.toLowerCase().trim()).filter(Boolean);
  return allowed.some(a => norm.includes(a.replace(/^@/, '')));
}

function ruleChannelCards() {
  ['ytd-rich-item-renderer', 'ytd-video-renderer', 'ytd-compact-video-renderer'].forEach(sel => {
    document.querySelectorAll(sel).forEach(card => {
      const ch = card.querySelector('ytd-channel-name a, #channel-name a, #text.ytd-channel-name');
      if (!ch) return;
      const want = isChannelPermitted(ch.textContent?.trim() || '') ? '' : 'none';
      if (card.style.display !== want) card.style.display = want;
    });
  });
}

function ruleKeywordCards() {
  const keywords = settings.blockedKeywords.map(k => k.toLowerCase().trim()).filter(Boolean);
  if (!keywords.length) return;
  ['ytd-rich-item-renderer', 'ytd-video-renderer', 'ytd-compact-video-renderer', 'ytd-playlist-video-renderer'].forEach(sel => {
    document.querySelectorAll(sel).forEach(card => {
      if (card.style.display === 'none') return;
      const title = card.querySelector('#video-title, h3 a, a#video-title')?.textContent?.trim().toLowerCase() || '';
      if (title && keywords.some(k => title.includes(k))) card.style.display = 'none';
    });
  });
}

function ruleChannelPageBanner() {
  if (document.getElementById('ytf-channel-page-bar')) return;
  const rawName = document.querySelector('yt-page-header-view-model h1, #channel-header-container #channel-name, ytd-channel-name#channel-name')?.textContent?.trim()?.split('\n')?.[0]?.trim();
  const targetContainer = document.querySelector('#page-header, #channel-header, ytd-tabbed-page-header');
  if (!rawName || !targetContainer) return;

  const bar = document.createElement('div');
  bar.id = 'ytf-channel-page-bar';
  const lbl = document.createElement('span');
  lbl.innerHTML = '<strong style="color:#00d4aa;">[YT·FOCUS]</strong> Channel: <strong>' + escapeHtmlSimple(rawName) + '</strong>';
  bar.appendChild(lbl);
  bar.appendChild(createActionPills(rawName));
  targetContainer.prepend(bar);
}

function createActionPills(rawName) {
  const wrap = document.createElement('span');
  wrap.className = 'ytf-chan-actions';
  const isAllowed = settings.allowedChannels.some(a => a.toLowerCase() === rawName.toLowerCase());
  const isBlocked = settings.blockedChannels.some(b => b.toLowerCase() === rawName.toLowerCase());

  const allowBtn = document.createElement('button');
  allowBtn.className = 'ytf-pill-btn allow ' + (isAllowed ? 'is-active' : '');
  allowBtn.textContent = isAllowed ? '[✓ allowed]' : '[+ allow]';

  const blockBtn = document.createElement('button');
  blockBtn.className = 'ytf-pill-btn block ' + (isBlocked ? 'is-active' : '');
  blockBtn.textContent = isBlocked ? '[✓ blocked]' : '[✕ block]';

  const catBtn = document.createElement('button');
  catBtn.className = 'ytf-pill-btn cat';
  catBtn.textContent = '[+ category]';

  allowBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); toggleChannelInList('allowedChannels', rawName, 'blockedChannels'); });
  blockBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); toggleChannelInList('blockedChannels', rawName, 'allowedChannels'); });
  catBtn.addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation();
    const existingCats = Object.keys(settings.productiveGroups || {});
    const hint = existingCats.length ? 'Existing: ' + existingCats.join(', ') : 'e.g. coding, math, science';
    const chosen = prompt('Add "' + rawName + '" to which Productive Category?\n(' + hint + ')');
    if (!chosen || !chosen.trim()) return;
    const cat = chosen.trim();
    const groups = { ...(settings.productiveGroups || {}) };
    if (!groups[cat]) groups[cat] = [];
    if (!groups[cat].some(c => c.toLowerCase() === rawName.toLowerCase())) groups[cat].push(rawName);
    chrome.storage.local.set({ productiveGroups: groups, activeProductiveGroup: cat });
    catBtn.textContent = '[✓ ' + cat + ']';
  });

  wrap.appendChild(allowBtn); wrap.appendChild(blockBtn); wrap.appendChild(catBtn);
  return wrap;
}

function ruleInjectChannelPills() {
  document.querySelectorAll('ytd-watch-metadata ytd-channel-name, ytd-video-renderer ytd-channel-name, ytd-rich-item-renderer ytd-channel-name, ytd-playlist-video-renderer ytd-channel-name, ytd-channel-renderer ytd-channel-name').forEach(container => {
    if (container.querySelector('.ytf-chan-actions')) return;
    const rawName = container.querySelector('#text a, #text, a')?.textContent?.trim();
    if (rawName) container.appendChild(createActionPills(rawName));
  });
}

function toggleChannelInList(targetKey, channelName, oppositeKey) {
  chrome.storage.local.get([targetKey, oppositeKey], (data) => {
    let targetList = data[targetKey] || [];
    let oppositeList = data[oppositeKey] || [];
    if (targetList.some(c => c.toLowerCase() === channelName.toLowerCase())) {
      targetList = targetList.filter(c => c.toLowerCase() !== channelName.toLowerCase());
    } else {
      targetList.push(channelName);
      oppositeList = oppositeList.filter(c => c.toLowerCase() !== channelName.toLowerCase());
    }
    document.querySelectorAll('.ytf-chan-actions, #ytf-channel-page-bar').forEach(el => el.remove());
    chrome.storage.local.set({ [targetKey]: targetList, [oppositeKey]: oppositeList });
  });
}

function ruleWatchGate() {
  if (_watchGateDone) return;
  const chanName = document.querySelector('ytd-watch-metadata ytd-channel-name a, #owner #channel-name a')?.textContent?.trim() || '';
  if (!chanName) return;
  _watchGateDone = true;
  if (!isChannelPermitted(chanName)) injectWatchBlockScreen(chanName);
}

function injectWatchBlockScreen(channelName) {
  if (document.getElementById('ytf-watch-block')) return;
  const div = document.createElement('div');
  div.id = 'ytf-watch-block';
  div.innerHTML = `
    <div class="ytf-cmd-window">
      <div class="ytf-cmd-titlebar"><span class="ytf-cmd-title">C:\\Users\\focus> yt-focus.exe — access denied</span></div>
      <div class="ytf-cmd-body">
        <div class="ytf-line ytf-red">> ACCESS DENIED ${settings.focusMode ? '(FOCUS MODE ACTIVE)' : ''}</div>
        <div class="ytf-line">channel: <span class="ytf-yellow">${escapeHtmlSimple(channelName)}</span></div>
        <div class="ytf-line ytf-dim">> this channel is not on your allowed whitelist.</div>
        <div class="ytf-shortcuts" style="margin-top:14px;">
          <a href="#" class="ytf-shortcut" id="ytf-block-back">[← go back]</a>
          <a href="https://www.youtube.com" class="ytf-shortcut">[home]</a>
          <button type="button" class="ytf-shortcut" id="ytf-quick-allow">[+ whitelist "${escapeHtmlSimple(channelName)}"]</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(div);
  div.querySelector('#ytf-block-back')?.addEventListener('click', (e) => { e.preventDefault(); history.back(); });

  // Double-ask confirmation prompt before whitelisting when Focus Mode is on
  div.querySelector('#ytf-quick-allow')?.addEventListener('click', () => {
    if (settings.focusMode) {
      const confirmAdd = confirm(`Focus Mode is active!\n\nAre you sure you want to permanently add "${channelName}" to your allowed whitelist?`);
      if (!confirmAdd) return;
    }
    toggleChannelInList('allowedChannels', channelName, 'blockedChannels');
    clearWatchBlock();
    location.reload();
  });

  _blockPlayback = true;
  const vid = document.querySelector('video');
  if (vid) { vid.pause(); vid.muted = true; }
}

function clearWatchBlock() { _watchGateDone = false; _blockPlayback = false; document.getElementById('ytf-watch-block')?.remove(); }

function injectCmdOverlay() {
  if (document.getElementById('ytf-blank-overlay')) return;
  const watchedMin = Math.floor((settings.watchedSecondsToday || 0) / 60);
  const limitStr = settings.dailyLimitMinutes > 0 ? settings.dailyLimitMinutes + 'm' : '∞';
  const playlistsHtml = (settings.savedPlaylists || []).map(pl => `<a href="${escapeHtmlSimple(pl.url)}" class="ytf-shortcut">[${escapeHtmlSimple(pl.name)}]</a>`).join('');

  const div = document.createElement('div');
  div.id = 'ytf-blank-overlay';
  div.innerHTML = `
    <div class="ytf-cmd-window">
      <div class="ytf-cmd-titlebar">
        <span class="ytf-cmd-title">C:\\Users\\focus> yt-focus.exe — INTERACTIVE CLI v2.0</span>
        <div class="ytf-cmd-dots"><span class="ytf-dot ytf-dot-r"></span><span class="ytf-dot ytf-dot-y"></span><span class="ytf-dot ytf-dot-g"></span></div>
      </div>
      <div class="ytf-cmd-body">
        <div class="ytf-line ytf-dim">> YT Focus v2.0 | focus mode: <span class="${settings.focusMode ? 'ytf-green' : 'ytf-yellow'}">[${settings.focusMode ? 'ON' : 'OFF'}]</span> | watched: <span class="ytf-green">${watchedMin}m / ${limitStr}</span></div>
        <div class="ytf-status-grid">
          <div class="ytf-line">> thumbnails: <span class="${settings.hideThumbnails ? 'ytf-green' : 'ytf-yellow'}">[${settings.hideThumbnails ? 'HIDDEN' : 'VISIBLE'}]</span></div>
          <div class="ytf-line">> comments: <span class="${settings.hideComments ? 'ytf-green' : 'ytf-yellow'}">[${settings.hideComments ? 'BLOCKED' : 'ON'}]</span></div>
          <div class="ytf-line">> shorts: <span class="${settings.hideShorts ? 'ytf-green' : 'ytf-yellow'}">[${settings.hideShorts ? 'BLOCKED' : 'ON'}]</span></div>
          <div class="ytf-line">> sidebar: <span class="${settings.hideSidebar ? 'ytf-green' : 'ytf-yellow'}">[${settings.hideSidebar ? 'BLOCKED' : 'ON'}]</span></div>
        </div>
        <div class="ytf-line ytf-dim">> saved playlists &amp; feeds:</div>
        <div class="ytf-shortcuts">${playlistsHtml}<a href="https://www.youtube.com/feed/subscriptions" class="ytf-shortcut">[subscriptions]</a><a href="https://www.youtube.com/feed/playlists" class="ytf-shortcut">[all playlists]</a></div>
        <form class="ytf-cli-form" id="ytf-cli-form">
          <span class="ytf-cli-prompt">C:\\Users\\focus></span>
          <input type="text" class="ytf-cli-input" id="ytf-cli-input" placeholder="Type search or command (/wl, /focus on/off, /allow name)..." autocomplete="off" />
          <button type="submit" class="ytf-cli-submit">RUN ↵</button>
        </form>
        <div class="ytf-cli-feedback" id="ytf-cli-feedback"></div>
      </div>
    </div>
  `;

  document.body.appendChild(div);
  const form = div.querySelector('#ytf-cli-form');
  const input = div.querySelector('#ytf-cli-input');
  const feedback = div.querySelector('#ytf-cli-feedback');
  setTimeout(() => input?.focus(), 50);

  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    const raw = input.value.trim();
    if (!raw) return;
    input.value = '';

    if (!raw.startsWith('/')) {
      removeBlankOverlay();
      window.location.assign('https://www.youtube.com/results?search_query=' + encodeURIComponent(raw));
      return;
    }

    const [cmd, ...rest] = raw.split(' ');
    const arg = rest.join(' ').trim();
    switch (cmd.toLowerCase()) {
      case '/help': feedback.textContent = 'Commands: /wl, /subs, /playlists, /focus on/off, /lock, /allow <channel>'; break;
      case '/wl': removeBlankOverlay(); window.location.assign('https://www.youtube.com/playlist?list=WL'); break;
      case '/subs': removeBlankOverlay(); window.location.assign('https://www.youtube.com/feed/subscriptions'); break;
      case '/playlists': removeBlankOverlay(); window.location.assign('https://www.youtube.com/feed/playlists'); break;
      case '/focus':
        if (arg === 'on' || arg === 'off') {
          const val = arg === 'on';
          chrome.storage.local.set({ focusMode: val });
          feedback.textContent = 'Focus mode set to: ' + arg.toUpperCase();
        } else {
          feedback.textContent = 'Usage: /focus on or /focus off';
        }
        break;
      case '/lock': chrome.storage.local.set({ lockMode: true, lockReason: 'manual' }); break;
      case '/allow':
        if (arg) {
          toggleChannelInList('allowedChannels', arg, 'blockedChannels');
          feedback.textContent = 'Allowed channel: ' + arg;
        }
        break;
      default: feedback.textContent = 'Unknown command. Try /help or type any search term.';
    }
  });
}

function getCurrentChannelName() {
  return document.querySelector('ytd-watch-metadata ytd-channel-name a, #owner #channel-name a, yt-page-header-view-model h1, ytd-channel-name a')?.textContent?.trim()?.split('\n')?.[0]?.trim() || '';
}

function injectLockScreen(countdownSec = 0) {
  let div = document.getElementById('ytf-lock-screen');
  const subText = countdownSec > 0 ? 'Unlocking in ' + countdownSec + 's...' : 'Toggle off Lock Mode in the extension popup to continue.';
  if (!div) {
    div = document.createElement('div');
    div.id = 'ytf-lock-screen';
    div.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:#0a0a0b;display:flex;align-items:center;justify-content:center;flex-direction:column;';
    document.documentElement.appendChild(div);
  }
  div.innerHTML = `
    <div style="font-family:'IBM Plex Mono',monospace;text-align:center;padding:40px 32px;max-width:460px;">
      <div style="font-size:15px;color:#e8e8ec;font-weight:600;margin-bottom:14px;">🔒 YouTube is locked.</div>
      <div style="font-size:11px;color:#febc2e;">${escapeHtmlSimple(subText)}</div>
    </div>
  `;
  const vid = document.querySelector('video');
  if (vid) { vid.pause(); vid.muted = true; }
}

function startLockEnforcer() {
  if (_lockTimer) return;
  _lockTimer = setInterval(() => {
    if (settings.lockMode) { injectLockScreen(0); return; }
    const now = Date.now();
    if (_lockUnlockUntil > now) injectLockScreen(Math.ceil((_lockUnlockUntil - now) / 1000));
    else stopLockEnforcer();
  }, 300);
}

function stopLockEnforcer() {
  if (_lockTimer) { clearInterval(_lockTimer); _lockTimer = null; }
  document.getElementById('ytf-lock-screen')?.remove();
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'getCurrentChannel') sendResponse({ channel: getCurrentChannelName() });
});

function restoreAll() {
  activeRules.clear();
  ['#comments', '#secondary', 'ytd-rich-grid-renderer', 'ytd-watch-next-secondary-results-renderer', 'ytd-item-section-renderer', 'ytd-rich-item-renderer', 'ytd-video-renderer', 'ytd-compact-video-renderer', 'ytd-playlist-video-renderer'].forEach(sel => {
    document.querySelectorAll(sel).forEach(el => { el.style.display = ''; });
  });
  removeBlankOverlay();
  clearWatchBlock();
}

function escapeHtmlSimple(str) { return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }