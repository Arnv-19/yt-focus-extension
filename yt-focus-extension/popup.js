// ===== YT FOCUS v2.0 — POPUP CONTROLLER =====

let state = {
  ytApiKey: '',
  anthropicKey: '',
  setupSkipped: false,
  blankHomepage: true,
  hideThumbnails: true,
  hideComments: true,
  hideSidebar: true,
  hideShorts: true,
  focusMode: false,
  allowedChannels: [],
  blockedChannels: [],
  blockedKeywords: [],
  blockedCategories: ['music', 'entertainment', 'gaming highlights', 'memes', 'reaction videos', 'vlogs'],
  productiveGroups: {},
  activeProductiveGroup: '',
  savedPlaylists: [
    { name: 'watch later', url: 'https://www.youtube.com/playlist?list=WL' }
  ],
  dailyLimitMinutes: 60,
  watchedSecondsToday: 0,
  lockMode: false,
  lockReason: '',
  lockUnlockUntil: 0,
  lastMode: 'search'
};

let currentTabChannel = '';

document.addEventListener('DOMContentLoaded', async () => {
  await loadState();
  setupEventListeners();
  detectActiveTabChannel();

  if (!state.ytApiKey && !state.setupSkipped) {
    showScreen('setup');
  } else {
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
  renderPlaylistsDropdown();
  renderProductiveManager();
  renderSettingsChips();
}

async function detectActiveTabChannel() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url?.includes('youtube.com/')) return;
    chrome.tabs.sendMessage(tab.id, { action: 'getCurrentChannel' }, (res) => {
      if (chrome.runtime.lastError || !res?.channel) return;
      currentTabChannel = res.channel;
      const bar = document.getElementById('currentChanBar');
      const allowBtn = document.getElementById('quickAllowCurrentBtn');
      if (bar && allowBtn) {
        bar.style.display = 'flex';
        allowBtn.textContent = '+ allow "' + currentTabChannel.slice(0, 14) + '"';
      }
    });
  } catch (_) { }
}

