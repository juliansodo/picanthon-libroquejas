import { FIREBASE_CONFIG } from "./firebase-config.js";
import { fromFirestoreFields, toFirestoreFields } from "./firestore-serializer.js";
import { buildPageId } from "./comment-model.js";

const BASE_URL = "https://firestore.googleapis.com/v1";
const COLLECTION = "comments";
const RATE_LIMIT_WINDOW_MS = 4000;
const DEBUG_FLAG = "DEBUG_FIRESTORE";

function nowIso() {
  return new Date().toISOString();
}

function sortByLikesAndCreatedAt(items) {
  return [...items].sort((a, b) => {
    const byLikes = Number(b.likeCount || 0) - Number(a.likeCount || 0);
    if (byLikes !== 0) return byLikes;
    return String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
  });
}

function parseResponseError(status, payload) {
  if (status === 429) return "Demasiadas solicitudes. Reintentá en unos segundos.";
  if (status === 403 || status === 401) return "Sin permisos para acceder a Firestore.";
  return payload?.error?.message || "No se pudo completar la operacion en Firestore.";
}

export class FirestoreClient {
  constructor() {
    this.projectId = FIREBASE_CONFIG.projectId;
    this.apiKey = FIREBASE_CONFIG.apiKey;
    this.cooldownUntil = 0;
  }

  isCoolingDown() {
    return Date.now() < this.cooldownUntil;
  }

  assertReady() {
    if (!this.projectId || !this.apiKey) {
      throw new Error("Falta configuracion de Firebase.");
    }
    if (this.isCoolingDown()) {
      throw new Error("Rate limit activo. Espera unos segundos.");
    }
  }

  shouldDebug() {
    return globalThis[DEBUG_FLAG] === true;
  }

  logDebug(message, payload) {
    if (!this.shouldDebug()) return;
    console.debug(`[Firestore] ${message}`, payload || "");
  }

  buildCollectionUrl() {
    return `${BASE_URL}/projects/${this.projectId}/databases/(default)/documents/${COLLECTION}`;
  }

  buildQueryUrl() {
    return `${BASE_URL}/projects/${this.projectId}/databases/(default)/documents:runQuery`;
  }

  async request(url, options = {}) {
    this.assertReady();
    const finalUrl = `${url}${url.includes("?") ? "&" : "?"}key=${encodeURIComponent(this.apiKey)}`;
    this.logDebug(`${options.method || "GET"} ${finalUrl}`, options.body ? JSON.parse(options.body) : undefined);
    const response = await fetch(finalUrl, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
      ...options
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 429) {
        this.cooldownUntil = Date.now() + RATE_LIMIT_WINDOW_MS;
      }
      throw new Error(parseResponseError(response.status, payload));
    }
    return payload;
  }

  createComment(input) {
    const data = {
      ...input,
      likedBy: Array.isArray(input.likedBy) ? input.likedBy : [],
      likeCount: Array.isArray(input.likedBy) ? input.likedBy.length : Number(input.likeCount || 0),
      createdAt: input.createdAt || nowIso()
    };
    const body = JSON.stringify({ fields: toFirestoreFields(data) });
    return this.request(this.buildCollectionUrl(), { method: "POST", body }).then(fromFirestoreFields);
  }

  updateCommentFields(commentId, partialFields) {
    const updates = { ...partialFields };
    if (Array.isArray(updates.likedBy)) {
      updates.likeCount = updates.likedBy.length;
    }
    const body = JSON.stringify({ fields: toFirestoreFields(updates) });
    const updateMask = Object.keys(updates)
      .map((key) => `updateMask.fieldPaths=${encodeURIComponent(key)}`)
      .join("&");
    const url = `${this.buildCollectionUrl()}/${encodeURIComponent(commentId)}?${updateMask}`;
    return this.request(url, { method: "PATCH", body }).then(fromFirestoreFields);
  }

  deleteComment(commentId) {
    const url = `${this.buildCollectionUrl()}/${encodeURIComponent(commentId)}`;
    return this.request(url, { method: "DELETE" }).then(() => true);
  }

  async runStructuredQuery(structuredQuery) {
    const body = JSON.stringify({ structuredQuery });
    const payload = await this.request(this.buildQueryUrl(), { method: "POST", body });
    return payload
      .map((row) => row.document)
      .filter(Boolean)
      .map(fromFirestoreFields);
  }

  getCommentsByPage(pageUrl) {
    const pageId = buildPageId(pageUrl);
    return this.runStructuredQuery({
      from: [{ collectionId: COLLECTION }],
      where: {
        fieldFilter: {
          field: { fieldPath: "pageId" },
          op: "EQUAL",
          value: { stringValue: pageId }
        }
      }
    }).then(sortByLikesAndCreatedAt);
  }

  getFeaturedComplaints(limit = 5) {
    return this.runStructuredQuery({
      from: [{ collectionId: COLLECTION }]
    }).then((items) => sortByLikesAndCreatedAt(items).slice(0, Math.max(1, Number(limit || 5))));
  }

  async getAllComplaints(page = 1, pageSize = 30) {
    const allRaw = await this.runStructuredQuery({
      from: [{ collectionId: COLLECTION }]
    });
    const all = sortByLikesAndCreatedAt(allRaw);
    const safePage = Math.max(1, Number(page || 1));
    const safeSize = Math.max(1, Number(pageSize || 30));
    const start = (safePage - 1) * safeSize;
    return {
      items: all.slice(start, start + safeSize),
      total: all.length,
      page: safePage,
      pageSize: safeSize,
      totalPages: Math.max(1, Math.ceil(all.length / safeSize))
    };
  }
}

export const firestoreClient = new FirestoreClient();
