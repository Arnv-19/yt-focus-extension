// Background service worker for YT Focus extension
chrome.runtime.onInstalled.addListener(() => {
  console.log('YT Focus extension installed');
});

// Handle messages from content scripts or popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'openTab') {
    chrome.tabs.create({ url: message.url });
    sendResponse({ success: true });
  }
  return true;
});
