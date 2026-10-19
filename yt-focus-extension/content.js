// ===== YT FOCUS v2.0 — CONTENT SCRIPT =====

let settings = {
  blankHomepage: true,
  hideThumbnails: true,
  hideComments: true,
  hideSidebar: true,
  hideShorts: true,
  musicMode: true,
  musicPlaylists: [],
  focusMode: false,
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
  lockReason: '',
  tasks: [],
  cliTheme: 'arch'
};

let _lockUnlockUntil = 0;
let _lockTimer = null;
let _watchGateDone = false;
let _blockPlayback = false;
let _matrixTimer = null;
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
    if (settings.focusMode || settings.allowedChannels.length > 0 || settings.blockedChannels.length > 0) {
      activeRules.set('watchGate', ruleWatchGate);
    }
    activeRules.set('autoplayOff', ruleAutoplayOff);
  }

  if (isChannelPage) activeRules.set('channelPageBanner', ruleChannelPageBanner);
  if (isPlaylist) activeRules.set('playlistRec', rulePlaylistRecommended);
  if (settings.hideShorts) activeRules.set('shorts', ruleHideShorts);

  if ((settings.focusMode || settings.allowedChannels.length > 0 || settings.blockedChannels.length > 0) && !isHome && !isChannelPage) {
    activeRules.set('channelCards', ruleChannelCards);
  }

  if (settings.blockedKeywords.length > 0) activeRules.set('keywordCards', ruleKeywordCards);
  activeRules.set('channelActionPills', ruleInjectChannelPills);
  activeRules.set('searchAds', ruleHideSearchAds);
  activeRules.set('clutter', () => hideAll('ytd-masthead .ytd-notification-topbar-button-renderer'));

  activeRules.set('taskGhostPlaceholder', ruleTaskGhostPlaceholder);
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

function removeBlankOverlay() {
  document.getElementById('ytf-blank-overlay')?.remove();
  if (_matrixTimer) { clearInterval(_matrixTimer); _matrixTimer = null; }
}

function ruleAutoplayOff() { document.querySelector('.ytp-autonav-toggle-button[aria-checked="true"]')?.click(); }

function ruleHideShorts() {
  ['ytd-reel-shelf-renderer', 'ytd-rich-shelf-renderer[is-shorts]', '#guide-inner-content ytd-guide-entry-renderer a[href="/shorts"]', 'ytd-mini-guide-entry-renderer a[href="/shorts"]', 'ytd-reel-item-renderer'].forEach(hideAll);
  document.querySelectorAll('ytd-video-renderer').forEach(card => {
    const a = card.querySelector('a#thumbnail, a#video-title');
    if (a && a.getAttribute('href')?.startsWith('/shorts/')) card.style.display = 'none';
  });
}

function ruleHideSearchAds() {
  document.querySelectorAll('ytd-promoted-sparkles-web-renderer, ytd-search-pyv-renderer, #masthead-ad, ytd-ad-slot-renderer').forEach(el => {
    el.style.display = 'none';
  });
}

function rulePlaylistRecommended() {
  document.querySelectorAll('ytd-browse ytd-item-section-renderer').forEach(el => {
    if (!el.querySelector('ytd-playlist-video-list-renderer') && el.style.display !== 'none') el.style.display = 'none';
  });
}

// ===== Ghost Placeholder Logic =====
function ruleTaskGhostPlaceholder() {
  const searchInput = document.querySelector('input#search, input.ytd-searchbox');
  if (!searchInput) return;

  const pendingTask = (settings.tasks || []).find(t => !t.done);
  if (pendingTask) {
    if (!searchInput.dataset.origPlaceholder) {
      searchInput.dataset.origPlaceholder = searchInput.getAttribute('placeholder') || 'Search';
    }
    const ghostText = `Task: ${pendingTask.text}`;
    if (searchInput.getAttribute('placeholder') !== ghostText && !searchInput.value) {
      searchInput.setAttribute('placeholder', ghostText);
    }
  } else if (searchInput.dataset.origPlaceholder) {
    searchInput.setAttribute('placeholder', searchInput.dataset.origPlaceholder);
  }
}

