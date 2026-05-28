const IDENTITY_KEY = "book_identity";
const FEATURED_CACHE_KEY = "featured_cache";
const ALL_CACHE_KEY = "all_cache";
const COMPLAINT_MODE_KEY = "complaint_mode";
const PENDING_SECTION_KEY = "pending_section_open";

export async function readStorage(keys) {
  return chrome.storage.local.get(keys);
}

export async function writeStorage(payload) {
  return chrome.storage.local.set(payload);
}

export async function getIdentity() {
  const data = await readStorage([IDENTITY_KEY]);
  return data[IDENTITY_KEY] || null;
}

export async function saveIdentity(identity) {
  return writeStorage({ [IDENTITY_KEY]: identity });
}

export async function saveFeaturedCache(items) {
  return writeStorage({ [FEATURED_CACHE_KEY]: items });
}

export async function getFeaturedCache() {
  const data = await readStorage([FEATURED_CACHE_KEY]);
  return Array.isArray(data[FEATURED_CACHE_KEY]) ? data[FEATURED_CACHE_KEY] : [];
}

export async function saveAllCache(items) {
  return writeStorage({ [ALL_CACHE_KEY]: items });
}

export async function getAllCache() {
  const data = await readStorage([ALL_CACHE_KEY]);
  return Array.isArray(data[ALL_CACHE_KEY]) ? data[ALL_CACHE_KEY] : [];
}

export async function setComplaintMode(enabled) {
  return writeStorage({ [COMPLAINT_MODE_KEY]: Boolean(enabled) });
}

export async function getComplaintMode() {
  const data = await readStorage([COMPLAINT_MODE_KEY]);
  return Boolean(data[COMPLAINT_MODE_KEY]);
}

export async function setPendingSectionOpen(payload) {
  return writeStorage({ [PENDING_SECTION_KEY]: payload || null });
}

export async function getPendingSectionOpen() {
  const data = await readStorage([PENDING_SECTION_KEY]);
  return data[PENDING_SECTION_KEY] || null;
}

export async function clearPendingSectionOpen() {
  return writeStorage({ [PENDING_SECTION_KEY]: null });
}
