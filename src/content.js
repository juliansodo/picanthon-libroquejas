(async function bootstrap() {
  if (globalThis.__LQ_CONTENT_BOOTSTRAPPED__) {
    return;
  }
  globalThis.__LQ_CONTENT_BOOTSTRAPPED__ = true;
  let firestoreClient;
  let identityModule;
  let storageModule;
  let modelModule;
  try {
    [{ firestoreClient }, identityModule, storageModule, modelModule] = await Promise.all([
      import(chrome.runtime.getURL("src/firestore-client.js")),
      import(chrome.runtime.getURL("src/user-identity.js")),
      import(chrome.runtime.getURL("src/storage.js")),
      import(chrome.runtime.getURL("src/comment-model.js"))
    ]);
  } catch (error) {
    console.error("[LibroQuejas] No se pudieron cargar modulos del content script.", error);
    return;
  }

  const { ensureIdentity } = identityModule;
  const { clearPendingSectionOpen, getComplaintMode, getPendingSectionOpen, setComplaintMode } = storageModule;
  const { DEFAULT_EMOJIS, MAX_COMMENT_LENGTH, sanitizeCommentText, buildPageId } = modelModule;

  const state = {
    identity: await ensureIdentity(),
    complaintMode: false,
    commentsBySection: new Map(),
    markerBySection: new Map(),
    selectedSectionKey: null,
    panel: null,
    pollTimer: null,
    hoveredElement: null,
    openThreadFor: null
  };

  const pageId = buildPageId(location.href);
  const toggleButton = createToggle();
  await setComplaintMode(false);
  updateToggleState();

  document.addEventListener("click", onDocumentClick, true);
  document.addEventListener("mouseover", onPointerOver, true);
  document.addEventListener("mouseout", onPointerOut, true);
  window.addEventListener("resize", () => rerenderMarkers());
  document.addEventListener("visibilitychange", onVisibilityChange);
  chrome.runtime.onMessage.addListener(onMessage);

  await reloadComments();
  await tryConsumePendingOpen();
  schedulePolling();

  function onMessage(message, _sender, sendResponse) {
    if (!message || typeof message !== "object") return;
    if (message.type === "ACTIVATE_COMPLAINT_MODE") {
      setMode(true).then(() => sendResponse({ ok: true }));
      return true;
    }
    if (message.type === "OPEN_SECTION_FROM_COMMENT") {
      if (message.sectionKey) {
        reloadComments().then(() => {
          state.selectedSectionKey = message.sectionKey;
          scrollToSection(message.sectionKey);
          openSectionPanel(message.sectionKey);
        });
      }
      sendResponse({ ok: true });
      return true;
    }
    if (message.type === "PING_BOOK") {
      sendResponse({ ok: true, pageId });
      return true;
    }
    return undefined;
  }

  function onVisibilityChange() {
    if (state.pollTimer) {
      clearTimeout(state.pollTimer);
      state.pollTimer = null;
    }
    if (!document.hidden) {
      reloadComments().finally(schedulePolling);
    }
  }

  async function setMode(enabled) {
    state.complaintMode = Boolean(enabled);
    await setComplaintMode(state.complaintMode);
    if (!state.complaintMode) {
      clearHoverTarget();
    }
    updateToggleState();
  }

  function onPointerOver(event) {
    if (!state.complaintMode) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (isInternalElement(target)) return;
    if (state.hoveredElement === target) return;
    clearHoverTarget();
    state.hoveredElement = target;
    state.hoveredElement.classList.add("lq-hover-target");
  }

  function onPointerOut(event) {
    if (!state.complaintMode) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target !== state.hoveredElement) return;
    const related = event.relatedTarget;
    if (related instanceof Element && related === state.hoveredElement) return;
    clearHoverTarget();
  }

  function createToggle() {
    const button = document.createElement("button");
    button.className = "lq-button lq-mode-toggle";
    button.textContent = "Modo queja: OFF";
    button.addEventListener("click", async (event) => {
      event.stopPropagation();
      await setMode(!state.complaintMode);
    });
    document.documentElement.appendChild(button);
    return button;
  }

  function updateToggleState() {
    toggleButton.textContent = `Modo queja: ${state.complaintMode ? "ON" : "OFF"}`;
  }

  async function onDocumentClick(event) {
    if (!state.complaintMode) return;
    if (isInternalElement(event.target)) return;
    const target = event.target;
    if (!(target instanceof Element)) return;

    event.preventDefault();
    event.stopPropagation();
    const sectionKey = computeSectionKey(target, event.pageX, event.pageY);
    state.selectedSectionKey = sectionKey;
    await openSectionPanel(sectionKey, target);
  }

  function isInternalElement(node) {
    return node instanceof Element &&
      (node.closest(".lq-popup-panel") || node.closest(".lq-mode-toggle") || node.closest(".lq-marker"));
  }

  function computeSectionKey(element, pageX, pageY) {
    const rect = element.getBoundingClientRect();
    const x = Number.isFinite(pageX) ? pageX : (window.scrollX + rect.left);
    const y = Number.isFinite(pageY) ? pageY : (window.scrollY + rect.top);
    const selector = stableSelector(element);
    return `${selector}|${Math.round(y)}|${Math.round(x)}`;
  }

  function stableSelector(element) {
    const chunks = [];
    let current = element;
    for (let i = 0; i < 3 && current; i += 1) {
      const part = current.tagName?.toLowerCase() || "node";
      const className = current.classList?.[0] ? `.${current.classList[0]}` : "";
      chunks.unshift(`${part}${className}`);
      current = current.parentElement;
    }
    return chunks.join(">");
  }

  async function reloadComments() {
    const allComments = await firestoreClient.getCommentsByPage(location.href).catch(() => []);
    state.commentsBySection.clear();
    allComments.forEach((item) => {
      const key = item.sectionKey || "general";
      if (!state.commentsBySection.has(key)) {
        state.commentsBySection.set(key, []);
      }
      state.commentsBySection.get(key).push(item);
    });
    rerenderMarkers();
    notifyBadgeCount();
  }

  function schedulePolling() {
    if (document.hidden) return;
    if (state.pollTimer) clearTimeout(state.pollTimer);
    const interval = state.panel ? 5000 : 18000;
    state.pollTimer = setTimeout(async () => {
      await reloadComments();
      schedulePolling();
    }, interval);
  }

  function rerenderMarkers() {
    state.markerBySection.forEach((node) => node.remove());
    state.markerBySection.clear();

    state.commentsBySection.forEach((sectionComments, sectionKey) => {
      const complaintsCount = sectionComments.filter((item) => !item.parentId).length;
      if (!complaintsCount) return;
      const marker = document.createElement("button");
      marker.className = "lq-marker";
      marker.textContent = `${complaintsCount}`;
      marker.title = "Ver quejas de esta seccion";
      const position = decodeSectionPosition(sectionKey);
      marker.style.top = `${position.top}px`;
      marker.style.left = `${position.left}px`;
      marker.addEventListener("click", (event) => {
        event.stopPropagation();
        openSectionPanel(sectionKey);
      });
      document.documentElement.appendChild(marker);
      state.markerBySection.set(sectionKey, marker);
    });
  }

  function decodeSectionPosition(sectionKey) {
    const parts = sectionKey.split("|");
    const top = Number(parts[1] || 40);
    const left = Number(parts[2] || 40);
    return { top, left };
  }

  function openSectionPanel(sectionKey, anchorElement) {
    closePanel();
    document.querySelectorAll(".lq-popup-backdrop").forEach((node) => node.remove());

    const backdrop = document.createElement("div");
    backdrop.className = "lq-popup-backdrop";
    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop) closePanel();
    });

    const panel = document.createElement("div");
    panel.className = "lq-popup-panel";
    panel.innerHTML = `
      <div class="lq-popup-head">
        <div class="lq-popup-title-row">
          <span class="lq-count-badge" data-count-badge>0</span>
          <strong data-panel-title>Quejas sobre esta sección</strong>
        </div>
        <button class="lq-popup-close" data-close aria-label="Cerrar">✕</button>
      </div>
      <div class="lq-popup-body" data-complaints-screen>
        <div class="lq-comments" data-comments></div>
        <button class="lq-compose-trigger" data-open-compose>+ Escribir nueva queja</button>
        <div class="lq-input-row lq-hidden" data-compose-box>
          <textarea data-text maxlength="${MAX_COMMENT_LENGTH}" placeholder="Tu momento de catarsis..."></textarea>
          <div class="lq-emoji-label">Agregá emoji</div>
          <div class="lq-emoji-picker" data-emoji-picker></div>
          <div class="lq-compose-actions">
            <button class="lq-text-button" data-cancel-compose>Cancelar</button>
            <button class="lq-button" data-send>Quejarme</button>
          </div>
        </div>
      </div>
      <div class="lq-thread-screen lq-hidden" data-thread-screen>
        <div class="lq-thread-head">
          <button class="lq-text-button" data-thread-back>← Volver</button>
          <strong>Comentarios de la queja</strong>
        </div>
        <div class="lq-thread-root" data-thread-root></div>
        <div class="lq-thread-list" data-thread-list></div>
        <div class="lq-input-row lq-thread-input">
          <textarea data-thread-text maxlength="${MAX_COMMENT_LENGTH}" placeholder="Escribir comentario"></textarea>
          <button class="lq-button" data-thread-send>Comentar</button>
        </div>
      </div>
      <div class="lq-muted lq-status-text" data-status></div>
    `;
    backdrop.appendChild(panel);
    document.documentElement.appendChild(backdrop);
    placePanelNearAnchor(panel, anchorElement, sectionKey);

    panel.querySelector("[data-close]").addEventListener("click", closePanel);
    panel.querySelector("[data-send]").addEventListener("click", () => addComment(sectionKey, anchorElement));
    panel.querySelector("[data-open-compose]").addEventListener("click", () => toggleComposeBox(true));
    panel.querySelector("[data-cancel-compose]").addEventListener("click", () => handleCancelCompose(sectionKey));
    panel.querySelector("[data-thread-back]").addEventListener("click", () => {
      state.openThreadFor = null;
      renderComments(sectionKey);
    });
    panel.querySelector("[data-thread-send]").addEventListener("click", () => {
      if (!state.openThreadFor) return;
      addReply(sectionKey, state.openThreadFor);
    });

    const emojiPicker = panel.querySelector("[data-emoji-picker]");
    DEFAULT_EMOJIS.forEach((emoji) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "lq-emoji-option";
      button.dataset.emoji = emoji;
      button.textContent = emoji;
      button.addEventListener("click", () => selectComposeEmoji(emoji));
      emojiPicker.appendChild(button);
    });
    selectComposeEmoji(DEFAULT_EMOJIS[0] || "💬");

    state.panel = backdrop;
    renderComments(sectionKey);
    schedulePolling();
  }

  function toggleComposeBox(show) {
    if (!state.panel) return;
    const compose = state.panel.querySelector("[data-compose-box]");
    const trigger = state.panel.querySelector("[data-open-compose]");
    if (!compose || !trigger) return;
    compose.classList.toggle("lq-hidden", !show);
    trigger.classList.toggle("lq-hidden", show);
    if (show) {
      const input = compose.querySelector("[data-text]");
      if (input instanceof HTMLTextAreaElement) input.focus();
    }
  }

  function handleCancelCompose(sectionKey) {
    const total = (state.commentsBySection.get(sectionKey) || []).length;
    if (!total) {
      closePanel();
      return;
    }
    toggleComposeBox(false);
  }

  function selectComposeEmoji(emoji) {
    if (!state.panel) return;
    state.panel.dataset.selectedEmoji = emoji || "💬";
    const options = state.panel.querySelectorAll(".lq-emoji-option");
    options.forEach((node) => {
      if (!(node instanceof HTMLElement)) return;
      node.classList.toggle("lq-emoji-option-active", node.dataset.emoji === state.panel.dataset.selectedEmoji);
    });
  }

  function closePanel() {
    if (state.panel) {
      state.panel.remove();
      state.panel = null;
      schedulePolling();
    }
  }

  function clearHoverTarget() {
    if (!state.hoveredElement) return;
    state.hoveredElement.classList.remove("lq-hover-target");
    state.hoveredElement = null;
  }

  function sortByLikes(items) {
    return [...items].sort((a, b) => (Number(b.likeCount || 0) - Number(a.likeCount || 0)));
  }

  function renderComments(sectionKey) {
    if (!state.panel) return;
    const all = state.commentsBySection.get(sectionKey) || [];
    const roots = sortByLikes(all.filter((item) => !item.parentId));
    const commentContainer = state.panel.querySelector("[data-comments]");
    const threadScreen = state.panel.querySelector("[data-thread-screen]");
    const complaintsScreen = state.panel.querySelector("[data-complaints-screen]");
    const countBadge = state.panel.querySelector("[data-count-badge]");
    const title = state.panel.querySelector("[data-panel-title]");
    const trigger = state.panel.querySelector("[data-open-compose]");
    if (countBadge) countBadge.textContent = String(all.length);
    if (title) {
      title.textContent = state.openThreadFor
        ? "Comentarios de la queja"
        : (all.length ? "Quejas sobre esta sección" : "Nueva queja sobre este objeto");
    }
    commentContainer.innerHTML = "";

    if (state.openThreadFor) {
      const root = all.find((item) => item.id === state.openThreadFor);
      if (!root) {
        state.openThreadFor = null;
      } else {
        if (complaintsScreen) complaintsScreen.classList.add("lq-hidden");
        if (threadScreen) threadScreen.classList.remove("lq-hidden");
        renderThreadView(sectionKey, all, root);
        return;
      }
    }

    if (complaintsScreen) complaintsScreen.classList.remove("lq-hidden");
    if (threadScreen) threadScreen.classList.add("lq-hidden");

    if (!roots.length) {
      commentContainer.innerHTML = "";
      commentContainer.classList.add("lq-hidden");
      if (trigger) trigger.classList.add("lq-hidden");
      toggleComposeBox(true);
      return;
    }
    commentContainer.classList.remove("lq-hidden");
    if (trigger) trigger.classList.remove("lq-hidden");

    roots.forEach((comment) => {
      const commentNode = renderCommentNode(sectionKey, comment, all);
      commentContainer.appendChild(commentNode);
    });

  }

  function renderCommentNode(sectionKey, comment, allSectionComments) {
    const isOwn = comment.userId === state.identity.userId;
    const repliesCount = allSectionComments.filter((item) => item.parentId === comment.id).length;
    const node = document.createElement("div");
    node.className = "lq-comment";
    node.innerHTML = `
      <div class="lq-comment-main">
        <div class="lq-comment-emoji">${comment.emoji || "💬"}</div>
        <div class="lq-comment-text">${escapeHtml(comment.text || "")}</div>
        <div class="lq-comment-actions">
          <button class="lq-action-pill" data-like>${isOwn ? "👍 -" : `👍 ${Number(comment.likeCount || 0)}`}</button>
          <button class="lq-action-pill" data-open-comments>💬 ${repliesCount}</button>
          ${isOwn ? '<button class="lq-action-pill" data-delete>🗑</button>' : ""}
        </div>
      </div>
    `;

    node.querySelector("[data-like]").addEventListener("click", () => handleLike(sectionKey, comment));
    node.querySelector("[data-open-comments]").addEventListener("click", () => {
      state.openThreadFor = state.openThreadFor === comment.id ? null : comment.id;
      renderComments(sectionKey);
    });
    if (isOwn) {
      node.querySelector("[data-delete]").addEventListener("click", () => handleDelete(sectionKey, comment.id));
    }
    return node;
  }

  function renderThreadView(sectionKey, allSectionComments, root) {
    if (!state.panel) return;
    const threadRoot = state.panel.querySelector("[data-thread-root]");
    const threadList = state.panel.querySelector("[data-thread-list]");
    if (!threadList || !threadRoot) return;

    threadRoot.innerHTML = `
      <div class="lq-thread-root-label">Queja original</div>
      <div class="lq-thread-item lq-thread-item-root">
        <div class="lq-thread-main">
          <span class="lq-thread-user">@${escapeHtml(root.username || "anon")}</span>
          <span class="lq-thread-text">${escapeHtml(root.text || "")}</span>
        </div>
        <div class="lq-thread-actions">
          <button class="lq-action-pill" data-thread-like-root>👍 ${Number(root.likeCount || 0)}</button>
          ${root.userId === state.identity.userId ? '<button class="lq-action-pill" data-thread-delete-root>🗑</button>' : ""}
        </div>
      </div>
    `;

    threadRoot.querySelector("[data-thread-like-root]").addEventListener("click", () => handleLike(sectionKey, root));
    const deleteRoot = threadRoot.querySelector("[data-thread-delete-root]");
    if (deleteRoot) {
      deleteRoot.addEventListener("click", () => handleDelete(sectionKey, root.id));
    }

    const replies = getThreadComments(root.id, allSectionComments).filter((item) => item.id !== root.id);
    threadList.innerHTML = "";
    if (!replies.length) {
      threadList.innerHTML = '<div class="lq-empty-card">Todavía no hay respuestas para esta queja.</div>';
      return;
    }

    replies.forEach((item) => {
      const row = document.createElement("div");
      row.className = "lq-thread-item lq-thread-item-reply";
      row.innerHTML = `
        <div class="lq-thread-main">
          <span class="lq-thread-kind">Respuesta</span>
          <span class="lq-thread-user">@${escapeHtml(item.username || "anon")}</span>
          <span class="lq-thread-text">${escapeHtml(item.text || "")}</span>
        </div>
        <div class="lq-thread-actions">
          <button class="lq-action-pill" data-thread-like>👍 ${Number(item.likeCount || 0)}</button>
          ${item.userId === state.identity.userId ? '<button class="lq-action-pill" data-thread-delete>🗑</button>' : ""}
        </div>
      `;
      row.querySelector("[data-thread-like]").addEventListener("click", () => handleLike(sectionKey, item));
      const del = row.querySelector("[data-thread-delete]");
      if (del) del.addEventListener("click", () => handleDelete(sectionKey, item.id));
      threadList.appendChild(row);
    });
  }

  function getThreadComments(rootId, allSectionComments) {
    const byParent = new Map();
    allSectionComments.forEach((item) => {
      const key = item.parentId || "__root__";
      if (!byParent.has(key)) byParent.set(key, []);
      byParent.get(key).push(item);
    });

    const ordered = [];
    const walk = (id, depth) => {
      const node = allSectionComments.find((item) => item.id === id);
      if (!node) return;
      ordered.push({ ...node, depth });
      const children = sortByLikes(byParent.get(id) || []);
      children.forEach((child) => walk(child.id, depth + 1));
    };
    walk(rootId, 0);
    return ordered;
  }

  async function addComment(sectionKey, anchorElement) {
    if (!state.panel) return;
    const textNode = state.panel.querySelector("[data-text]");
    const text = sanitizeCommentText(textNode.value);
    if (!text) return;
    const selectedEmoji = state.panel.dataset.selectedEmoji || DEFAULT_EMOJIS[0] || "💬";
    const coords = getAnchorPosition(anchorElement, sectionKey);
    try {
      await firestoreClient.createComment({
        pageId,
        pageUrl: location.href,
        sectionKey,
        x: coords.x,
        y: coords.y,
        xRatio: coords.xRatio,
        yRatio: coords.yRatio,
        parentId: null,
        userId: state.identity.userId,
        username: state.identity.username,
        text,
        emoji: selectedEmoji,
        likedBy: [],
        likeCount: 0
      });
      textNode.value = "";
      toggleComposeBox(false);
      await reloadComments();
      renderComments(sectionKey);
      notifyRoomUpdated();
      setPanelNotice(`${(state.commentsBySection.get(sectionKey) || []).length} quejas`);
    } catch (error) {
      setPanelNotice(error?.message || "No se pudo publicar la queja.");
    }
  }

  async function addReply(sectionKey, parentId) {
    if (!state.panel) return;
    const textArea = state.panel.querySelector("[data-thread-text]");
    const text = sanitizeCommentText(textArea.value);
    if (!text) return;
    try {
      await firestoreClient.createComment({
        pageId,
        pageUrl: location.href,
        sectionKey,
        parentId,
        x: 0,
        y: 0,
        xRatio: 0,
        yRatio: 0,
        userId: state.identity.userId,
        username: state.identity.username,
        text,
        emoji: "💬",
        likedBy: [],
        likeCount: 0
      });
      textArea.value = "";
      state.openThreadFor = parentId;
      await reloadComments();
      renderComments(sectionKey);
      notifyRoomUpdated();
      setPanelNotice("Respuesta publicada.");
    } catch (error) {
      setPanelNotice(error?.message || "No se pudo publicar la respuesta.");
    }
  }

  async function handleLike(sectionKey, comment) {
    if (comment.userId === state.identity.userId) return;
    const likedBy = Array.isArray(comment.likedBy) ? [...comment.likedBy] : [];
    const index = likedBy.indexOf(state.identity.userId);
    if (index >= 0) likedBy.splice(index, 1);
    else likedBy.push(state.identity.userId);
    try {
      await firestoreClient.updateCommentFields(comment.id, { likedBy });
      await reloadComments();
      renderComments(sectionKey);
      notifyRoomUpdated();
    } catch (error) {
      setPanelNotice(error?.message || "No se pudo actualizar el like.");
    }
  }

  async function handleDelete(sectionKey, commentId) {
    try {
      await firestoreClient.deleteComment(commentId);
      await reloadComments();
      renderComments(sectionKey);
      notifyRoomUpdated();
    } catch (error) {
      setPanelNotice(error?.message || "No se pudo eliminar la queja.");
    }
  }

  function getAnchorPosition(anchorElement, sectionKey) {
    const position = decodeSectionPosition(sectionKey || "");
    if (Number.isFinite(position.left) && Number.isFinite(position.top)) {
      const x = position.left;
      const y = position.top;
      const xRatio = x / Math.max(document.documentElement.scrollWidth, 1);
      const yRatio = y / Math.max(document.documentElement.scrollHeight, 1);
      return { x, y, xRatio, yRatio };
    }
    if (anchorElement && anchorElement instanceof Element) {
      const rect = anchorElement.getBoundingClientRect();
      const x = rect.left + rect.width / 2 + window.scrollX;
      const y = rect.top + rect.height / 2 + window.scrollY;
      const xRatio = x / Math.max(document.documentElement.scrollWidth, 1);
      const yRatio = y / Math.max(document.documentElement.scrollHeight, 1);
      return { x, y, xRatio, yRatio };
    }
    return { x: 0, y: 0, xRatio: 0, yRatio: 0 };
  }

  function getViewportAnchorPosition(anchorElement, sectionKey) {
    if (anchorElement && anchorElement instanceof Element) {
      const rect = anchorElement.getBoundingClientRect();
      return {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2
      };
    }
    const position = decodeSectionPosition(sectionKey || "");
    return {
      x: position.left - window.scrollX,
      y: position.top - window.scrollY
    };
  }

  function placePanelNearAnchor(panel, anchorElement, sectionKey) {
    const anchor = getViewportAnchorPosition(anchorElement, sectionKey);
    const margin = 12;
    const panelWidth = Math.min(420, Math.max(300, Math.floor(window.innerWidth * 0.92)));
    const panelMaxHeight = Math.min(520, Math.max(280, Math.floor(window.innerHeight * 0.9)));
    panel.style.width = `${panelWidth}px`;
    panel.style.maxHeight = `${panelMaxHeight}px`;

    const left = Math.min(
      Math.max(margin, anchor.x + margin),
      Math.max(margin, window.innerWidth - panelWidth - margin)
    );
    const top = Math.min(
      Math.max(margin, anchor.y + margin),
      Math.max(margin, window.innerHeight - panelMaxHeight - margin)
    );

    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
  }

  function scrollToSection(sectionKey) {
    const position = decodeSectionPosition(sectionKey || "");
    const targetTop = Math.max(0, Number(position.top || 0) - Math.floor(window.innerHeight * 0.35));
    window.scrollTo({
      top: targetTop,
      behavior: "smooth"
    });
  }

  async function tryConsumePendingOpen() {
    const pending = await getPendingSectionOpen();
    if (!pending?.pageUrl || !pending?.sectionKey) return;
    const samePage = new URL(pending.pageUrl).href === new URL(location.href).href;
    const freshEnough = Date.now() - Number(pending.createdAt || 0) < 45000;
    if (!samePage || !freshEnough) return;
    await clearPendingSectionOpen();
    state.selectedSectionKey = pending.sectionKey;
    openSectionPanel(pending.sectionKey);
  }

  function setPanelNotice(message) {
    if (!state.panel) return;
    const status = state.panel.querySelector("[data-status]");
    if (status) {
      status.textContent = String(message || "");
    }
  }

  function notifyRoomUpdated() {
    chrome.runtime.sendMessage({
      type: "ROOM_COMMENTS_UPDATED",
      pageUrl: location.href
    }).catch(() => {});
  }

  function notifyBadgeCount() {
    let totalComplaints = 0;
    state.commentsBySection.forEach((sectionComments) => {
      totalComplaints += sectionComments.filter((item) => !item.parentId).length;
    });
    chrome.runtime.sendMessage({
      type: "SET_PAGE_COMPLAINT_COUNT",
      count: totalComplaints
    }).catch(() => {});
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
})();
