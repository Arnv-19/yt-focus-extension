// ===== YT FOCUS v2.0 — POPUP CONTROLLER =====

let state = {
  ytApiKey: '', anthropicKey: '', setupSkipped: false,
  blankHomepage: true, hideThumbnails: true, hideComments: true, hideSidebar: true, hideShorts: true,
  focusMode: false, musicMode: true, musicPlaylists: [],
  allowedChannels: [], blockedChannels: [], blockedKeywords: [],
  dailyLimitMinutes: 60, watchedSecondsToday: 0,
  lockMode: false, lockReason: '', lockUnlockUntil: 0,
  lastMode: 'search', cliTheme: 'arch', tasks: []
};

let currentTabChannel = '';
let currentTabPlaylist = null;

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

document.addEventListener('DOMContentLoaded', async () => {
  await loadState();
  setupEventListeners();
  detectActiveTabChannel();

  if (!state.ytApiKey && !state.setupSkipped) showScreen('setup');
  else {
    showScreen('main');
    switchMode(state.lastMode || 'search');
    if (state.lastMode === 'search') document.getElementById('searchInput')?.focus();
  }
});

async function loadState() {
  return new Promise(resolve => {
    chrome.storage.local.get(null, (data) => {
      Object.assign(state, data || {});
      renderAllUI();
      resolve();
    });
  });
}

async function saveState(partial = {}) {
  Object.assign(state, partial);
  return new Promise(resolve => {
    chrome.storage.local.set(state, () => {
      renderAllUI();
      resolve();
    });
  });
}

function renderAllUI() {
  renderTimeBar();
  syncLockUI();
  renderSettingsChips();
}

async function detectActiveTabChannel() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url?.includes('youtube.com/')) return;
    try {
      const u = new URL(tab.url);
      const listId = u.searchParams.get('list');
      if (listId) {
        currentTabPlaylist = { id: listId, url: tab.url, title: 'playlist (' + listId.slice(0, 6) + '...)' };
        const bar = document.getElementById('currentChanBar');
        const plBtn = document.getElementById('quickAllowPlaylistBtn');
        if (bar && plBtn) {
          bar.style.display = 'flex';
          plBtn.style.display = 'inline-block';
          const isAdded = (state.musicPlaylists || []).some(p => (typeof p === 'object' ? p.id : extractPlaylistId(p)) === listId);
          plBtn.textContent = isAdded ? '✓ 🎵 music' : '+ 🎵 music';
        }
      }
    } catch (_) { }
    chrome.tabs.sendMessage(tab.id, { action: 'getCurrentChannel' }, (res) => {
      if (chrome.runtime.lastError || !res) return;
      if (res.channel) {
        currentTabChannel = res.channel;
        const bar = document.getElementById('currentChanBar');
        const allowBtn = document.getElementById('quickAllowCurrentBtn');
        if (bar && allowBtn) {
          bar.style.display = 'flex';
          allowBtn.textContent = '+ allow "' + currentTabChannel.slice(0, 14) + '"';
        }
      }
      if (res.playlist && res.playlist.id) {
        currentTabPlaylist = { id: res.playlist.id, url: tab.url, title: res.playlist.title || res.playlist.id };
        const bar = document.getElementById('currentChanBar');
        const plBtn = document.getElementById('quickAllowPlaylistBtn');
        if (bar && plBtn) {
          bar.style.display = 'flex';
          plBtn.style.display = 'inline-block';
          const isAdded = (state.musicPlaylists || []).some(p => (typeof p === 'object' ? p.id : extractPlaylistId(p)) === res.playlist.id);
          plBtn.textContent = isAdded ? '✓ 🎵 music' : '+ 🎵 music';
        }
      }
    });
  } catch (_) { }
}

function renderTimeBar() {
  const watchedMin = Math.floor((state.watchedSecondsToday || 0) / 60);
  const watchedLbl = document.getElementById('timeWatchedLbl') || document.getElementById('timewatchedLbl');
  const limitLbl = document.getElementById('timeLimitLbl');

  if (watchedLbl) watchedLbl.textContent = watchedMin + 'm';
  if (limitLbl) limitLbl.textContent = state.dailyLimitMinutes > 0 ? state.dailyLimitMinutes + 'm' : '∞';
}