function renderTimeBar() {
  const watchedMin = Math.floor((state.watchedSecondsToday || 0) / 60);
  document.getElementById('timeWatchedLbl').textContent = watchedMin + 'm';
  document.getElementById('timeLimitLbl').textContent =
    state.dailyLimitMinutes > 0 ? state.dailyLimitMinutes + 'm' : '∞';
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
    document.getElementById('settingsPanel').classList.remove('hidden');
    document.getElementById('ytKeyEdit').value = state.ytApiKey || '';
    document.getElementById('anthropicKeyEdit').value = state.anthropicKey || '';
    document.getElementById('toggleHideThumbnails').checked = !!state.hideThumbnails;
    document.getElementById('toggleBlankHomepage').checked = !!state.blankHomepage;
    document.getElementById('toggleHideComments').checked = !!state.hideComments;
    document.getElementById('toggleHideSidebar').checked = !!state.hideSidebar;
    document.getElementById('toggleHideShorts').checked = !!state.hideShorts;
    document.getElementById('dailyLimitInput').value = String(state.dailyLimitMinutes ?? 60);
    document.getElementById('toggleFocusMode').checked = !!state.focusMode;
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

function renderPlaylistsDropdown() {
  const select = document.getElementById('playlistSelect');
  if (!select) return;
  const list = state.savedPlaylists || [];
  if (list.length === 0) {
    select.innerHTML = '<option value="">(no playlists — sync in Settings)</option>';
    return;
  }
  select.innerHTML = list.map((p, idx) => `<option value="${idx}">${escapeHtml(p.name)}</option>`).join('');
}

function renderProductiveManager() {
  const tagsContainer = document.getElementById('productiveTags');
  const activeBox = document.getElementById('activeCategoryBox');
  const chipsContainer = document.getElementById('catChannelChips');
  if (!tagsContainer) return;

  const categories = Object.keys(state.productiveGroups || {});
  if (categories.length > 0 && (!state.activeProductiveGroup || !state.productiveGroups[state.activeProductiveGroup])) {
    state.activeProductiveGroup = categories[0];
  } else if (categories.length === 0) {
    state.activeProductiveGroup = '';
  }

  if (categories.length === 0) {
    tagsContainer.innerHTML = '<span style="font-family:var(--mono);font-size:10px;color:var(--text3);">Create your first category tag below!</span>';
    activeBox.classList.add('hidden');
    return;
  }

  tagsContainer.innerHTML = categories.map(cat => {
    const isActive = cat === state.activeProductiveGroup;
    const count = (state.productiveGroups[cat] || []).length;
    return `
      <span class="chip ${isActive ? 'active' : ''}" data-cat="${escapeHtml(cat)}" style="cursor:pointer;">
        <span>${escapeHtml(cat)} (${count})</span>
        <button class="chip-del" data-del-cat="${escapeHtml(cat)}">×</button>
      </span>
    `;
  }).join('');

  tagsContainer.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', (e) => {
      if (e.target.dataset.delCat) return;
      state.activeProductiveGroup = chip.dataset.cat;
      saveState();
    });
  });

  tagsContainer.querySelectorAll('[data-del-cat]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const cat = btn.dataset.delCat;
      delete state.productiveGroups[cat];
      if (state.activeProductiveGroup === cat) {
        state.activeProductiveGroup = Object.keys(state.productiveGroups)[0] || '';
      }
      saveState();
    });
  });

  if (state.activeProductiveGroup) {
    activeBox.classList.remove('hidden');
    const chans = state.productiveGroups[state.activeProductiveGroup] || [];
    chipsContainer.innerHTML = chans.length === 0
      ? '<span style="font-family:var(--mono);font-size:10px;color:var(--text3);">No channels added yet.</span>'
      : chans.map(ch => `
          <span class="chip">
            <span>${escapeHtml(ch)}</span>
            <button class="chip-del" data-del-chan="${escapeHtml(ch)}">×</button>
          </span>
        `).join('');

    chipsContainer.querySelectorAll('[data-del-chan]').forEach(btn => {
      btn.addEventListener('click', () => {
        const ch = btn.dataset.delChan;
        state.productiveGroups[state.activeProductiveGroup] =
          (state.productiveGroups[state.activeProductiveGroup] || []).filter(c => c !== ch);
        saveState();
      });
    });
  } else {
    activeBox.classList.add('hidden');
  }
}

function renderSettingsChips() {
  const plContainer = document.getElementById('savedPlaylistsChips');
  if (plContainer) {
    plContainer.innerHTML = (state.savedPlaylists || []).map((pl, idx) => `
      <span class="chip">
        <span>${escapeHtml(pl.name)}</span>
        <button class="chip-del" data-del-pl="${idx}">×</button>
      </span>
    `).join('');
    plContainer.querySelectorAll('[data-del-pl]').forEach(btn => {
      btn.addEventListener('click', () => {
        state.savedPlaylists.splice(Number(btn.dataset.delPl), 1);
        renderSettingsChips();
        renderPlaylistsDropdown();
      });
    });
  }

  renderSimpleChipList('allowedChannelsChips', state.allowedChannels, (val) => {
    state.allowedChannels = state.allowedChannels.filter(c => c !== val);
    renderSettingsChips();
  });
  renderSimpleChipList('blockedChannelsChips', state.blockedChannels, (val) => {
    state.blockedChannels = state.blockedChannels.filter(c => c !== val);
    renderSettingsChips();
  }, true);
  renderSimpleChipList('blockedKeywordsChips', state.blockedKeywords, (val) => {
    state.blockedKeywords = state.blockedKeywords.filter(k => k !== val);
    renderSettingsChips();
  }, true);
  renderSimpleChipList('blockedAiCatsChips', state.blockedCategories, (val) => {
    state.blockedCategories = state.blockedCategories.filter(c => c !== val);
    renderSettingsChips();
  }, true);
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
  el.querySelectorAll('.chip-del').forEach(btn => {
    btn.addEventListener('click', () => onRemove(btn.dataset.val));
  });
}

