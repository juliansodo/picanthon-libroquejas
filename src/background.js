chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  chrome.action.setBadgeBackgroundColor({ color: "#9858FA" });
  chrome.action.setBadgeTextColor({ color: "#F5F5F7" });
});

chrome.runtime.onStartup.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  chrome.action.setBadgeBackgroundColor({ color: "#9858FA" });
  chrome.action.setBadgeTextColor({ color: "#F5F5F7" });
});

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type !== "SET_PAGE_COMPLAINT_COUNT") return;
  const tabId = sender?.tab?.id;
  if (typeof tabId !== "number") return;
  const count = Math.max(0, Number(message.count || 0));
  chrome.action.setBadgeText({
    tabId,
    text: count > 0 ? String(count) : ""
  });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading") {
    chrome.action.setBadgeText({ tabId, text: "" });
  }
});