function extractPlaylistId(input) {
  if (!input) return '';
  const str = String(input).trim();
  try {
    if (str.includes('list=')) {
      const url = str.startsWith('http') ? new URL(str) : new URL('https://www.youtube.com/' + (str.startsWith('?') ? str : '?' + str));
      return url.searchParams.get('list') || str;
    }
  } catch (_) { }
  return str.replace(/[^a-zA-Z0-9_\-]/g, '');
}

function isPlaylistPermitted(listId) {
  if (!settings.musicMode || !listId) return false;
  const allowed = settings.musicPlaylists || [];
  if (allowed.length === 0) return true;

  const cleanListId = listId.trim();
  return allowed.some(p => {
    if (!p) return false;
    if (typeof p === 'string') return extractPlaylistId(p) === cleanListId || p.trim() === cleanListId;
    return (p.id || extractPlaylistId(p.url || '')) === cleanListId;
  });
}

function isChannelPermitted(channelName) {
  const norm = (channelName || '').trim().toLowerCase();
  const currentList = new URLSearchParams(location.search).get('list');

  if (settings.musicMode && currentList && isPlaylistPermitted(currentList)) return true;

  if (!settings.focusMode) {
    const blocked = settings.blockedChannels.map(c => c.toLowerCase().trim()).filter(Boolean);
    if (blocked.some(b => norm.includes(b.replace(/^@/, '')))) return false;
    return true;
  }

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

  allowBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); toggleChannelInList('allowedChannels', rawName, 'blockedChannels'); });
  blockBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); toggleChannelInList('blockedChannels', rawName, 'allowedChannels'); });

  wrap.appendChild(allowBtn); wrap.appendChild(blockBtn);
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
  const currentList = new URLSearchParams(location.search).get('list');
  const playlistBtnHtml = (settings.musicMode && currentList && !isPlaylistPermitted(currentList))
    ? `<button type="button" class="ytf-shortcut" id="ytf-quick-allow-playlist" style="color:var(--yellow,#ffcc00);border-color:var(--yellow,#ffcc00);margin-left:6px;">[+ 🎵 allow playlist in music mode]</button>`
    : '';

  const div = document.createElement('div');
  div.id = 'ytf-watch-block';
  div.innerHTML = `
    <div class="ytf-cmd-window">
      <div class="ytf-cmd-titlebar"><span class="ytf-cmd-title">C:\\Users\\focus> yt-focus.exe — access denied</span></div>
      <div class="ytf-cmd-body">
        <div class="ytf-line ytf-red">> ACCESS DENIED ${settings.focusMode ? '(FOCUS MODE ACTIVE)' : ''}</div>
        <div class="ytf-line">channel: <span class="ytf-yellow">${escapeHtmlSimple(channelName)}</span></div>
        ${currentList ? `<div class="ytf-line">playlist: <span class="ytf-yellow">${escapeHtmlSimple(currentList)}</span> (not on music whitelist)</div>` : ''}
        <div class="ytf-line ytf-dim">> this channel is not on your allowed whitelist.</div>
        <div class="ytf-shortcuts" style="margin-top:14px;">
          <a href="#" class="ytf-shortcut" id="ytf-block-back">[← go back]</a>
          <a href="https://www.youtube.com" class="ytf-shortcut">[home]</a>
          <button type="button" class="ytf-shortcut" id="ytf-quick-allow">[+ whitelist "${escapeHtmlSimple(channelName)}"]</button>
          ${playlistBtnHtml}
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(div);
  div.querySelector('#ytf-block-back')?.addEventListener('click', (e) => { e.preventDefault(); history.back(); });

  div.querySelector('#ytf-quick-allow-playlist')?.addEventListener('click', () => {
    chrome.storage.local.get(['musicPlaylists'], (data) => {
      let list = data.musicPlaylists || [];
      const pid = currentList;
      if (!list.some(p => (typeof p === 'object' ? p.id : extractPlaylistId(p)) === pid)) {
        list.push({ name: 'playlist (' + pid.slice(0, 8) + ')', id: pid, url: location.href });
        chrome.storage.local.set({ musicPlaylists: list }, () => {
          clearWatchBlock();
          location.reload();
        });
      }
    });
  });

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


// ===== 0,1 MATRIX WATERFALL GENERATOR =====
function toggleMatrix(container) {
  let bg = document.getElementById('ytf-matrix-bg');
  if (bg) {
    if (_matrixTimer) { clearInterval(_matrixTimer); _matrixTimer = null; }
    bg.remove();
    return false;
  }

  bg = document.createElement('canvas');
  bg.id = 'ytf-matrix-bg';
  container.prepend(bg); // Insert behind the terminal

  const ctx = bg.getContext('2d');
  bg.width = window.innerWidth;
  bg.height = window.innerHeight;

  const chars = '01';
  const fontSize = 16;
  const columns = bg.width / fontSize;

  // Randomize initial drop positions so they fall at different times
  const drops = Array(Math.floor(columns)).fill(0).map(() => Math.floor(Math.random() * -100));

  _matrixTimer = setInterval(() => {
    // Fade the background to create the trail effect
    ctx.fillStyle = 'rgba(10, 10, 11, 0.1)';
    ctx.fillRect(0, 0, bg.width, bg.height);

    ctx.fillStyle = '#00ff41'; // Hacker green text
    ctx.font = fontSize + 'px "IBM Plex Mono", monospace';

    for (let i = 0; i < drops.length; i++) {
      // Only draw if the drop has entered the screen
      if (drops[i] * fontSize >= 0) {
        const text = chars.charAt(Math.floor(Math.random() * chars.length));
        ctx.fillText(text, i * fontSize, drops[i] * fontSize);
      }

      // Send the drop back to the top randomly after it crosses the bottom
      if (drops[i] * fontSize > bg.height && Math.random() > 0.975) {
        drops[i] = 0;
      }
      drops[i]++;
    }
  }, 45); // Smooth rain speed

  window.addEventListener('resize', () => {
    if (document.getElementById('ytf-matrix-bg')) {
      bg.width = window.innerWidth;
      bg.height = window.innerHeight;
    }
  });

  return true;
}


// ===== CLI INTERFACE + COMMANDS =====
function injectCmdOverlay() {
  if (document.getElementById('ytf-blank-overlay')) return;
  const watchedMin = Math.floor((settings.watchedSecondsToday || 0) / 60);
  const limitStr = settings.dailyLimitMinutes > 0 ? settings.dailyLimitMinutes + 'm' : '∞';
  const playlistsHtml = (settings.savedPlaylists || []).map(pl => `<a href="${escapeHtmlSimple(pl.url)}" class="ytf-shortcut">[${escapeHtmlSimple(pl.name)}]</a>`).join('');

  // Generate Task List HTML
  const pendingTasks = (settings.tasks || []).filter(t => !t.done);
  const taskHtml = pendingTasks.length > 0
    ? pendingTasks.map((t, idx) => `<div style="font-size:12px;margin-bottom:4px;color:#00d4aa;">[${idx + 1}] ${escapeHtmlSimple(t.text)}</div>`).join('')
    : '<div class="ytf-dim">> No active tasks. Use /tl to add one.</div>';

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
        
        <!-- Intent Queue injected seamlessly here -->
        <div style="margin: 8px 0; padding: 8px; border: 1px dashed #2a2a2f;">
          <div class="ytf-line ytf-dim" style="margin-bottom:6px;">> Active Intent Queue:</div>
          <div id="ytf-cli-tasks">${taskHtml}</div>
        </div>

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
          <input type="text" class="ytf-cli-input" id="ytf-cli-input" placeholder="Type search or command (/search, /tl, /lock, /matrix)..." autocomplete="off" />
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
      case '/search':
        if (!arg) feedback.textContent = 'Usage: /search <query>';
        else { removeBlankOverlay(); window.location.assign('https://www.youtube.com/results?search_query=' + encodeURIComponent(arg)); }
        break;
      case '/tl':
        handleTaskCommand(arg, feedback);
        break;
      case '/lock':
        handleLockCommand(arg, feedback);
        break;
      case '/matrix':
        const isMatrixRainOn = toggleMatrix(div);
        feedback.textContent = isMatrixRainOn ? '> Visual easter egg: Waterfall activated.' : '> Waterfall terminated.';
        break;
      case '/help':
        feedback.textContent = 'Commands: /search <query>, /tl <task>, /tl done 1, /lock 1h, /lock 30m, /matrix, /focus on/off';
        break;
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

function handleTaskCommand(arg, feedback) {
  let tasks = [...(settings.tasks || [])];

  if (arg.startsWith('done ')) {
    const idx = parseInt(arg.replace('done ', '').trim(), 10) - 1;
    if (tasks[idx]) {
      tasks.splice(idx, 1);
      chrome.storage.local.set({ tasks }, () => { feedback.textContent = `> Task marked completed.`; refreshTaskList(); });
    } else feedback.textContent = `> Invalid task index.`;
    return;
  }

  if (arg === 'clear') {
    chrome.storage.local.set({ tasks: [] }, () => { feedback.textContent = `> All tasks cleared.`; refreshTaskList(); });
    return;
  }

  if (!arg) {
    feedback.textContent = 'Usage: /tl <task text> or /tl done 1';
    return;
  }

  tasks.push({ text: arg, done: false, created: Date.now() });
  chrome.storage.local.set({ tasks }, () => {
    feedback.textContent = `> Added task: "${arg}"`;
    refreshTaskList();
  });
}

function refreshTaskList() {
  chrome.storage.local.get(['tasks'], (data) => {
    settings.tasks = data.tasks || [];
    const container = document.getElementById('ytf-cli-tasks');
    if (!container) return;
    const pendingTasks = settings.tasks.filter(t => !t.done);
    container.innerHTML = pendingTasks.length > 0
      ? pendingTasks.map((t, idx) => `<div style="font-size:12px;margin-bottom:4px;color:#00d4aa;">[${idx + 1}] ${escapeHtmlSimple(t.text)}</div>`).join('')
      : '<div class="ytf-dim">> No active tasks. Use /tl to add one.</div>';
    ruleTaskGhostPlaceholder();
  });
}

function handleLockCommand(arg, feedback) {
  if (!arg) { feedback.textContent = 'Usage: /lock <duration> (e.g. /lock 1h, /lock 30m)'; return; }

  let ms = 0;
  if (arg.endsWith('h') || arg.endsWith('hr')) ms = parseFloat(arg) * 3600 * 1000;
  else if (arg.endsWith('m') || arg.endsWith('min')) ms = parseFloat(arg) * 60 * 1000;
  else ms = parseFloat(arg) * 60 * 1000; // default to minutes if no unit

  if (isNaN(ms) || ms <= 0) { feedback.textContent = 'Invalid duration.'; return; }

  const unlockUntil = Date.now() + ms;
  chrome.storage.local.set({ lockUnlockUntil: unlockUntil, lockReason: 'cli_timer' }, () => {
    _lockUnlockUntil = unlockUntil;
    feedback.textContent = `> Lockdown engaged.`;
    startLockEnforcer();
  });
}

function getCurrentChannelName() {
  return document.querySelector('ytd-watch-metadata ytd-channel-name a, #owner #channel-name a, yt-page-header-view-model h1, ytd-channel-name a')?.textContent?.trim()?.split('\n')?.[0]?.trim() || '';
}

function injectLockScreen(countdownSec = 0) {
  let div = document.getElementById('ytf-lock-screen');
  const subText = countdownSec > 0 ? 'Unlocking in ' + formatTime(countdownSec) + '...' : 'Toggle off Lock Mode in the extension popup to continue.';
  if (!div) {
    div = document.createElement('div');
    div.id = 'ytf-lock-screen';
    div.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:#0a0a0b;display:flex;align-items:center;justify-content:center;flex-direction:column;';
    document.documentElement.appendChild(div);
  }
  div.innerHTML = `
    <div style="font-family:'IBM Plex Mono',monospace;text-align:center;padding:40px 32px;max-width:460px;">
      <div style="font-size:15px;color:#e8e8ec;font-weight:600;margin-bottom:14px;">🔒 YouTube is locked.</div>
      <div style="font-size:15px;color:#febc2e;">${escapeHtmlSimple(subText)}</div>
    </div>
  `;
  const vid = document.querySelector('video');
  if (vid) { vid.pause(); vid.muted = true; }
}

function formatTime(totalSec) {
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s < 10 ? '0' : ''}${s}`;
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

function getCurrentPlaylistInfo() {
  const listId = new URLSearchParams(location.search).get('list');
  if (!listId) return null;
  const titleEl = document.querySelector('ytd-watch-flexy ytd-playlist-panel-renderer #header-description h3, ytd-playlist-header-renderer .title, h1#title');
  const title = titleEl ? titleEl.textContent?.trim() : '';
  return { id: listId, title: title || listId };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'getCurrentChannel') {
    sendResponse({
      channel: getCurrentChannelName(),
      playlist: getCurrentPlaylistInfo()
    });
  }
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