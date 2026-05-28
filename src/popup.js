import { firestoreClient } from "./firestore-client.js";
import { FEATURED_LIMIT, PAGE_SIZE_ALL_COMPLAINTS } from "./comment-model.js";
import { ensureIdentity, updateIdentityName } from "./user-identity.js";
import {
  getAllCache,
  getFeaturedCache,
  saveAllCache,
  saveFeaturedCache,
  setComplaintMode,
  setPendingSectionOpen
} from "./storage.js";

const state = {
  identity: null,
  currentRoomUrl: "",
  allPage: 1,
  allData: { items: [], totalPages: 1, page: 1 }
};

const aliasLine = document.getElementById("aliasLine");
const footerAlias = document.getElementById("footerAlias");
const featuredList = document.getElementById("featuredList");
const allList = document.getElementById("allList");
const viewAllBtn = document.getElementById("viewAllBtn");
const backBtn = document.getElementById("backBtn");
const featuredView = document.getElementById("featuredView");
const allView = document.getElementById("allView");
const tutorialView = document.getElementById("tutorialView");
const mainFooter = document.getElementById("mainFooter");
const editAliasBtn = document.getElementById("editAliasBtn");
const pageInfo = document.getElementById("pageInfo");
const prevPageBtn = document.getElementById("prevPageBtn");
const nextPageBtn = document.getElementById("nextPageBtn");
const activateModeBtn = document.getElementById("activateModeBtn");
const modeStatus = document.getElementById("modeStatus");

init().catch((error) => {
  featuredList.innerHTML = `<p class="lq-muted">${escapeHtml(error.message || "Error de inicializacion.")}</p>`;
});

viewAllBtn.addEventListener("click", async () => {
  setAllComplaintsPage(true);
  state.allPage = 1;
  await loadAllComplaints();
});

backBtn.addEventListener("click", () => {
  setAllComplaintsPage(false);
});

prevPageBtn.addEventListener("click", async () => {
  state.allPage = Math.max(1, state.allPage - 1);
  await loadAllComplaints();
});

nextPageBtn.addEventListener("click", async () => {
  state.allPage = Math.min(state.allData.totalPages || 1, state.allPage + 1);
  await loadAllComplaints();
});

editAliasBtn.addEventListener("click", async () => {
  const current = state.identity?.username || "";
  const next = prompt("Nuevo alias", current);
  if (next === null) return;
  state.identity = await updateIdentityName(next);
  renderIdentity();
});

if (activateModeBtn) {
  activateModeBtn.addEventListener("click", async () => {
    await activateComplaintModeOnTab();
  });
}

async function init() {
  state.identity = await ensureIdentity();
  renderIdentity();
  state.currentRoomUrl = await resolveCurrentRoomUrl();
  await setComplaintMode(false);
  bindRuntimeRefresh();
  startSidebarRefreshLoops();
  await refreshSidebarData({ includeAll: false, forceRoomSync: true });
}

function renderIdentity() {
  const value = `@${state.identity.username}`;
  if (aliasLine) aliasLine.textContent = value;
  if (footerAlias) footerAlias.textContent = value;
}

async function loadFeaturedComplaints() {
  let items = [];
  let degraded = false;
  let totalComplaints = 0;
  try {
    const roomItems = await firestoreClient.getCommentsByPage(state.currentRoomUrl);
    const exactRoomItems = roomItems.filter((item) => item?.pageUrl === state.currentRoomUrl);
    const complaintsOnly = exactRoomItems.filter((item) => !item.parentId);
    items = complaintsOnly.slice(0, FEATURED_LIMIT);
    await saveFeaturedCache(items);
    totalComplaints = complaintsOnly.length;
  } catch (_error) {
    const cachedRoomItems = (await getFeaturedCache()).filter((item) => item?.pageUrl === state.currentRoomUrl && !item?.parentId);
    items = cachedRoomItems;
    degraded = true;
    const cachedAll = (await getAllCache()).filter((item) => item?.pageUrl === state.currentRoomUrl && !item?.parentId);
    totalComplaints = cachedAll.length;
  }

  featuredList.innerHTML = "";
  if (degraded) {
    const note = document.createElement("p");
    note.className = "lq-muted";
    note.textContent = "Mostrando cache local por fallo remoto.";
    featuredList.appendChild(note);
  }

  const safeItems = items.slice(0, FEATURED_LIMIT);
  updateViewAllLabel(totalComplaints);
  if (!safeItems.length) {
    featuredList.innerHTML += '<p class="lq-muted">Todavia no hay quejas destacadas.</p>';
    return;
  }

  safeItems.forEach((item) => {
    featuredList.appendChild(createComplaintItem(item));
  });
}

