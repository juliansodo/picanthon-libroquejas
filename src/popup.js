import { firestoreClient } from "./firestore-client.js";
import { FEATURED_LIMIT, PAGE_SIZE_ALL_COMPLAINTS, compactContext } from "./comment-model.js";
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
  featuredView.classList.add("hidden");
  allView.classList.remove("hidden");
  state.allPage = 1;
  await loadAllComplaints();
});

backBtn.addEventListener("click", () => {
  allView.classList.add("hidden");
  featuredView.classList.remove("hidden");
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
  await activateComplaintModeOnTab();
  startModeKeepAlive();
  await loadFeaturedComplaints();
}

function renderIdentity() {
  const value = `@${state.identity.username}`;
  aliasLine.textContent = value;
  footerAlias.textContent = value;
}

async function loadFeaturedComplaints() {
  let items = [];
  let degraded = false;
  try {
    items = await firestoreClient.getFeaturedComplaints(FEATURED_LIMIT);
    await saveFeaturedCache(items);
  } catch (_error) {
    items = await getFeaturedCache();
    degraded = true;
  }

  featuredList.innerHTML = "";
  if (degraded) {
    const note = document.createElement("p");
    note.className = "lq-muted";
    note.textContent = "Mostrando cache local por fallo remoto.";
    featuredList.appendChild(note);
  }

  const safeItems = items.slice(0, FEATURED_LIMIT);
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
    state.allData = await firestoreClient.getAllComplaints(state.allPage, PAGE_SIZE_ALL_COMPLAINTS);
    await saveAllCache(state.allData.items);
  } catch (error) {
    const cached = await getAllCache();
    degraded = true;
    state.allData = {
      items: cached.slice(0, PAGE_SIZE_ALL_COMPLAINTS),
      totalPages: 1,
      page: 1
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

function createComplaintItem(item) {
  const node = document.createElement("article");
  node.className = "complaint-item";
  node.innerHTML = `
    <p>${escapeHtml(item.emoji || "💬")} ${escapeHtml((item.text || "").slice(0, 90))}</p>
    <p class="complaint-meta">@${escapeHtml(item.username || "anon")} · ${Number(item.likeCount || 0)} likes · ${compactContext(item.pageUrl || "")}</p>
  `;
  node.addEventListener("click", () => navigateToComplaint(item));
  return node;
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

function startModeKeepAlive() {
  setInterval(() => {
    if (!document.hidden) {
      activateComplaintModeOnTab();
    }
  }, 4000);
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