function syncLockUI() {
  const btn = document.getElementById('lockBtn');
  const banner = document.getElementById('lockBanner');
  const bannerTitle = document.getElementById('lockBannerTitle');
  const isLocked = state.lockMode;
  const inCountdown = !isLocked && Date.now() < state.lockUnlockUntil;

  if (btn) {
    btn.textContent = isLocked ? '🔒' : '🔓';
    btn.classList.toggle('lock-active', isLocked);
  }
  if (banner && bannerTitle) {
    banner.classList.toggle('hidden', !isLocked && !inCountdown);
    if (inCountdown) {
      const rem = Math.ceil((state.lockUnlockUntil - Date.now()) / 1000);
      bannerTitle.textContent = '⏳ Unlocking in ' + rem + 's...';
    } else if (isLocked) {
      bannerTitle.textContent = '🔒 Lock Mode Active — YouTube is locked';
    }
  }
}

function showScreen(name) {
  document.getElementById('setupScreen').classList.add('hidden');
  document.getElementById('mainScreen').classList.add('hidden');
  document.getElementById('settingsPanel').classList.add('hidden');

  if (name === 'setup') document.getElementById('setupScreen').classList.remove('hidden');
  if (name === 'main') document.getElementById('mainScreen').classList.remove('hidden');
  if (name === 'settings') {
    document.getElementById('settingsPanel')?.classList.remove('hidden');

    // Theme Selector
    const themeSel = document.getElementById('themeSelect');
    if (themeSel) themeSel.value = state.cliTheme || 'arch';

    if (document.getElementById('ytKeyEdit')) document.getElementById('ytKeyEdit').value = state.ytApiKey || '';
    if (document.getElementById('anthropicKeyEdit')) document.getElementById('anthropicKeyEdit').value = state.anthropicKey || '';
    document.getElementById('toggleHideThumbnails').checked = !!state.hideThumbnails;
    document.getElementById('toggleBlankHomepage').checked = !!state.blankHomepage;
    document.getElementById('toggleHideComments').checked = !!state.hideComments;
    document.getElementById('toggleHideSidebar').checked = !!state.hideSidebar;
    document.getElementById('toggleHideShorts').checked = !!state.hideShorts;
    document.getElementById('toggleFocusMode').checked = !!state.focusMode;
    document.getElementById('toggleMusicMode').checked = state.musicMode !== false;
    document.getElementById('dailyLimitInput').value = String(state.dailyLimitMinutes ?? 60);
    renderSettingsChips();
  }
}

function switchMode(mode) {
  const tab = document.querySelector(`.tab[data-mode="${mode}"]`);
  const panel = document.getElementById(`${mode}Mode`);
  if (!tab || !panel) return;
  state.lastMode = mode;
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  tab.classList.add('active');
  document.querySelectorAll('.mode-panel').forEach(p => p.classList.remove('active'));
  panel.classList.add('active');
  chrome.storage.local.set({ lastMode: mode });
}

function renderSettingsChips() {
  const musicPlContainer = document.getElementById('musicPlaylistsChips');
  if (musicPlContainer) {
    const list = state.musicPlaylists || [];
    if (list.length === 0) {
      musicPlContainer.innerHTML = '<span style="font-family:var(--mono);font-size:10px;color:var(--text3);">(all playlists bypassed when empty)</span>';
    } else {
      musicPlContainer.innerHTML = list.map((pl, idx) => {
        const name = typeof pl === 'object' ? (pl.name || pl.id || 'playlist') : pl;
        return `
          <span class="chip" style="color:var(--yellow); border-color:var(--yellow);">
            <span>🎵 ${escapeHtml(name)}</span>
            <button class="chip-del" data-del-music-pl="${idx}">×</button>
          </span>
        `;
      }).join('');
      musicPlContainer.querySelectorAll('[data-del-music-pl]').forEach(btn => {
        btn.addEventListener('click', () => { state.musicPlaylists.splice(Number(btn.dataset.delMusicPl), 1); renderSettingsChips(); });
      });
    }
  }

  renderSimpleChipList('allowedChannelsChips', state.allowedChannels, (val) => { state.allowedChannels = state.allowedChannels.filter(c => c !== val); renderSettingsChips(); });
  renderSimpleChipList('blockedChannelsChips', state.blockedChannels, (val) => { state.blockedChannels = state.blockedChannels.filter(c => c !== val); renderSettingsChips(); }, true);
  renderSimpleChipList('blockedKeywordsChips', state.blockedKeywords, (val) => { state.blockedKeywords = state.blockedKeywords.filter(k => k !== val); renderSettingsChips(); }, true);
}