function setupEventListeners() {
  document.getElementById('saveKeysBtn').addEventListener('click', async () => {
    const ytKey = document.getElementById('ytApiKeyInput').value.trim();
    const aiKey = document.getElementById('anthropicKeyInput').value.trim();
    await saveState({ ytApiKey: ytKey, anthropicKey: aiKey, setupSkipped: true });
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
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => switchMode(tab.dataset.mode));
  });

  document.getElementById('searchBtn').addEventListener('click', handleSearch);
  document.getElementById('searchInput').addEventListener('keydown', e => { if (e.key === 'Enter') handleSearch(); });

  document.getElementById('loadWatchLater').addEventListener('click', handleLoadSelectedPlaylist);
  document.getElementById('openPlaylistTabBtn').addEventListener('click', () => {
    const sel = document.getElementById('playlistSelect');
    const pl = state.savedPlaylists[Number(sel.value)];
    if (pl?.url) chrome.tabs.create({ url: pl.url });
  });

  document.getElementById('addCategoryBtn').addEventListener('click', handleAddCategory);
  document.getElementById('newCategoryInput').addEventListener('keydown', e => { if (e.key === 'Enter') handleAddCategory(); });
  document.getElementById('addCatChannelBtn').addEventListener('click', handleAddCategoryChannel);
  document.getElementById('newCatChannelInput').addEventListener('keydown', e => { if (e.key === 'Enter') handleAddCategoryChannel(); });
  document.getElementById('loadProductive').addEventListener('click', handleProductiveFetch);

  document.getElementById('channelBtn').addEventListener('click', handleChannel);
  document.getElementById('channelInput').addEventListener('keydown', e => { if (e.key === 'Enter') handleChannel(); });

  document.getElementById('syncPlaylistsBtn').addEventListener('click', handleSyncPlaylistsFromYouTube);
  document.getElementById('addPlaylistBtn').addEventListener('click', () => {
    const name = document.getElementById('newPlaylistName').value.trim().toLowerCase();
    let url = document.getElementById('newPlaylistUrl').value.trim();
    if (!name || !url) return;
    if (!url.startsWith('http')) url = 'https://www.youtube.com/playlist?list=' + encodeURIComponent(url);
    state.savedPlaylists.push({ name, url });
    document.getElementById('newPlaylistName').value = '';
    document.getElementById('newPlaylistUrl').value = '';
    renderSettingsChips();
  });

  bindChipAdder('addAllowChanInput', 'addAllowChanBtn', () => state.allowedChannels);
  bindChipAdder('addBlockChanInput', 'addBlockChanBtn', () => state.blockedChannels);
  bindChipAdder('addKeywordInput', 'addKeywordBtn', () => state.blockedKeywords);
  bindChipAdder('addAiCatInput', 'addAiCatBtn', () => state.blockedCategories);

  document.getElementById('saveSettingsBtn').addEventListener('click', handleSaveSettings);
  document.getElementById('clearDataBtn').addEventListener('click', async () => {
    if (confirm('Reset all settings?')) {
      await chrome.storage.local.clear();
      location.reload();
    }
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

function handleAddCategory() {
  const input = document.getElementById('newCategoryInput');
  const cat = input.value.trim();
  if (!cat) return;
  if (!state.productiveGroups[cat]) state.productiveGroups[cat] = [];
  state.activeProductiveGroup = cat;
  input.value = '';
  saveState();
}

function handleAddCategoryChannel() {
  const input = document.getElementById('newCatChannelInput');
  const ch = input.value.trim();
  if (!ch || !state.activeProductiveGroup) return;
  const list = state.productiveGroups[state.activeProductiveGroup] || [];
  if (!list.includes(ch)) list.push(ch);
  state.productiveGroups[state.activeProductiveGroup] = list;
  input.value = '';
  saveState();
}

function sendBgWithTimeout(payload, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ error: 'Timed out. Open any YouTube tab while signed in and try again.' }), timeoutMs);
    chrome.runtime.sendMessage(payload, (res) => {
      clearTimeout(timer);
      if (chrome.runtime.lastError) resolve({ error: chrome.runtime.lastError.message });
      else resolve(res || {});
    });
  });
}

