// ===== STATE =====
let ytApiKey = '';
let anthropicKey = '';
let blockedCategories = ['music', 'entertainment', 'gaming highlights', 'memes', 'reaction videos', 'vlogs'];
let activeMode = 'search';
let productiveTopics = ['programming', 'machine learning', 'linux terminal', 'system design', 'mathematics'];

// Page-control settings (synced with content.js)
let pageSettings = {
  blankHomepage: true,
  hideComments: true,
  hideSidebar: true,
  hideShorts: true,
  allowedChannels: [],
  blockedKeywords: [],
};

// ===== INIT =====
document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
  setupEventListeners();

  if (!ytApiKey) {
    showScreen('setup');
  } else {
    showScreen('main');
  }
});

async function loadSettings() {
  return new Promise(resolve => {
    chrome.storage.local.get(
      ['ytApiKey', 'anthropicKey', 'blockedCategories', 'productiveTopics',
        'blankHomepage', 'hideComments', 'hideSidebar', 'hideShorts',
        'allowedChannels', 'blockedKeywords'],
      (data) => {
        ytApiKey = data.ytApiKey || ytApiKey;
        anthropicKey = data.anthropicKey || '';
        blockedCategories = data.blockedCategories || blockedCategories;
        productiveTopics = data.productiveTopics || productiveTopics;

        pageSettings.blankHomepage = data.blankHomepage !== undefined ? data.blankHomepage : true;
        pageSettings.hideComments = data.hideComments !== undefined ? data.hideComments : true;
        pageSettings.hideSidebar = data.hideSidebar !== undefined ? data.hideSidebar : true;
        pageSettings.hideShorts = data.hideShorts !== undefined ? data.hideShorts : true;
        pageSettings.allowedChannels = data.allowedChannels || [];
        pageSettings.blockedKeywords = data.blockedKeywords || [];

        syncBlockedTagsUI();
        syncProductiveTagsUI();
        resolve();
      }
    );
  });
}

async function saveSettings() {
  return new Promise(resolve => {
    chrome.storage.local.set({
      ytApiKey, anthropicKey, blockedCategories, productiveTopics,
      ...pageSettings
    }, resolve);
  });
}

// Send new page settings to the active YouTube tab immediately
async function notifyActiveTab() {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];
    if (tab && tab.url && tab.url.includes('youtube.com')) {
      chrome.tabs.sendMessage(tab.id, { action: 'applyFilters', settings: pageSettings });
    }
  } catch (e) { /* tab may not have content script */ }
}

// ===== SCREEN MANAGEMENT =====
function showScreen(name) {
  document.getElementById('setupScreen').classList.add('hidden');
  document.getElementById('mainScreen').classList.add('hidden');
  document.getElementById('settingsPanel').classList.add('hidden');

  if (name === 'setup') document.getElementById('setupScreen').classList.remove('hidden');
  if (name === 'main') document.getElementById('mainScreen').classList.remove('hidden');
  if (name === 'settings') {
    document.getElementById('settingsPanel').classList.remove('hidden');
    document.getElementById('ytKeyEdit').value = ytApiKey;
    document.getElementById('anthropicKeyEdit').value = anthropicKey;
    document.getElementById('toggleBlankHomepage').checked = pageSettings.blankHomepage;
    document.getElementById('toggleHideComments').checked = pageSettings.hideComments;
    document.getElementById('toggleHideSidebar').checked = pageSettings.hideSidebar;
    document.getElementById('toggleHideShorts').checked = pageSettings.hideShorts;
    document.getElementById('allowedChannelsInput').value = pageSettings.allowedChannels.join(', ');
    document.getElementById('blockedKeywordsInput').value = pageSettings.blockedKeywords.join(', ');
  }
}