function renderSimpleChipList(containerId, items, onRemove, isDanger = false) {
  const el = document.getElementById(containerId);
  if (!el) return;
  if (!items || items.length === 0) {
    el.innerHTML = '<span style="font-family:var(--mono);font-size:10px;color:var(--text3);">none</span>';
    return;
  }
  el.innerHTML = items.map(item => `
    <span class="chip ${isDanger ? 'danger' : ''}">
      <span>${escapeHtml(item)}</span>
      <button class="chip-del" data-val="${escapeHtml(item)}">×</button>
    </span>
  `).join('');
  el.querySelectorAll('.chip-del').forEach(btn => btn.addEventListener('click', () => onRemove(btn.dataset.val)));
}

function setupEventListeners() {
  document.getElementById('saveKeysBtn').addEventListener('click', async () => {
    await saveState({ ytApiKey: document.getElementById('ytApiKeyInput').value.trim(), anthropicKey: document.getElementById('anthropicKeyInput').value.trim(), setupSkipped: true });
    showScreen('main');
  });

  document.getElementById('skipSetupBtn').addEventListener('click', async () => {
    await saveState({ setupSkipped: true });
    showScreen('main');
  });

  document.getElementById('quickAllowCurrentBtn').addEventListener('click', async () => {
    if (!currentTabChannel) return;
    if (!state.allowedChannels.includes(currentTabChannel)) state.allowedChannels.push(currentTabChannel);
    state.blockedChannels = state.blockedChannels.filter(c => c !== currentTabChannel);
    await saveState();
    showStatus('Allowed "' + currentTabChannel + '"', 'success');
  });

  document.getElementById('quickBlockCurrentBtn').addEventListener('click', async () => {
    if (!currentTabChannel) return;
    if (!state.blockedChannels.includes(currentTabChannel)) state.blockedChannels.push(currentTabChannel);
    state.allowedChannels = state.allowedChannels.filter(c => c !== currentTabChannel);
    await saveState();
    showStatus('Blocked "' + currentTabChannel + '"', 'error');
  });

  document.getElementById('lockBtn').addEventListener('click', handleLockToggle);
  document.getElementById('settingsBtn').addEventListener('click', () => showScreen('settings'));
  document.getElementById('backBtn').addEventListener('click', () => showScreen('main'));
  document.querySelectorAll('.tab').forEach(tab => tab.addEventListener('click', () => switchMode(tab.dataset.mode)));

  document.getElementById('searchBtn').addEventListener('click', handleSearch);
  document.getElementById('searchInput').addEventListener('keydown', e => { if (e.key === 'Enter') handleSearch(); });
  document.getElementById('channelBtn').addEventListener('click', handleChannel);
  document.getElementById('channelInput').addEventListener('keydown', e => { if (e.key === 'Enter') handleChannel(); });

  const quickAllowPlBtn = document.getElementById('quickAllowPlaylistBtn');
  if (quickAllowPlBtn) {
    quickAllowPlBtn.addEventListener('click', async () => {
      if (!currentTabPlaylist || !currentTabPlaylist.id) return;
      if (!state.musicPlaylists) state.musicPlaylists = [];
      const pid = currentTabPlaylist.id;
      if (!state.musicPlaylists.some(p => (typeof p === 'object' ? p.id : extractPlaylistId(p)) === pid)) {
        state.musicPlaylists.push({ name: currentTabPlaylist.title || pid, id: pid, url: currentTabPlaylist.url });
        await saveState();
        quickAllowPlBtn.textContent = '✓ 🎵 music';
        showStatus('Playlist added to Music Mode!', 'success');
      } else showStatus('Playlist already in Music Mode', 'success');
    });
  }

  const addMusicPlBtn = document.getElementById('addMusicPlaylistBtn');
  if (addMusicPlBtn) {
    addMusicPlBtn.addEventListener('click', () => {
      const nameInput = document.getElementById('newMusicPlaylistName');
      const urlInput = document.getElementById('newMusicPlaylistUrl');
      const name = nameInput.value.trim(), rawUrl = urlInput.value.trim();
      const id = extractPlaylistId(rawUrl);
      if (!id) return;
      if (!state.musicPlaylists) state.musicPlaylists = [];
      if (!state.musicPlaylists.some(p => (typeof p === 'object' ? p.id : extractPlaylistId(p)) === id)) {
        state.musicPlaylists.push({ name: name || id, id: id, url: rawUrl.startsWith('http') ? rawUrl : 'https://www.youtube.com/playlist?list=' + encodeURIComponent(id) });
        nameInput.value = ''; urlInput.value = '';
        renderSettingsChips();
        showStatus('Music playlist added!', 'success');
      } else showStatus('Playlist already in music mode', 'error');
    });
  }

  bindChipAdder('addAllowChanInput', 'addAllowChanBtn', () => state.allowedChannels);
  bindChipAdder('addBlockChanInput', 'addBlockChanBtn', () => state.blockedChannels);
  bindChipAdder('addKeywordInput', 'addKeywordBtn', () => state.blockedKeywords);

  document.getElementById('saveSettingsBtn').addEventListener('click', handleSaveSettings);
  document.getElementById('clearDataBtn').addEventListener('click', async () => {
    if (confirm('Reset all settings?')) { await chrome.storage.local.clear(); location.reload(); }
  });
}