async function loadAllComplaints() {
  let degraded = false;
  try {
    const roomItems = await firestoreClient.getCommentsByPage(state.currentRoomUrl);
    const exactRoomItems = roomItems.filter((item) => item?.pageUrl === state.currentRoomUrl);
    const complaintsOnly = exactRoomItems.filter((item) => !item.parentId);
    const start = (state.allPage - 1) * PAGE_SIZE_ALL_COMPLAINTS;
    state.allData = {
      items: complaintsOnly.slice(start, start + PAGE_SIZE_ALL_COMPLAINTS),
      totalPages: Math.max(1, Math.ceil(complaintsOnly.length / PAGE_SIZE_ALL_COMPLAINTS)),
      page: state.allPage
    };
    await saveAllCache(complaintsOnly);
  } catch (error) {
    const cached = (await getAllCache()).filter((item) => item?.pageUrl === state.currentRoomUrl);
    degraded = true;
    const start = (state.allPage - 1) * PAGE_SIZE_ALL_COMPLAINTS;
    state.allData = {
      items: cached.slice(start, start + PAGE_SIZE_ALL_COMPLAINTS),
      totalPages: Math.max(1, Math.ceil(cached.length / PAGE_SIZE_ALL_COMPLAINTS)),
      page: state.allPage
    };
    if (!cached.length) {
      allList.innerHTML = `<p class="lq-muted">${escapeHtml(error.message || "No se pudieron cargar las quejas.")}</p>`;
      pageInfo.textContent = "-";
      return;
    }
  }

  allList.innerHTML = "";
  if (degraded) {
    allList.innerHTML = '<p class="lq-muted">Mostrando cache local por fallo remoto.</p>';
  }
  if (!state.allData.items.length) {
    allList.innerHTML = '<p class="lq-muted">No hay quejas para mostrar.</p>';
  } else {
    state.allData.items.forEach((item) => {
      allList.appendChild(createComplaintItem(item));
    });
  }
  pageInfo.textContent = `Página ${state.allData.page} de ${state.allData.totalPages}`;
}

async function resolveCurrentRoomUrl() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url) return "";
  try {
    return new URL(tab.url).href;
  } catch (_) {
    return "";
  }
}

async function refreshSidebarData({ includeAll = false, forceRoomSync = false } = {}) {
  if (forceRoomSync) {
    const nextRoomUrl = await resolveCurrentRoomUrl();
    if (nextRoomUrl && nextRoomUrl !== state.currentRoomUrl) {
      state.currentRoomUrl = nextRoomUrl;
      state.allPage = 1;
      setAllComplaintsPage(false);
    }
  }

  await loadFeaturedComplaints();
  if (includeAll || !allView.classList.contains("hidden")) {
    await loadAllComplaints();
  }
}

function startSidebarRefreshLoops() {
  setInterval(() => {
    if (!document.hidden) {
      refreshSidebarData({ includeAll: false, forceRoomSync: true });
    }
  }, 1500);

  setInterval(() => {
    if (!document.hidden) {
      refreshSidebarData({ includeAll: false, forceRoomSync: false });
    }
  }, 15000);
}

function bindRuntimeRefresh() {
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type !== "ROOM_COMMENTS_UPDATED") return;
    if (!message.pageUrl || message.pageUrl !== state.currentRoomUrl) return;
    refreshSidebarData({ includeAll: !allView.classList.contains("hidden"), forceRoomSync: false });
  });
}

function createComplaintItem(item) {
  const node = document.createElement("article");
  node.className = "complaint-item";
  node.innerHTML = `
    <p class="complaint-text">${escapeHtml(item.emoji || "💬")} ${escapeHtml((item.text || "").slice(0, 90))}</p>
    <button class="complaint-like-pill" type="button">👍 ${Number(item.likeCount || 0)}</button>
  `;
  node.addEventListener("click", () => navigateToComplaint(item));
  return node;
}

function updateViewAllLabel(total) {
  if (!viewAllBtn) return;
  const count = Math.max(0, Number(total || 0));
  viewAllBtn.textContent = `Ver todas las quejas (${count})`;
}

function setAllComplaintsPage(showAll) {
  featuredView.classList.toggle("hidden", showAll);
  allView.classList.toggle("hidden", !showAll);
  if (tutorialView) tutorialView.classList.toggle("hidden", showAll);
  if (mainFooter) mainFooter.classList.toggle("hidden", showAll);
}

async function navigateToComplaint(item) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  if (item.pageUrl && tab.url && new URL(tab.url).href !== new URL(item.pageUrl).href) {
    await setPendingSectionOpen({
      pageUrl: item.pageUrl,
      sectionKey: item.sectionKey,
      createdAt: Date.now()
    });
    await chrome.tabs.update(tab.id, { url: item.pageUrl });
    return;
  }

  await chrome.tabs.sendMessage(tab.id, {
    type: "OPEN_SECTION_FROM_COMMENT",
    sectionKey: item.sectionKey
  });
}

async function activateComplaintModeOnTab() {
  await setComplaintMode(true);
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    if (modeStatus) modeStatus.textContent = "Estado: no se detecta pestaña activa.";
    return;
  }
  if (!canInjectInTab(tab.url || "")) {
    if (modeStatus) modeStatus.textContent = "Estado: esta URL no permite inyección (chrome://, extensiones o internas).";
    return;
  }
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "ACTIVATE_COMPLAINT_MODE" });
    if (modeStatus) modeStatus.textContent = "Estado: activo. Hacé click en un objeto de la página.";
    if (activateModeBtn) activateModeBtn.textContent = "Reactivar";
  } catch (_) {
    try {
      await ensureContentScript(tab.id);
      await chrome.tabs.sendMessage(tab.id, { type: "ACTIVATE_COMPLAINT_MODE" });
      if (modeStatus) modeStatus.textContent = "Estado: activo. Hacé click en un objeto de la página.";
      if (activateModeBtn) activateModeBtn.textContent = "Reactivar";
    } catch (_injectError) {
      if (modeStatus) modeStatus.textContent = "Estado: no se pudo activar en esta pestaña. Probá recargar la página.";
    }
  }
}

async function ensureContentScript(tabId) {
  await chrome.scripting.insertCSS({
    target: { tabId },
    files: ["src/design-tokens.css", "src/content.css"]
  }).catch(() => {});
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["src/content.js"]
  });
}

function canInjectInTab(url) {
  const blockedPrefixes = [
    "chrome://",
    "chrome-extension://",
    "edge://",
    "about:",
    "view-source:"
  ];
  return !blockedPrefixes.some((prefix) => String(url).startsWith(prefix));
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