// ===== EVENT LISTENERS =====
function setupEventListeners() {
  // Setup screen
  document.getElementById('saveKeysBtn').addEventListener('click', handleSaveKeys);

  // Settings
  document.getElementById('settingsBtn').addEventListener('click', () => showScreen('settings'));
  document.getElementById('backBtn').addEventListener('click', () => showScreen('main'));
  document.getElementById('saveSettingsBtn').addEventListener('click', handleSaveSettings);
  document.getElementById('clearDataBtn').addEventListener('click', handleClearData);

  // Mode tabs
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => switchMode(tab.dataset.mode));
  });

  // Search
  document.getElementById('searchBtn').addEventListener('click', handleSearch);
  document.getElementById('searchInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') handleSearch();
  });

  // Watch Later
  document.getElementById('loadWatchLater').addEventListener('click', handleWatchLater);

  // Productive
  document.getElementById('loadProductive').addEventListener('click', handleProductive);
  document.querySelectorAll('.productive-tags .tag').forEach(tag => {
    tag.addEventListener('click', () => {
      tag.classList.toggle('active');
      if (tag.classList.contains('active')) {
        if (!productiveTopics.includes(tag.dataset.topic)) productiveTopics.push(tag.dataset.topic);
      } else {
        productiveTopics = productiveTopics.filter(t => t !== tag.dataset.topic);
      }
    });
  });

  // Channel
  document.getElementById('channelBtn').addEventListener('click', handleChannel);
  document.getElementById('channelInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') handleChannel();
  });

  // Settings tags
  document.querySelectorAll('.block-tag').forEach(tag => {
    tag.addEventListener('click', () => {
      tag.classList.toggle('active');
      const cat = tag.dataset.cat;
      if (tag.classList.contains('active')) {
        if (!blockedCategories.includes(cat)) blockedCategories.push(cat);
      } else {
        blockedCategories = blockedCategories.filter(c => c !== cat);
      }
    });
  });
}

function switchMode(mode) {
  activeMode = mode;
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelector(`.tab[data-mode="${mode}"]`).classList.add('active');

  document.querySelectorAll('.mode-panel').forEach(p => p.classList.remove('active'));
  document.getElementById(`${mode}Mode`).classList.add('active');
}

// ===== SETUP =====
async function handleSaveKeys() {
  const ytKey = document.getElementById('ytApiKeyInput').value.trim();
  const aiKey = document.getElementById('anthropicKeyInput').value.trim();

  if (!ytKey) {
    showStatus('YouTube API key is required', 'error');
    return;
  }

  ytApiKey = ytKey;
  anthropicKey = aiKey;
  await saveSettings();
  showScreen('main');
  showStatus('Keys saved successfully', 'success');
}

async function handleSaveSettings() {
  const ytKey = document.getElementById('ytKeyEdit').value.trim();
  const aiKey = document.getElementById('anthropicKeyEdit').value.trim();

  if (ytKey) ytApiKey = ytKey;
  if (aiKey) anthropicKey = aiKey;

  pageSettings.blankHomepage = document.getElementById('toggleBlankHomepage').checked;
  pageSettings.hideComments = document.getElementById('toggleHideComments').checked;
  pageSettings.hideSidebar = document.getElementById('toggleHideSidebar').checked;
  pageSettings.hideShorts = document.getElementById('toggleHideShorts').checked;

  pageSettings.allowedChannels = document.getElementById('allowedChannelsInput').value
    .split(',').map(c => c.trim()).filter(Boolean);

  pageSettings.blockedKeywords = document.getElementById('blockedKeywordsInput').value
    .split(',').map(k => k.trim()).filter(Boolean);

  await saveSettings();
  await notifyActiveTab();
  showStatus('Settings saved', 'success');
  showScreen('main');
}

async function handleClearData() {
  if (confirm('Clear all data including API keys?')) {
    await chrome.storage.local.clear();
    location.reload();
  }
}

// ===== SYNC UI =====
function syncBlockedTagsUI() {
  document.querySelectorAll('.block-tag').forEach(tag => {
    if (blockedCategories.includes(tag.dataset.cat)) {
      tag.classList.add('active');
    } else {
      tag.classList.remove('active');
    }
  });
}

function syncProductiveTagsUI() {
  document.querySelectorAll('.productive-tags .tag').forEach(tag => {
    if (productiveTopics.includes(tag.dataset.topic)) {
      tag.classList.add('active');
    } else {
      tag.classList.remove('active');
    }
  });
}

// ===== YOUTUBE API =====
async function ytSearch(query, maxResults = 25) {
  const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=${maxResults}&q=${encodeURIComponent(query)}&key=${ytApiKey}`;
  const res = await fetch(url);
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error?.message || 'YouTube API error');
  }
  const data = await res.json();
  return (data.items || []).map(item => ({
    id: item.id.videoId,
    title: item.snippet.title,
    channel: item.snippet.channelTitle,
    url: `https://www.youtube.com/watch?v=${item.id.videoId}`
  }));
}

