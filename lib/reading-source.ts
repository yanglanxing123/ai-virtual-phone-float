export type ReadingBookSource = {
  id: string;
  name: string;
  url: string;
  group?: string;
  enabled: boolean;
  importedAt: string;
  raw: Record<string, unknown>;
  adapter: "shushan" | "generic";
};

const STORAGE_KEY = "reading-book-sources-v1";

function canUseStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function normalizeSource(raw: Record<string, unknown>, index = 0): ReadingBookSource {
  const name = String(raw.bookSourceName || raw.name || `未命名书源 ${index + 1}`).trim();
  const url = String(raw.bookSourceUrl || raw.url || "").trim();
  const group = String(raw.bookSourceGroup || raw.group || "").trim() || undefined;
  const adapter = /vossc\.com|书山聚合|书山/i.test(`${name} ${url}`) ? "shushan" : "generic";
  const stable = `${name}|${url}`;
  let id = "source_";
  try {
    id += btoa(unescape(encodeURIComponent(stable))).replace(/[^a-zA-Z0-9]/g, "").slice(0, 40);
  } catch {
    id += `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }
  return { id, name, url, group, enabled: raw.enabled !== false, importedAt: new Date().toISOString(), raw, adapter };
}

export function loadReadingSources(): ReadingBookSource[] {
  if (!canUseStorage()) return [];
  try {
    const value = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(value) ? value as ReadingBookSource[] : [];
  } catch {
    return [];
  }
}

function persist(items: ReadingBookSource[]) {
  if (!canUseStorage()) return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

export function importReadingSources(rawValue: unknown): { sources: ReadingBookSource[]; added: number; skipped: number } {
  const input = Array.isArray(rawValue) ? rawValue : [rawValue];
  const current = loadReadingSources();
  let added = 0;
  let skipped = 0;
  for (const item of input) {
    if (!item || typeof item !== "object") { skipped++; continue; }
    const source = normalizeSource(item as Record<string, unknown>, added);
    if (!source.url && source.adapter !== "shushan") { skipped++; continue; }
    const same = current.findIndex((x) => x.name === source.name && x.url === source.url);
    if (same >= 0) {
      current[same] = { ...source, id: current[same].id };
    } else {
      current.push(source);
      added++;
    }
  }
  persist(current);
  return { sources: current, added, skipped };
}

export function removeReadingSource(id: string) {
  persist(loadReadingSources().filter((item) => item.id !== id));
}

export function setReadingSourceEnabled(id: string, enabled: boolean) {
  persist(loadReadingSources().map((item) => item.id === id ? { ...item, enabled } : item));
}

export function updateReadingSourceMeta(
  id: string,
  patch: { name?: string; group?: string },
) {
  const nextName = typeof patch.name === "string" ? patch.name.trim() : undefined;
  const nextGroup = typeof patch.group === "string" ? patch.group.trim() : undefined;
  const items = loadReadingSources().map((item) => {
    if (item.id !== id) return item;
    const raw = { ...item.raw };
    if (nextName !== undefined) {
      item.name = nextName || item.name;
      raw.bookSourceName = item.name;
    }
    if (nextGroup !== undefined) {
      item.group = nextGroup || undefined;
      raw.bookSourceGroup = nextGroup;
    }
    return { ...item, raw };
  });
  persist(items);
  return items.find((item) => item.id === id) || null;
}

export function getReadingSource(id: string) {
  return loadReadingSources().find((item) => item.id === id) || null;
}

export type ReadingRemoteBook = {
  sourceId: string;
  sourceName: string;
  book: { title: string; author?: string; cover?: string; desc?: string; bookUrl: string; readerType?: "manga" | "text" };
  chapters: Array<{ title: string; url: string; isPay?: boolean; isVip?: boolean }>;
  savedAt: string;
};

const REMOTE_BOOKS_KEY = "reading-generic-remote-books-v1";

export function saveReadingRemoteBook(bookId: string, remote: ReadingRemoteBook) {
  if (!canUseStorage()) return;
  const all = loadReadingRemoteBooks();
  all[bookId] = remote;
  window.localStorage.setItem(REMOTE_BOOKS_KEY, JSON.stringify(all));
}

export function getReadingRemoteBook(bookId: string): ReadingRemoteBook | null {
  if (!canUseStorage()) return null;
  try {
    const all = JSON.parse(window.localStorage.getItem(REMOTE_BOOKS_KEY) || "{}");
    return all?.[bookId] || null;
  } catch { return null; }
}

export function loadReadingRemoteBooks(): Record<string, ReadingRemoteBook> {
  if (!canUseStorage()) return {};
  try {
    const value = JSON.parse(window.localStorage.getItem(REMOTE_BOOKS_KEY) || "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch { return {}; }
}

export function deleteReadingRemoteBook(bookId: string) {
  if (!canUseStorage()) return;
  const all = loadReadingRemoteBooks();
  delete all[bookId];
  window.localStorage.setItem(REMOTE_BOOKS_KEY, JSON.stringify(all));
}

export type ReadingSourceState = {
  cookies?: string;
  variables?: Record<string, string>;
  updatedAt?: string;
};

const SOURCE_STATE_KEY = "reading-source-state-v2";

export function loadReadingSourceState(sourceId: string): ReadingSourceState {
  if (!canUseStorage()) return {};
  try {
    const all = JSON.parse(window.localStorage.getItem(SOURCE_STATE_KEY) || "{}");
    const value = all?.[sourceId];
    return value && typeof value === "object" ? value as ReadingSourceState : {};
  } catch { return {}; }
}

export function saveReadingSourceState(sourceId: string, state: ReadingSourceState) {
  if (!canUseStorage()) return;
  try {
    const all = JSON.parse(window.localStorage.getItem(SOURCE_STATE_KEY) || "{}");
    all[sourceId] = { ...state, updatedAt: new Date().toISOString() };
    window.localStorage.setItem(SOURCE_STATE_KEY, JSON.stringify(all));
  } catch { /* ignore storage failures */ }
}

export function clearReadingSourceState(sourceId: string) {
  if (!canUseStorage()) return;
  try {
    const all = JSON.parse(window.localStorage.getItem(SOURCE_STATE_KEY) || "{}");
    delete all[sourceId];
    window.localStorage.setItem(SOURCE_STATE_KEY, JSON.stringify(all));
  } catch { /* ignore storage failures */ }
}
