export const DEFAULT_EMOJIS = ["💬", "🔥", "😡", "😤", "🤯"];
export const MAX_COMMENT_LENGTH = 240;
export const PAGE_SIZE_ALL_COMPLAINTS = 30;
export const FEATURED_LIMIT = 5;

export function buildPageId(url) {
  const parsed = new URL(url);
  return parsed.href;
}

export function compactContext(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname}`;
  } catch (_) {
    return "contexto-desconocido";
  }
}

export function sanitizeCommentText(text) {
  return String(text || "").trim().slice(0, MAX_COMMENT_LENGTH);
}