async function ytChannelVideos(channelQuery, maxResults = 25) {
  // First search for the channel
  const chanUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=channel&maxResults=1&q=${encodeURIComponent(channelQuery)}&key=${ytApiKey}`;
  const chanRes = await fetch(chanUrl);
  if (!chanRes.ok) throw new Error('Could not find channel');
  const chanData = await chanRes.json();

  if (!chanData.items?.length) throw new Error('Channel not found');
  const channelId = chanData.items[0].id.channelId;
  const channelName = chanData.items[0].snippet.channelTitle;

  // Then get videos
  const vidUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${channelId}&type=video&order=date&maxResults=${maxResults}&key=${ytApiKey}`;
  const vidRes = await fetch(vidUrl);
  if (!vidRes.ok) throw new Error('Could not load channel videos');
  const vidData = await vidRes.json();

  return {
    channelName,
    videos: (vidData.items || []).map(item => ({
      id: item.id.videoId,
      title: item.snippet.title,
      channel: channelName,
      url: `https://www.youtube.com/watch?v=${item.id.videoId}`
    }))
  };
}

async function ytPlaylistVideos(playlistId, maxResults = 25) {
  const url = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=${playlistId}&maxResults=${maxResults}&key=${ytApiKey}`;
  const res = await fetch(url);
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error?.message || 'Could not load playlist');
  }
  const data = await res.json();
  return (data.items || [])
    .filter(item => item.snippet.resourceId?.videoId)
    .map(item => ({
      id: item.snippet.resourceId.videoId,
      title: item.snippet.title,
      channel: item.snippet.videoOwnerChannelTitle || '',
      url: `https://www.youtube.com/watch?v=${item.snippet.resourceId.videoId}`
    }));
}

// ===== AI FILTERING =====
async function aiFilter(videos, useFilter) {
  if (!useFilter || !anthropicKey || videos.length === 0) return videos;

  const titles = videos.map((v, i) => `${i}: ${v.title}`).join('\n');
  const blockedList = blockedCategories.join(', ');

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 512,
        messages: [{
          role: 'user',
          content: `You filter YouTube video titles. Remove titles that belong to these categories: ${blockedList}.
Keep educational, technical, informational, and skill-based content.

Titles (index: title):
${titles}

Return ONLY a JSON array of indices to KEEP. Example: [0,2,5,8]. No explanation, just the JSON array.`
        }]
      })
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      const msg = errData.error?.message || `HTTP ${res.status}`;
      console.warn('[YT Focus] AI filter error:', msg);
      showStatus(`AI filter failed: ${msg}`, 'error');
      return videos;
    }
    const data = await res.json();
    const text = data.content?.[0]?.text?.trim() || '[]';
    const keepIndices = JSON.parse(text);
    const filtered = keepIndices.map(i => videos[i]).filter(Boolean);
    return filtered.length > 0 ? filtered : videos;
  } catch (err) {
    console.warn('[YT Focus] AI filter exception:', err);
    showStatus('AI filter unavailable — showing all results', 'error');
    return videos;
  }
}

// ===== HANDLERS =====
async function handleSearch() {
  const query = document.getElementById('searchInput').value.trim();
  if (!query) return;

  const useFilter = document.getElementById('aiFilterSearch').checked;
  const container = document.getElementById('searchResults');

  showLoading(true);
  try {
    let videos = await ytSearch(query, 30);
    videos = await aiFilter(videos, useFilter);
    renderResults(container, videos, useFilter);
    showStatus(`${videos.length} results${useFilter ? ' (AI filtered)' : ''}`, 'success');
  } catch (e) {
    renderError(container, e.message);
  }
  showLoading(false);
}

async function handleWatchLater() {
  const useFilter = document.getElementById('aiFilterWL').checked;
  const container = document.getElementById('watchLaterResults');

  showLoading(true);
  try {
    // Watch Later is playlist "WL" — requires OAuth. We use a fallback approach.
    // Attempt to get from current tab if user is on YouTube.
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const currentTab = tabs[0];

    if (currentTab?.url?.includes('youtube.com/playlist?list=WL')) {
      // User is already on WL page, scrape it
      chrome.tabs.sendMessage(currentTab.id, { action: 'getWatchLater' }, async (response) => {
        if (response?.videos) {
          let videos = response.videos;
          videos = await aiFilter(videos, useFilter);
          renderResults(container, videos, useFilter);
          showStatus(`${videos.length} watch later videos`, 'success');
        } else {
          renderWatchLaterPrompt(container);
        }
        showLoading(false);
      });
      return;
    } else {
      renderWatchLaterPrompt(container);
    }
  } catch (e) {
    renderError(container, e.message);
  }
  showLoading(false);
}

