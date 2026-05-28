import { getIdentity, saveIdentity } from "./storage.js";

function randomAlias() {
  const seed = Math.random().toString(36).slice(2, 8);
  return `usuario_${seed}`;
}

function randomId() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

export async function ensureIdentity() {
  const current = await getIdentity();
  if (current?.userId && current?.username) {
    return current;
  }

  const identity = {
    userId: randomId(),
    username: randomAlias()
  };
  await saveIdentity(identity);
  return identity;
}

export async function updateIdentityName(nextName) {
  const name = String(nextName || "").trim();
  if (!name) {
    throw new Error("El alias no puede estar vacio.");
  }
  const current = await ensureIdentity();
  const updated = { ...current, username: name.replace(/^@+/, "") };
  await saveIdentity(updated);
  return updated;
}
