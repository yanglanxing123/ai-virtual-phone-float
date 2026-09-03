export type ShushanAccount = {
  email: string;
  password: string;
  apiKey: string;
  saved: boolean;
  nickname?: string;
  isMember?: boolean;
};

export type ShushanSearchBook = {
  title: string;
  author?: string;
  cover?: string;
  desc?: string;
  source: string;
  book_url: string;
  latestChapterTitle?: string;
  wordCount?: string | number;
  tags?: string;
  tab?: string;
  bookid?: string | number;
  book_id?: string | number;
  bookId?: string | number;
  [key: string]: unknown;
};

export type ShushanDetail = ShushanSearchBook & {
  name?: string;
};

export type ShushanChapter = {
  title: string;
  cid?: string | number;
  url?: string;
  isPay?: boolean;
  isVip?: boolean;
  isVolume?: boolean;
  tag?: string;
  [key: string]: unknown;
};

export type ShushanRemoteBook = {
  source: string;
  url: string;
  name: string;
  apiKey: string;
  bookId?: string;
  cover?: string;
  desc?: string;
  chapters?: ShushanChapter[];
};

export const SHUSHAN_ACCOUNT_KEY = "reading-shushan-account-v2";
export const SHUSHAN_REMOTE_BOOKS_KEY = "reading-shushan-remote-books-v1";

export function loadShushanAccount(): ShushanAccount {
  if (typeof window === "undefined") {
    return { email: "", password: "", apiKey: "", saved: false };
  }
  try {
    const raw = window.localStorage.getItem(SHUSHAN_ACCOUNT_KEY) || window.localStorage.getItem("reading-shushan-account-v1");
    const value = raw ? (JSON.parse(raw) as Partial<ShushanAccount>) : {};
    return {
      email: typeof value.email === "string" ? value.email : "",
      password: typeof value.password === "string" ? value.password : "",
      apiKey: typeof value.apiKey === "string" ? value.apiKey : "",
      saved: value.saved === true && typeof value.apiKey === "string" && value.apiKey.length >= 10,
      nickname: typeof value.nickname === "string" ? value.nickname : undefined,
      isMember: value.isMember === true,
    };
  } catch {
    return { email: "", password: "", apiKey: "", saved: false };
  }
}

export function saveShushanAccount(account: ShushanAccount) {
  try {
    window.localStorage.setItem(SHUSHAN_ACCOUNT_KEY, JSON.stringify(account));
  } catch {}
}

export function clearShushanAccount() {
  try {
    window.localStorage.removeItem(SHUSHAN_ACCOUNT_KEY);
  } catch {}
}

export function loadRemoteBooks(): Record<string, ShushanRemoteBook> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(SHUSHAN_REMOTE_BOOKS_KEY);
    const value = raw ? JSON.parse(raw) : {};
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

export function saveRemoteBook(bookId: string, book: ShushanRemoteBook) {
  const books = loadRemoteBooks();
  books[bookId] = book;
  try {
    window.localStorage.setItem(SHUSHAN_REMOTE_BOOKS_KEY, JSON.stringify(books));
  } catch {}
}

export function removeRemoteBook(bookId: string) {
  const books = loadRemoteBooks();
  delete books[bookId];
  try {
    window.localStorage.setItem(SHUSHAN_REMOTE_BOOKS_KEY, JSON.stringify(books));
  } catch {}
}

export function getRemoteBook(bookId: string): ShushanRemoteBook | null {
  return loadRemoteBooks()[bookId] ?? null;
}