function renderWatchLaterPrompt(container) {
  container.innerHTML = `
    <div class="empty-state">
      To access Watch Later,<br>
      <a href="https://www.youtube.com/playlist?list=WL" target="_blank" 
         style="color: var(--accent); text-decoration: none; cursor: pointer;"
         onclick="chrome.tabs.create({url:'https://www.youtube.com/playlist?list=WL'})">
         → open Watch Later on YouTube
      </a><br>then click Load again.
    </div>`;

  // Add click handler since target="_blank" won't work in popup
  container.querySelector('a')?.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: 'https://www.youtube.com/playlist?list=WL' });
  });
}

async function handleProductive() {
  const container = document.getElementById('productiveResults');
  const topics = productiveTopics.filter(Boolean);

  if (!topics.length) {
    renderError(container, 'Select at least one topic tag above.');
    return;
  }

  showLoading(true);
  try {
    // Fetch from multiple topics and merge
    const queries = topics.slice(0, 4); // Max 4 parallel queries
    const results = await Promise.all(queries.map(q => ytSearch(q, 10).catch(() => [])));

    let videos = [];
    const seen = new Set();
    results.flat().forEach(v => {
      if (!seen.has(v.id)) {
        seen.add(v.id);
        videos.push(v);
      }
    });

    // Always AI-filter productive mode
    if (anthropicKey) {
      videos = await aiFilter(videos, true);
    }

    renderResults(container, videos, !!anthropicKey);
    showStatus(`${videos.length} productive videos`, 'success');
  } catch (e) {
    renderError(container, e.message);
  }
  showLoading(false);
}

async function handleChannel() {
  const query = document.getElementById('channelInput').value.trim();
  if (!query) return;

  const useFilter = document.getElementById('aiFilterChannel').checked;
  const container = document.getElementById('channelResults');

  showLoading(true);
  try {
    const { channelName, videos: rawVideos } = await ytChannelVideos(query, 30);
    let videos = rawVideos;
    videos = await aiFilter(videos, useFilter);

    container.innerHTML = `<div style="padding: 8px 14px; font-family: var(--mono); font-size: 10px; color: var(--text3); border-bottom: 1px solid var(--border);">
      channel: <span style="color: var(--accent)">${escapeHtml(channelName)}</span>
    </div>`;

    const list = document.createElement('div');
    renderResults(list, videos, useFilter);
    container.appendChild(list);
    showStatus(`${videos.length} videos from ${channelName}`, 'success');
  } catch (e) {
    renderError(container, e.message);
  }
  showLoading(false);
}

// ===== RENDER =====
function renderResults(container, videos, wasFiltered) {
  if (!videos.length) {
    container.innerHTML = `<div class="empty-state">no results found<br>${wasFiltered ? '(AI filter may have removed results)' : ''}</div>`;
    return;
  }

  container.innerHTML = videos.map((v, i) => `
    <a class="result-item" href="${escapeHtml(v.url)}" target="_blank" data-url="${escapeHtml(v.url)}">
      <span class="result-num">${String(i + 1).padStart(2, '0')}</span>
      <span class="result-text">
        <span class="result-title">${escapeHtml(v.title)}</span>
        <span class="result-meta">
          <span class="result-channel">${escapeHtml(v.channel || '')}</span>
        </span>
      </span>
    </a>
  `).join('');

  // Open links in new tab properly (popup context)
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

// ===== UI HELPERS =====
function showLoading(show) {
  document.getElementById('loadingOverlay').classList.toggle('hidden', !show);
}

function showStatus(msg, type = '') {
  const bar = document.getElementById('statusBar');
  bar.textContent = msg;
  bar.className = `status-bar ${type}`;
  bar.classList.remove('hidden');
  clearTimeout(bar._timeout);
  bar._timeout = setTimeout(() => bar.classList.add('hidden'), 3000);
}

function escapeHtml(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