function bindChipAdder(inputId, btnId, getArrayFn) {
  const input = document.getElementById(inputId);
  const btn = document.getElementById(btnId);
  const add = () => {
    const val = input.value.trim();
    if (!val) return;
    const arr = getArrayFn();
    if (!arr.includes(val)) arr.push(val);
    input.value = '';
    renderSettingsChips();
  };
  btn?.addEventListener('click', add);
  input?.addEventListener('keydown', e => { if (e.key === 'Enter') add(); });
}

async function handleSaveSettings() {
  const themeSel = document.getElementById('themeSelect');
  if (themeSel) state.cliTheme = themeSel.value;

  if (document.getElementById('ytKeyEdit')) state.ytApiKey = document.getElementById('ytKeyEdit').value.trim();
  if (document.getElementById('anthropicKeyEdit')) state.anthropicKey = document.getElementById('anthropicKeyEdit').value.trim();
  state.hideThumbnails = document.getElementById('toggleHideThumbnails').checked;
  state.blankHomepage = document.getElementById('toggleBlankHomepage').checked;
  state.hideComments = document.getElementById('toggleHideComments').checked;
  state.hideSidebar = document.getElementById('toggleHideSidebar').checked;
  state.hideShorts = document.getElementById('toggleHideShorts').checked;
  state.focusMode = document.getElementById('toggleFocusMode').checked;
  state.musicMode = document.getElementById('toggleMusicMode').checked;
  const parsedLimit = parseInt(document.getElementById('dailyLimitInput').value.trim(), 10);
  state.dailyLimitMinutes = Number.isNaN(parsedLimit) ? 60 : Math.max(0, parsedLimit);
  await saveState();
  showStatus('Settings saved!', 'success');
  showScreen('main');
}

async function handleLockToggle() {
  if (state.lockMode) {
    state.lockMode = false;
    state.lockReason = '';
    state.lockUnlockUntil = Date.now() + 5000;
    await saveState();
    showStatus('Lock mode off — 5s cooldown', 'success');
  } else {
    state.lockMode = true;
    state.lockReason = 'manual';
    state.lockUnlockUntil = 0;
    await saveState();
    showStatus('🔒 Lock mode enabled', 'error');
  }
}

async function handleSearch() {
  const query = document.getElementById('searchInput').value.trim();
  if (!query) return;
  chrome.tabs.create({ url: 'https://www.youtube.com/results?search_query=' + encodeURIComponent(query.replace(/^\/search\s*/, '')) });
}

async function handleChannel() {
  const query = document.getElementById('channelInput').value.trim();
  if (!query) return;
  chrome.tabs.create({ url: 'https://www.youtube.com/results?search_query=' + encodeURIComponent(query) });
}

function showStatus(msg, type = '') {
  const bar = document.getElementById('statusBar');
  bar.textContent = msg;
  bar.className = 'status-bar ' + type;
  bar.classList.remove('hidden');
  clearTimeout(bar._timeout);
  bar._timeout = setTimeout(() => bar.classList.add('hidden'), 3200);
}

function escapeHtml(str) { return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }