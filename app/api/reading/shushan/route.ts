import { NextRequest, NextResponse } from "next/server";
import dns from "node:dns/promises";
import net from "node:net";
import crypto from "node:crypto";

export const runtime = "nodejs";

const DEFAULT_HOSTS = [
  "https://v1.vossc.com",
  "https://v2.vossc.com",
  "https://v3.vossc.com",
  "https://v4.vossc.com",
];
const NOVEL_TOKEN = "SHUSAN_READ_2025";
const DEFAULT_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1";

function isPrivateIPv4(ip: string) {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = parts;
  return a === 10 || a === 127 || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127);
}

function isPrivateIPv6(ip: string) {
  const value = ip.toLowerCase();
  return value === "::1" || value.startsWith("fc") || value.startsWith("fd") ||
    value.startsWith("fe80:") || value.startsWith("::ffff:127.");
}

async function assertSafeTarget(input: string) {
  const url = new URL(input);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error("仅支持 HTTP/HTTPS");
  if (url.username || url.password) throw new Error("URL 不允许携带认证信息");
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) {
    throw new Error("禁止访问本机或本地域名");
  }
  if (net.isIP(host) === 4 && isPrivateIPv4(host)) throw new Error("禁止访问内网地址");
  if (net.isIP(host) === 6 && isPrivateIPv6(host)) throw new Error("禁止访问内网地址");
  if (!net.isIP(host)) {
    const records = await dns.lookup(host, { all: true });
    if (!records.length || records.some((record) =>
      record.family === 4 ? isPrivateIPv4(record.address) : isPrivateIPv6(record.address))) {
      throw new Error("目标域名解析到内网或保留地址，已阻止请求");
    }
  }
}

function jsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function extractApiKey(payload: any): string {
  return String(
    payload?.data?.user?.api_key ??
    payload?.data?.api_key ??
    payload?.user?.api_key ??
    payload?.api_key ??
    "",
  ).trim();
}

function chooseHosts(preferred?: unknown) {
  const custom = Array.isArray(preferred)
    ? preferred.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
  return [...new Set([...custom, ...DEFAULT_HOSTS])].filter((host) => {
    try {
      const u = new URL(host);
      return ["http:", "https:"].includes(u.protocol);
    } catch {
      return false;
    }
  });
}

async function fetchUpstream(
  host: string,
  path: string,
  options: { method?: string; body?: unknown; apiKey?: string; deviceId?: string; timeoutMs?: number } = {},
) {
  const url = new URL(path, host).toString();
  await assertSafeTarget(url);
  const controller = new AbortController();
  const timeoutMs = Math.max(5000, Math.min(30000, Number(options.timeoutMs) || 15000));
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers: Record<string, string> = {
      "Accept": "application/json,text/plain,*/*;q=0.8",
      "User-Agent": DEFAULT_UA,
    };
    let body: string | undefined;
    if (options.apiKey) headers["X-Api-Key"] = Buffer.from(options.apiKey, "utf8").toString("base64");
    // 书山原书源全局 header：正文接口除 Api-Key 外还要求固定 Novel-Token。
    headers["X-Novel-Token"] = NOVEL_TOKEN;
    if (options.deviceId) {
      // 书山原书源的 content 请求使用 X-Device-Type / X-Device-Id。
      headers["X-Device-Type"] = "ios";
      headers["X-Device-Id"] = options.deviceId;
    }
    if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
      body = typeof options.body === "string" ? options.body : JSON.stringify(options.body);
    }
    const response = await fetch(url, {
      method: options.method || "GET",
      headers,
      body,
      redirect: "follow",
      cache: "no-store",
      signal: controller.signal,
    });
    const text = await response.text();
    let parsed: any = null;
    try { parsed = JSON.parse(text); } catch {}
    return { response, text, parsed, url };
  } finally {
    clearTimeout(timer);
  }
}


function looksLikeReadableNovelText(value: string) {
  const text = String(value || "").trim();
  if (!text || text.length < 2) return false;
  if (/^[A-Za-z0-9+/=\s]+$/.test(text) && !/[\u4e00-\u9fff]/.test(text)) return false;
  return /[\u4e00-\u9fff]/.test(text) || /<\/?(?:p|div|br|h[1-6]|section|article)\b/i.test(text) || /[\u3002，。！？：；、“”‘’《》]/.test(text);
}

function tryDecodeShushanContent(value: string) {
  const raw = String(value || "").trim();
  if (!raw || !/^[A-Za-z0-9+/]*={0,2}$/.test(raw) || raw.length % 4 !== 0) return raw;
  let encrypted: Buffer;
  try { encrypted = Buffer.from(raw, "base64"); } catch { return raw; }
  if (!encrypted.length || encrypted.length % 16 !== 0) return raw;

  const keyText = "G@tY3$jK7#mL2&pW8!";
  const ivText = "C!eH4&sM6@wP9^zX1?";
  const md5 = (text: string) => crypto.createHash("md5").update(text, "utf8").digest();
  const sha256 = (text: string) => crypto.createHash("sha256").update(text, "utf8").digest();
  const candidates: Array<{ key: Buffer; iv: Buffer }> = [
    { key: Buffer.from(keyText, "utf8").subarray(0, 16), iv: Buffer.from(ivText, "utf8").subarray(0, 16) },
    { key: Buffer.from(keyText, "utf8").subarray(-16), iv: Buffer.from(ivText, "utf8").subarray(-16) },
    { key: md5(keyText), iv: md5(ivText) },
    { key: md5(keyText), iv: Buffer.from(ivText, "utf8").subarray(0, 16) },
    { key: sha256(keyText).subarray(0, 16), iv: sha256(ivText).subarray(0, 16) },
  ];
  for (const candidate of candidates) {
    try {
      const decipher = crypto.createDecipheriv("aes-128-cbc", candidate.key, candidate.iv);
      const decoded = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8").trim();
      if (looksLikeReadableNovelText(decoded)) return decoded;
    } catch { /* try next compatibility key derivation */ }
  }
  return raw;
}

function extractCatalogChapters(value: any): any[] {
  const output: any[] = [];
  const seen = new Set<string>();
  const visit = (node: any, depth = 0) => {
    if (depth > 8 || node == null) return;
    if (Array.isArray(node)) { node.forEach(item => visit(item, depth + 1)); return; }
    if (typeof node !== "object") return;
    const title = node.title ?? node.chapter_title ?? node.chapterName ?? node.name ?? node.chapter_name;
    const cid = node.cid ?? node.chapter_id ?? node.chapterId ?? node.id;
    const url = node.url ?? node.chapter_url ?? node.chapterUrl ?? "";
    const isChapterLike = title != null && (cid != null || url);
    if (isChapterLike) {
      const key = `${String(cid ?? "")}|${String(url)}|${String(title)}`;
      if (!seen.has(key)) { seen.add(key); output.push(node); }
    }
    Object.values(node).forEach(child => visit(child, depth + 1));
  };
  visit(value);
  return output;
}

function extractModuleBooks(value: any): any[] {
  const output: any[] = [];
  const seen = new Set<string>();
  const visit = (node: any, depth = 0) => {
    if (depth > 10 || node == null) return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item, depth + 1);
      return;
    }
    if (typeof node !== "object") return;
    const title = node.title ?? node.book_name ?? node.bookName ?? node.book_title ?? node.novel_name ?? node.original_book_name ?? node.name;
    const bookId = node.book_id_str ?? node.book_id ?? node.bookId ?? node.series_id ?? node.item_id ?? "";
    const bookUrl = node.book_url ?? node.bookUrl ?? node.detail_url ?? node.detailUrl ?? node.url ?? "";
    const isBook = title && (bookUrl || bookId || node.author || node.author_name || node.cover || node.cover_url || node.thumb_url || node.thumbUri || node.audio_thumb_uri);
    if (isBook) {
      const key = `${String(title)}|${String(bookId)}|${String(bookUrl)}|${String(node.source || node.source_name || "")}`;
      if (!seen.has(key)) {
        seen.add(key);
        output.push({ ...node, book_id_str: node.book_id_str ?? bookId, book_url: node.book_url ?? bookUrl });
      }
    }
    for (const child of Object.values(node)) visit(child, depth + 1);
  };
  visit(value);
  return output.slice(0, 100);
}