async function shushanRequest<T>(body: Record<string, unknown>): Promise<T> {
  const response = await fetch("/api/reading/shushan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  let data: unknown = null;
  try {
    data = await response.json();
  } catch {
    throw new Error(`书山接口返回了无效数据（HTTP ${response.status}）`);
  }

  if (!response.ok) {
    const message = (data as { error?: string } | null)?.error;
    throw new Error(message || `书山接口请求失败（HTTP ${response.status}）`);
  }
  return data as T;
}

export async function loginShushan(email: string, password: string) {
  return shushanRequest<{
    ok: true;
    apiKey: string;
    user?: { nickname?: string; is_member?: boolean };
    device?: unknown;
  }>({ action: "login", email, password });
}

export async function searchShushan(apiKey: string, keyword: string, source?: string, page = 1) {
  return shushanRequest<{ ok: true; data: ShushanSearchBook[] }>({
    action: "search",
    apiKey,
    keyword,
    source: source?.trim() || "",
    page,
  });
}

export async function getShushanBookInfo(apiKey: string, bookId: string) {
  return shushanRequest<{ ok: true; data: ShushanDetail[] | ShushanDetail }>({
    action: "bookInfo",
    apiKey,
    bookId,
  });
}

export async function getShushanDetail(apiKey: string, item: ShushanSearchBook) {
  return shushanRequest<{ ok: true; data: ShushanDetail }>({
    action: "details",
    apiKey,
    detail: {
      source: item.source,
      url: item.book_url,
      name: item.title,
      cover: item.cover,
      desc: item.desc,
      bookid: item.bookid ?? item.book_id ?? item.bookId ?? "",
    },
  });
}

export async function getShushanCatalog(apiKey: string, detail: ShushanDetail) {
  const rawBookId = detail.bookid ?? detail.book_id ?? detail.bookId;
  const bookId = rawBookId == null ? "" : String(rawBookId).trim();
  return shushanRequest<{ ok: true; data: ShushanChapter[] }>({
    action: "catalog",
    apiKey,
    catalog: {
      source: detail.source,
      url: detail.book_url,
      name: detail.title || detail.name || "",
      tab: detail.tab || "novel",
      bookid: bookId,
    },
  });
}

export async function getShushanChapterContent(
  apiKey: string,
  chapter: ShushanChapter & { book_url?: string },
  catalog: { source: string; url: string; name: string; tab?: string },
  deviceId: string,
) {
  const source = catalog.source;
  const chapterParams: Record<string, unknown> = {
    cid: chapter.cid,
    source,
    version: "12",
    url: catalog.url,
  };

  const url = String(chapter.url || "");
  const bookId = url.match(/book_id=(\d{19})\b/)?.[1] || null;
  const itemId = url.match(/item_id=(\d+)/)?.[1] || null;

  if (["番茄小说", "番茄短剧", "番茄听书", "番茄畅听"].includes(source)) {
    chapterParams.book_id = bookId;
    chapterParams.item_id = itemId;
  }

  if (["企鹅看书", "QQ阅读", "起点"].includes(source)) {
    const bid = url.match(/bookid=(\d+)/)?.[1];
    const cid = url.match(/chapterid=(\d+)/)?.[1];
    if (bid && cid) {
      chapterParams.bookid = source === "企鹅看书" && bid.length > 2 ? bid.substring(2) : bid;
      chapterParams.chapterid = cid;
    }
  }

  if (["晋江", "半夏"].includes(source)) {
    const novelId = url.match(/novelId=(\d+)/)?.[1];
    const chapterId = url.match(/chapterId=(\d+)/)?.[1];
    if (novelId && chapterId) {
      chapterParams.novelId = novelId;
      chapterParams.chapterId = chapterId;
    }
  }

  if (source === "七猫") {
    chapterParams.qm_url = chapter.url;
    const qmBookId = url.match(/book_id=(\d+)/)?.[1];
    const qmChapterId = url.match(/item_id=(\d+)/)?.[1];
    const md5 = url.match(/content_md5=([a-f0-9]+)/)?.[1];
    if (qmBookId) chapterParams.book_id = qmBookId;
    if (qmChapterId) chapterParams.item_id = qmChapterId;
    if (md5) chapterParams.content_md5 = md5;
  }

  return shushanRequest<{ ok: true; content: string; tab?: string; notice?: string; sayBody?: string }>({
    action: "content",
    apiKey,
    chapter: chapterParams,
    deviceId,
  });
}

export function createDeviceId() {
  if (typeof window === "undefined") return "";
  const key = "reading-shushan-device-id-v1";
  try {
    const current = window.localStorage.getItem(key);
    if (current) return current;
    const value = `ios-${crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
    window.localStorage.setItem(key, value);
    return value;
  } catch {
    return `ios-${Date.now()}`;
  }
}