async function handleSyncPlaylistsFromYouTube() {
  showLoading(true);
  const res = await sendBgWithTimeout({ action: 'syncUserPlaylistsBg' });
  showLoading(false);
  if (res.error) {
    showStatus(res.error, 'error');
    return;
  }
  const found = res.playlists || [];
  const existingUrls = new Set((state.savedPlaylists || []).map(p => p.url));
  let added = 0;
  found.forEach(p => {
    if (!existingUrls.has(p.url)) {
      state.savedPlaylists.push(p);
      existingUrls.add(p.url);
      added++;
    }
  });
  renderSettingsChips();
  showStatus('Synced ' + added + ' playlist(s)! Remove unwanted with × and click Save.', 'success');
}

async function handleSaveSettings() {
  state.ytApiKey = document.getElementById('ytKeyEdit').value.trim();
  state.anthropicKey = document.getElementById('anthropicKeyEdit').value.trim();
  state.hideThumbnails = document.getElementById('toggleHideThumbnails').checked;
  state.blankHomepage = document.getElementById('toggleBlankHomepage').checked;
  state.hideComments = document.getElementById('toggleHideComments').checked;
  state.hideSidebar = document.getElementById('toggleHideSidebar').checked;
  state.hideShorts = document.getElementById('toggleHideShorts').checked;
  state.focusMode = document.getElementById('toggleFocusMode').checked;
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

async function handleLoadSelectedPlaylist() {
  const sel = document.getElementById('playlistSelect');
  const pl = state.savedPlaylists[Number(sel.value)];
  const container = document.getElementById('watchLaterResults');
  if (!pl) {
    renderError(container, 'No playlist selected.');
    return;
  }
  showLoading(true);
  const res = await sendBgWithTimeout({ action: 'fetchPlaylistBg', url: pl.url });
  showLoading(false);
  if (res.error) {
    renderError(container, res.error);
    return;
  }
  renderResults(container, res.videos || []);
  showStatus((res.videos || []).length + ' videos loaded', 'success');
}

async function handleSearch() {
  const query = document.getElementById('searchInput').value.trim();
  if (!query) return;
  chrome.tabs.create({ url: 'https://www.youtube.com/results?search_query=' + encodeURIComponent(query) });
}

async function handleProductiveFetch() {
  const container = document.getElementById('productiveResults');
  const cat = state.activeProductiveGroup;
  if (!cat) { renderError(container, 'Create a category tag first.'); return; }
  const channels = state.productiveGroups[cat] || [];
  if (!channels.length) { renderError(container, 'Add channels to [' + cat + '] first.'); return; }
  const combinedQuery = channels.join(' OR ');
  chrome.tabs.create({ url: 'https://www.youtube.com/results?search_query=' + encodeURIComponent(combinedQuery) });
}

async function handleChannel() {
  const query = document.getElementById('channelInput').value.trim();
  if (!query) return;
  chrome.tabs.create({ url: 'https://www.youtube.com/results?search_query=' + encodeURIComponent(query) });
}

function renderResults(container, videos) {
  if (!videos || !videos.length) {
    container.innerHTML = '<div class="empty-state">no videos found in this playlist</div>';
    return;
  }
  container.innerHTML = videos.map((v, i) => `
    <a class="result-item" href="${escapeHtml(v.url)}" data-url="${escapeHtml(v.url)}">
      <span class="result-num">${String(i + 1).padStart(2, '0')}</span>
      <span class="result-text">
        <span class="result-title">${escapeHtml(v.title)}</span>
        <span class="result-meta"><span>${escapeHtml(v.channel || '')}</span></span>
      </span>
    </a>
  `).join('');
  container.querySelectorAll('.result-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      chrome.tabs.create({ url: item.dataset.url });
    });
  });
}

function renderError(container, msg) {
  container.innerHTML = `<div class="error-state">error: ${escapeHtml(msg)}</div>`;
}

function showLoading(show) {
  document.getElementById('loadingOverlay').classList.toggle('hidden', !show);
}

function showStatus(msg, type = '') {
  const bar = document.getElementById('statusBar');
  bar.textContent = msg;
  bar.className = 'status-bar ' + type;
  bar.classList.remove('hidden');
  clearTimeout(bar._timeout);
  bar._timeout = setTimeout(() => bar.classList.add('hidden'), 3200);
}

function escapeHtml(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}