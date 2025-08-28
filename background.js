chrome.action.onClicked.addListener((tab) => {
    chrome.sidePanel.open({ windowId: tab.windowId });
});

chrome.runtime.onInstalled.addListener(() => {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

// Listen for settings updates and broadcast to all contexts
chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    if (request.action === 'settings-updated') {
        // Broadcast to all tabs and the side panel
        chrome.runtime.sendMessage({ action: 'reload-tasks' }).catch(() => {
            // Ignore errors if no listeners
        });
        sendResponse({ received: true });
    }
    return true;
});