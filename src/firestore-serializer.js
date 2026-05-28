function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function toFirestoreValue(value) {
  if (value === null || value === undefined) {
    return { nullValue: null };
  }
  if (typeof value === "string") {
    return { stringValue: value };
  }
  if (typeof value === "boolean") {
    return { booleanValue: value };
  }
  if (typeof value === "number") {
    if (Number.isInteger(value)) {
      return { integerValue: String(value) };
    }
    return { doubleValue: value };
  }
  if (value instanceof Date) {
    return { timestampValue: value.toISOString() };
  }
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map(toFirestoreValue) } };
  }
  if (isPlainObject(value)) {
    const fields = {};
    Object.entries(value).forEach(([key, childValue]) => {
      fields[key] = toFirestoreValue(childValue);
    });
    return { mapValue: { fields } };
  }
  return { stringValue: String(value) };
}

function fromFirestoreValue(wrapper) {
  if (!wrapper || typeof wrapper !== "object") {
    return null;
  }
  if ("stringValue" in wrapper) return wrapper.stringValue;
  if ("booleanValue" in wrapper) return wrapper.booleanValue;
  if ("integerValue" in wrapper) return Number(wrapper.integerValue);
  if ("doubleValue" in wrapper) return Number(wrapper.doubleValue);
  if ("timestampValue" in wrapper) return wrapper.timestampValue;
  if ("nullValue" in wrapper) return null;
  if ("arrayValue" in wrapper) {
    const values = wrapper.arrayValue?.values || [];
    return values.map(fromFirestoreValue);
  }
  if ("mapValue" in wrapper) {
    const fields = wrapper.mapValue?.fields || {};
    const parsed = {};
    Object.entries(fields).forEach(([key, value]) => {
      parsed[key] = fromFirestoreValue(value);
    });
    return parsed;
  }
  return null;
}

export function toFirestoreFields(input) {
  const fields = {};
  Object.entries(input || {}).forEach(([key, value]) => {
    fields[key] = toFirestoreValue(value);
  });
  return fields;
}

export function fromFirestoreFields(document) {
  const fields = document?.fields || {};
  const parsed = {};
  Object.entries(fields).forEach(([key, value]) => {
    parsed[key] = fromFirestoreValue(value);
  });
  if (document?.name) {
    parsed.id = document.name.split("/").pop();
  }
  return parsed;
}
