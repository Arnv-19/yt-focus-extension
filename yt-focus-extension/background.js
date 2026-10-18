// ===== YT FOCUS v2.0 — BACKGROUND SERVICE WORKER =====

const DEFAULT_SETTINGS = {
  ytApiKey: '', anthropicKey: '', setupSkipped: false,
  blankHomepage: true, hideThumbnails: true, hideComments: true, hideSidebar: true, hideShorts: true,
  allowedChannels: [], blockedChannels: [], blockedKeywords: [], blockedCategories: ['music', 'entertainment', 'gaming highlights', 'memes', 'reaction videos', 'vlogs'],
  productiveGroups: {}, activeProductiveGroup: '',
  savedPlaylists: [{ name: 'watch later', url: 'https://www.youtube.com/playlist?list=WL' }],
  dailyLimitMinutes: 60, watchedSecondsToday: 0, lastWatchDate: getTodayDateString(),
  lockMode: false, lockReason: '', lockUnlockUntil: 0, lastMode: 'search'
};

function getTodayDateString() {
  return new Date().toISOString().slice(0, 10);
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(null, (existing) => {
    const merged = { ...DEFAULT_SETTINGS, ...existing };
    if (merged.lastWatchDate !== getTodayDateString()) {
      merged.watchedSecondsToday = 0;
      merged.lastWatchDate = getTodayDateString();
    }
    chrome.storage.local.set(merged);
  });
  chrome.alarms.create('ytf-daily-check', { periodInMinutes: 1 });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'ytf-daily-check') {
    chrome.storage.local.get(['lastWatchDate', 'lockReason', 'lockMode'], (data) => {
      const today = getTodayDateString();
      if (data.lastWatchDate !== today) {
        const updates = { watchedSecondsToday: 0, lastWatchDate: today };
        if (data.lockMode && data.lockReason === 'budget') {
          updates.lockMode = false;
          updates.lockReason = '';
        }
        chrome.storage.local.set(updates);
      }
    });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'openTab') {
    chrome.tabs.create({ url: message.url });
    sendResponse({ success: true });
    return false;
  }

  if (message.action === 'watchHeartbeat') {
    const increment = message.seconds || 5;
    chrome.storage.local.get(['watchedSecondsToday', 'lastWatchDate', 'dailyLimitMinutes', 'lockMode'], (data) => {
      const today = getTodayDateString();
      let watched = (data.lastWatchDate === today ? data.watchedSecondsToday : 0) || 0;
      watched += increment;
      const limitMinutes = data.dailyLimitMinutes !== undefined ? data.dailyLimitMinutes : 60;
      const updates = { watchedSecondsToday: watched, lastWatchDate: today };

      if (limitMinutes > 0 && watched >= limitMinutes * 60 && !data.lockMode) {
        updates.lockMode = true;
        updates.lockReason = 'budget';
      }
      chrome.storage.local.set(updates, () => sendResponse({ watchedSecondsToday: watched, locked: !!updates.lockMode }));
    });
    return true;
  }

  if (message.action === 'fetchPlaylistBg') {
    fetchYtData(message.url || 'https://www.youtube.com/playlist?list=WL', 'videos')
      .then(videos => sendResponse({ videos }))
      .catch(err => sendResponse({ error: err.message }));
    return true;
  }

  if (message.action === 'syncUserPlaylistsBg') {
    fetchYtData('https://www.youtube.com/feed/playlists', 'playlists')
      .then(playlists => sendResponse({ playlists }))
      .catch(err => sendResponse({ error: err.message }));
    return true;
  }
});

async function fetchYtData(url, mode) {
  try {
    const res = await fetch(url, { credentials: 'include' });
    const html = await res.text();

    let marker = 'var ytInitialData = ';
    let idx = html.indexOf(marker);
    let offset = marker.length;

    if (idx === -1) {
      marker = 'window["ytInitialData"] = ';
      idx = html.indexOf(marker);
      offset = marker.length;
    }

    if (idx === -1) throw new Error('Could not find YouTube data. Make sure you are signed into YouTube in a browser tab.');

    const start = idx + offset;
    const end = html.indexOf(';</script>', start);
    const data = JSON.parse(html.slice(start, end));

    function extractNodes(rootObj, targetKey) {
      const results = [];
      const stack = [rootObj];
      while (stack.length > 0) {
        const current = stack.pop();
        if (!current || typeof current !== 'object') continue;
        if (current[targetKey]) results.push(current[targetKey]);
        for (const key of Object.keys(current)) {
          if (typeof current[key] === 'object' && current[key] !== null) stack.push(current[key]);
        }
      }
      return results;
    }

    if (mode === 'videos') {
      const renderers = extractNodes(data, 'playlistVideoRenderer');
      const videos = [];
      const seen = new Set();
      for (const r of renderers) {
        const id = r.videoId;
        const title = r.title?.runs?.[0]?.text || r.title?.simpleText || '';
        const channel = r.shortBylineText?.runs?.[0]?.text || '';
        if (id && title && !seen.has(id)) {
          seen.add(id);
          videos.push({ id, title, channel, url: 'https://www.youtube.com/watch?v=' + id });
        }
      }
      return videos;
    } else {
      const playlists = [
        { name: 'watch later', url: 'https://www.youtube.com/playlist?list=WL' },
        { name: 'liked videos', url: 'https://www.youtube.com/playlist?list=LL' }
      ];
      const seen = new Set(['WL', 'LL']);

      const lockups = extractNodes(data, 'lockupViewModel');
      for (const l of lockups) {
        const id = l.contentId;
        const title = l.metadata?.lockupMetadataViewModel?.title?.content || '';
        if (id && title && !id.startsWith('RD') && !seen.has(id)) {
          seen.add(id);
          playlists.push({ name: title.toLowerCase(), url: 'https://www.youtube.com/playlist?list=' + id });
        }
      }

      const classic = extractNodes(data, 'playlistRenderer');
      for (const p of classic) {
        const id = p.playlistId;
        const title = p.title?.simpleText || p.title?.runs?.[0]?.text || '';
        if (id && title && !id.startsWith('RD') && !seen.has(id)) {
          seen.add(id);
          playlists.push({ name: title.toLowerCase(), url: 'https://www.youtube.com/playlist?list=' + id });
        }
      }
      return playlists;
    }
  } catch (err) {
    throw new Error('Sync failed: ' + err.message);
  }
}