function normalizeModuleData(value: any): any {
  let root = value;
  for (let i = 0; i < 4 && typeof root === "string"; i += 1) {
    try { root = JSON.parse(root); } catch { break; }
  }
  const books = extractModuleBooks(root);
  if (books.length) return books;
  return root;
}

function extractSearchBooks(value: any): any[] {
  const output: any[] = [];
  const seen = new Set<string>();
  const visit = (node: any, depth = 0) => {
    if (depth > 7 || node == null) return;
    if (Array.isArray(node)) { node.forEach(item => visit(item, depth + 1)); return; }
    if (typeof node !== "object") return;
    const title = node.title ?? node.book_name ?? node.bookName ?? node.name ?? node.novel_name;
    const bookUrl = node.book_url ?? node.bookUrl ?? node.url ?? node.detail_url ?? node.bookUrl;
    if (title && bookUrl) {
      const key = `${String(title)}|${String(bookUrl)}|${String(node.source || "")}`;
      if (!seen.has(key)) { seen.add(key); output.push(node); }
    }
    Object.values(node).forEach(child => visit(child, depth + 1));
  };
  visit(value);
  return output;
}

function upstreamError(host: string, path: string, status: number, parsed: any, text: string) {
  const message = String(parsed?.message || parsed?.error || `书山接口返回 HTTP ${status}`);
  return new Error(`${message} [${host}${path}]${text && !parsed ? ` ${text.slice(0, 180)}` : ""}`);
}

