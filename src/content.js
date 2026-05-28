(async function bootstrap() {
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
    complaintMode: await getComplaintMode(),
    commentsBySection: new Map(),
    markerBySection: new Map(),
    selectedSectionKey: null,
    panel: null,
    pollTimer: null
  };

  const pageId = buildPageId(location.href);
  const toggleButton = createToggle();
  updateToggleState();

  document.addEventListener("click", onDocumentClick, true);
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
    updateToggleState();
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
    if (event.target.closest(".lq-popup-panel") || event.target.closest(".lq-mode-toggle")) return;
    const target = event.target;
    if (!(target instanceof Element)) return;

    event.preventDefault();
    event.stopPropagation();
    const sectionKey = computeSectionKey(target);
    state.selectedSectionKey = sectionKey;
    await openSectionPanel(sectionKey, target);
  }

  function computeSectionKey(element) {
    const rect = element.getBoundingClientRect();
    const selector = stableSelector(element);
    return `${selector}|${Math.round(rect.top + window.scrollY)}|${Math.round(rect.left + window.scrollX)}`;
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
      const marker = document.createElement("button");
      marker.className = "lq-marker";
      marker.textContent = `${sectionComments.length}`;
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

    const backdrop = document.createElement("div");
    backdrop.className = "lq-popup-backdrop";
    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop) closePanel();
    });

    const panel = document.createElement("div");
    panel.className = "lq-popup-panel";
    panel.innerHTML = `
      <div class="lq-popup-head">
        <strong>Quejas sobre esta seccion</strong>
        <button class="lq-button" data-close>x</button>
      </div>
      <div class="lq-muted" data-count></div>
      <div class="lq-comments" data-comments></div>
      <div class="lq-input-row">
        <select data-emoji></select>
        <textarea data-text maxlength="${MAX_COMMENT_LENGTH}" placeholder="Escribir nueva queja"></textarea>
        <button class="lq-button" data-send>Publicar</button>
      </div>
    `;
    backdrop.appendChild(panel);
    document.documentElement.appendChild(backdrop);

    panel.querySelector("[data-close]").addEventListener("click", closePanel);
    panel.querySelector("[data-send]").addEventListener("click", () => addComment(sectionKey, anchorElement));

    const emojiSelect = panel.querySelector("[data-emoji]");
    DEFAULT_EMOJIS.forEach((emoji) => {
      const option = document.createElement("option");
      option.value = emoji;
      option.textContent = emoji;
      emojiSelect.appendChild(option);
    });

    state.panel = backdrop;
    renderComments(sectionKey);
    schedulePolling();
  }

  function closePanel() {
    if (state.panel) {
      state.panel.remove();
      state.panel = null;
      schedulePolling();
    }
  }

  function sortByLikes(items) {
    return [...items].sort((a, b) => (Number(b.likeCount || 0) - Number(a.likeCount || 0)));
  }

  function renderComments(sectionKey) {
    if (!state.panel) return;
    const all = state.commentsBySection.get(sectionKey) || [];
    const roots = sortByLikes(all.filter((item) => !item.parentId));
    const commentContainer = state.panel.querySelector("[data-comments]");
    const count = state.panel.querySelector("[data-count]");
    count.textContent = `${all.length} quejas`;
    commentContainer.innerHTML = "";

    roots.forEach((comment) => {
      const commentNode = renderCommentNode(sectionKey, comment, all);
      commentContainer.appendChild(commentNode);
    });
  }

  function renderCommentNode(sectionKey, comment, allSectionComments) {
    const isOwn = comment.userId === state.identity.userId;
    const node = document.createElement("div");
    node.className = "lq-comment";
    node.innerHTML = `
      <div>${comment.emoji || "💬"} ${escapeHtml(comment.text || "")}</div>
      <div class="lq-comment-meta">@${escapeHtml(comment.username || "anon")} · ${Number(comment.likeCount || 0)} likes</div>
      <div class="lq-comment-actions">
        <button data-like>${isOwn ? "No podés likearte" : "Like"}</button>
        <button data-reply>Comentarios</button>
        ${isOwn ? '<button data-delete>Borrar</button>' : ""}
      </div>
      <div class="lq-replies" data-replies hidden></div>
      <div class="lq-input-row" data-reply-box hidden>
        <textarea maxlength="${MAX_COMMENT_LENGTH}" placeholder="Responder"></textarea>
        <button class="lq-button" data-send-reply>Enviar respuesta</button>
      </div>
    `;

    node.querySelector("[data-like]").addEventListener("click", () => handleLike(sectionKey, comment));
    node.querySelector("[data-reply]").addEventListener("click", () => toggleReplies(sectionKey, comment, node, allSectionComments));
    if (isOwn) {
      node.querySelector("[data-delete]").addEventListener("click", () => handleDelete(sectionKey, comment.id));
    }
    node.querySelector("[data-send-reply]").addEventListener("click", () => addReply(sectionKey, comment.id, node));
    return node;
  }

  async function addComment(sectionKey, anchorElement) {
    if (!state.panel) return;
    const textNode = state.panel.querySelector("[data-text]");
    const emojiNode = state.panel.querySelector("[data-emoji]");
    const text = sanitizeCommentText(textNode.value);
    if (!text) return;
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
        emoji: emojiNode.value,
        likedBy: [],
        likeCount: 0
      });
      textNode.value = "";
      await reloadComments();
      renderComments(sectionKey);
      setPanelNotice(`${(state.commentsBySection.get(sectionKey) || []).length} quejas`);
    } catch (error) {
      setPanelNotice(error?.message || "No se pudo publicar la queja.");
    }
  }

  async function addReply(sectionKey, parentId, commentNode) {
    const replyBox = commentNode.querySelector("[data-reply-box]");
    const textArea = replyBox.querySelector("textarea");
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
      await reloadComments();
      renderComments(sectionKey);
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
    } catch (error) {
      setPanelNotice(error?.message || "No se pudo actualizar el like.");
    }
  }

  async function handleDelete(sectionKey, commentId) {
    try {
      await firestoreClient.deleteComment(commentId);
      await reloadComments();
      renderComments(sectionKey);
    } catch (error) {
      setPanelNotice(error?.message || "No se pudo eliminar la queja.");
    }
  }

  function toggleReplies(sectionKey, comment, commentNode, allSectionComments) {
    const repliesNode = commentNode.querySelector("[data-replies]");
    const boxNode = commentNode.querySelector("[data-reply-box]");
    const shouldOpen = repliesNode.hidden;
    repliesNode.hidden = !shouldOpen;
    boxNode.hidden = !shouldOpen;
    if (!shouldOpen) return;

    const replies = sortByLikes(allSectionComments.filter((item) => item.parentId === comment.id));
    repliesNode.innerHTML = "";
    replies.forEach((reply) => {
      const item = document.createElement("div");
      item.className = "lq-comment";
      item.innerHTML = `
        <div>${reply.emoji || "💬"} ${escapeHtml(reply.text || "")}</div>
        <div class="lq-comment-meta">@${escapeHtml(reply.username || "anon")} · ${Number(reply.likeCount || 0)} likes</div>
        <div class="lq-comment-actions">
          <button data-like-reply>${reply.userId === state.identity.userId ? "No podés likearte" : "Like"}</button>
          ${reply.userId === state.identity.userId ? '<button data-delete-reply>Borrar</button>' : ""}
        </div>
      `;
      item.querySelector("[data-like-reply]").addEventListener("click", () => handleLike(sectionKey, reply));
      const deleteBtn = item.querySelector("[data-delete-reply]");
      if (deleteBtn) {
        deleteBtn.addEventListener("click", () => handleDelete(sectionKey, reply.id));
      }
      repliesNode.appendChild(item);
    });
  }

  function getAnchorPosition(anchorElement, sectionKey) {
    if (anchorElement && anchorElement instanceof Element) {
      const rect = anchorElement.getBoundingClientRect();
      const x = rect.left + rect.width / 2 + window.scrollX;
      const y = rect.top + rect.height / 2 + window.scrollY;
      const xRatio = x / Math.max(document.documentElement.scrollWidth, 1);
      const yRatio = y / Math.max(document.documentElement.scrollHeight, 1);
      return { x, y, xRatio, yRatio };
    }
    const position = decodeSectionPosition(sectionKey || "");
    const x = position.left;
    const y = position.top;
    const xRatio = x / Math.max(document.documentElement.scrollWidth, 1);
    const yRatio = y / Math.max(document.documentElement.scrollHeight, 1);
    return { x, y, xRatio, yRatio };
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
    const count = state.panel.querySelector("[data-count]");
    if (count) {
      count.textContent = String(message || "");
    }
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