async function tryHosts<T>(hosts: string[], fn: (host: string) => Promise<T>) {
  let lastError: unknown = null;
  for (const host of hosts) {
    try {
      return await fn(host);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("书山服务器均不可用");
}

export async function POST(request: NextRequest) {
  try {
    const input = jsonObject(await request.json());
    const action = String(input.action || "").trim();
    if (!action) return NextResponse.json({ ok: false, error: "缺少 action" }, { status: 400 });
    const hosts = chooseHosts(input.hosts);

    if (action === "login") {
      const email = String(input.email || "").trim();
      const password = String(input.password || "");
      if (!email || !password) return NextResponse.json({ ok: false, error: "请输入账号和密码" }, { status: 400 });
      const result = await tryHosts(hosts, async (host) => {
        const body = new URLSearchParams({ email, password }).toString();
        const response = await fetch(new URL("/login", host), {
          method: "POST",
          headers: {
            "Accept": "application/json,text/plain,*/*;q=0.8",
            "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
            "User-Agent": DEFAULT_UA,
          },
          body,
          redirect: "follow",
          cache: "no-store",
        });
        const text = await response.text();
        let parsed: any = null;
        try { parsed = JSON.parse(text); } catch {}
        if (!response.ok) throw upstreamError(host, "/login", response.status, parsed, text);
        const apiKey = extractApiKey(parsed);
        if (!apiKey) {
          const message = String(parsed?.message || "登录接口未返回 api_key");
          throw new Error(`${message} [${host}/login]`);
        }
        return {
          ok: true as const,
          apiKey,
          user: parsed?.data?.user ? {
            nickname: parsed.data.user.nickname,
            is_member: parsed.data.user.is_member,
          } : undefined,
          device: parsed?.data?.device,
          host,
        };
      });
      return NextResponse.json(result);
    }

    const apiKey = String(input.apiKey || "").trim();
    if (!apiKey) return NextResponse.json({ ok: false, error: "缺少书山 apiKey，请重新登录" }, { status: 401 });

    if (action === "user") {
      const host = String(input.host || hosts[0]).trim();
      const timestamp = Math.floor(Date.now() / 1000);
      const encodedKey = Buffer.from(apiKey, "utf8").toString("base64");
      return NextResponse.json(await tryHosts([host, ...hosts], async (currentHost) => {
        const result = await fetchUpstream(currentHost, "/login", {
          method: "POST",
          body: JSON.stringify({ key: encodedKey, timestamp }),
        });
        if (!result.response.ok) throw upstreamError(currentHost, "/login", result.response.status, result.parsed, result.text);
        return { ok: true as const, data: result.parsed?.data ?? result.parsed, host: currentHost };
      }));
    }

    if (action === "search") {
      const keyword = String(input.keyword || "").trim();
      const page = Math.max(1, Number(input.page) || 1);
      const source = String(input.source || "").trim();
      if (!keyword) return NextResponse.json({ ok: false, error: "请输入书名" }, { status: 400 });
      return NextResponse.json(await tryHosts(hosts, async (host) => {
        const query = new URLSearchParams({ login: "search", key: keyword, page: String(page) });
        if (source) query.set("source", source);
        const result = await fetchUpstream(host, `/search?${query.toString()}`, { apiKey });
        if (!result.response.ok) throw upstreamError(host, "/search", result.response.status, result.parsed, result.text);
        const data = extractSearchBooks(result.parsed?.data ?? result.parsed);
        return { ok: true as const, data, host };
      }));
    }

    if (action === "module") {
      const moduleUrl = String(input.moduleUrl || "").trim();
      if (!moduleUrl) return NextResponse.json({ ok: false, error: "缺少榜单地址" }, { status: 400 });
      let parsedUrl: URL;
      try { parsedUrl = new URL(moduleUrl); } catch { return NextResponse.json({ ok: false, error: "榜单地址无效" }, { status: 400 }); }
      if (!/vossc\.com$/i.test(parsedUrl.hostname)) return NextResponse.json({ ok: false, error: "该地址不是书山榜单地址" }, { status: 400 });
      const preferredHost = String(input.host || "").trim();
      const path = `${parsedUrl.pathname}${parsedUrl.search}`;
      return NextResponse.json(await tryHosts(chooseHosts([preferredHost, parsedUrl.origin]), async (host) => {
        const result = await fetchUpstream(host, path, { apiKey });
        if (!result.response.ok) throw upstreamError(host, path, result.response.status, result.parsed, result.text);
        // 原书山书源的 java.ajax() 返回的是字符串，原规则会再 JSON.parse(result)。
        // 这里也兼容“JSON 套 JSON”，否则发现页拿到字符串后前端无法提取书籍。
        let data: any = result.parsed;
        if (typeof data === "string") {
          try { data = JSON.parse(data); } catch {}
        }
        if (typeof data === "string") {
          try { data = JSON.parse(data); } catch {}
        }
        if (data == null) {
          try { data = JSON.parse(result.text); } catch { data = result.text; }
        }
        // 书山原书源在这里会执行 normalizeResponse(result)，统一成书籍数组。
        // 浏览器端不执行原书源 JS，所以服务端先做同等归一化；这样 style_top / type_style
        // 即使返回多层 data、book_info、cell_view.book_data 或 JSON 套 JSON，也能直接展示。
        data = normalizeModuleData(data);
        return { ok: true as const, data, host };
      }));
    }

    if (action === "bookInfo") {
      const bookId = String(input.bookId || "").trim();
      if (!bookId || !/^\d+$/.test(bookId)) return NextResponse.json({ ok: false, error: "缺少有效 book_id" }, { status: 400 });
      return NextResponse.json(await tryHosts(hosts, async (host) => {
        const path = `/detail?book_id=${encodeURIComponent(bookId)}`;
        const result = await fetchUpstream(host, path, { apiKey });
        if (!result.response.ok) throw upstreamError(host, path, result.response.status, result.parsed, result.text);
        const data = result.parsed?.data ?? result.parsed;
        if (!data || (typeof data !== "object" && !Array.isArray(data))) throw new Error(`书山书籍详情返回无效数据 [${host}${path}]`);
        return { ok: true as const, data, host };
      }));
    }

    if (action === "details") {
      const detail = jsonObject(input.detail);
      return NextResponse.json(await tryHosts(hosts, async (host) => {
        const result = await fetchUpstream(host, "/details", { method: "POST", body: detail, apiKey });
        if (!result.response.ok) throw upstreamError(host, "/details", result.response.status, result.parsed, result.text);
        const data = result.parsed?.data ?? result.parsed;
        if (!data || typeof data !== "object") throw new Error(`书山详情返回无效数据 [${host}/details]`);
        return { ok: true as const, data, host };
      }));
    }

    if (action === "catalog") {
      const catalog = jsonObject(input.catalog);
      return NextResponse.json(await tryHosts(hosts, async (host) => {
        const result = await fetchUpstream(host, "/catalog", { method: "POST", body: catalog, apiKey });
        if (!result.response.ok) throw upstreamError(host, "/catalog", result.response.status, result.parsed, result.text);
        // 不同书山节点/版本的 /catalog 返回结构并不完全一致。
        // 优先保留服务端明确返回的 data 数组：即使某些节点的章节字段命名很特殊，
        // 也不能因为本地提取器不认识字段就把整本书错误地变成“0 章”。
        let rawData: any = result.parsed?.data ?? result.parsed;
        for (let i = 0; i < 3 && typeof rawData === "string"; i += 1) {
          try { rawData = JSON.parse(rawData); } catch { break; }
        }
        const directList = Array.isArray(rawData)
          ? rawData
          : Array.isArray(rawData?.chapters) ? rawData.chapters
          : Array.isArray(rawData?.chapter_list) ? rawData.chapter_list
          : Array.isArray(rawData?.chapterList) ? rawData.chapterList
          : Array.isArray(rawData?.list) ? rawData.list
          : Array.isArray(rawData?.catalog) ? rawData.catalog
          : null;
        const data = directList && directList.length
          ? directList.map((item: any, index: number) => ({
              ...(item && typeof item === "object" ? item : {}),
              title: String(item?.title ?? item?.chapter_title ?? item?.chapterName ?? item?.chapter_name ?? item?.name ?? `第${index + 1}章`),
              isVolume: item?.isVolume === true || item?.is_volume === true,
            }))
          : extractCatalogChapters(rawData);
        return { ok: true as const, data, host };
      }));
    }

    if (action === "content") {
      const chapter = jsonObject(input.chapter);
      const deviceId = String(input.deviceId || "").trim();
      if (!deviceId) return NextResponse.json({ ok: false, error: "缺少设备标识" }, { status: 400 });
      return NextResponse.json(await tryHosts(hosts, async (host) => {
        const result = await fetchUpstream(host, "/content", {
          method: "POST",
          body: chapter,
          apiKey,
          deviceId,
        });
        if (!result.response.ok) throw upstreamError(host, "/content", result.response.status, result.parsed, result.text);
        let content = String(result.parsed?.data?.content ?? result.parsed?.content ?? "");
        // 书山原生规则会在客户端检测并解码 base64 正文。这里在服务端完成，
        // 避免阅读器把整段 base64 当成正文，也与原书源行为保持一致。
        if (/^[A-Za-z0-9+/]*={0,2}$/.test(content) && content.length >= 16 && content.length % 4 === 0) {
          try {
            const decoded = Buffer.from(content, "base64").toString("utf8");
            if (decoded && /[\u4e00-\u9fffA-Za-z0-9]/.test(decoded)) content = decoded;
          } catch {}
        }
        if (!content && result.parsed?.data && typeof result.parsed.data === "object" && "content" in result.parsed.data) {
          throw new Error(`书山正文为空 [${host}/content]`);
        }
        return {
          ok: true as const,
          content,
          tab: result.parsed?.data?.tab ?? result.parsed?.tab,
          notice: result.parsed?.data?.notice ?? result.parsed?.notice,
          sayBody: result.parsed?.data?.sayBody ?? result.parsed?.sayBody,
          host,
        };
      }));
    }

    return NextResponse.json({ ok: false, error: `不支持的 action：${action}` }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "书山接口请求失败";
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
