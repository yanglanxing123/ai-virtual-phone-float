import { NextRequest, NextResponse } from "next/server";
import dns from "node:dns/promises";
import net from "node:net";

export const runtime = "nodejs";

const DEFAULT_HOSTS = [
  "https://www.dumanwu1.com",
  "https://dumanwu1.com",
  "https://www.dumanwu.com",
  "https://dumanwu.com",
];

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36";

function private4(ip: string) {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = p;
  return a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

function private6(ip: string) {
  const v = ip.toLowerCase();
  return v === "::1" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80:") || v.startsWith("::ffff:127.");
}

async function assertSafe(urlText: string) {
  const url = new URL(urlText);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("仅支持 HTTP/HTTPS");
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) throw new Error("禁止访问本地域名");
  if (net.isIP(host) === 4 && private4(host)) throw new Error("禁止访问内网地址");
  if (net.isIP(host) === 6 && private6(host)) throw new Error("禁止访问内网地址");
  if (!net.isIP(host)) {
    const records = await dns.lookup(host, { all: true });
    if (!records.length || records.some((r) => r.family === 4 ? private4(r.address) : private6(r.address))) throw new Error("目标域名解析到内网或保留地址");
  }
}

function uniqueHosts(sourceUrl?: unknown) {
  const custom = String(sourceUrl || "").trim();
  const values = custom ? [custom, ...DEFAULT_HOSTS] : DEFAULT_HOSTS;
  const result: string[] = [];
  for (const value of values) {
    try {
      const u = new URL(value);
      const origin = u.origin.replace(/\/$/, "");
      if (!["http:", "https:"].includes(u.protocol)) continue;
      if (!result.includes(origin)) result.push(origin);
    } catch {}
  }
  return result;
}

async function request(host: string, path: string, init: RequestInit = {}) {
  const url = new URL(path, host).toString();
  await assertSafe(url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 18000);
  try {
    const headers = new Headers(init.headers);
    headers.set("User-Agent", UA);
    headers.set("Accept-Language", "zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7");
    headers.set("Referer", `${host}/`);
    const response = await fetch(url, { ...init, headers, redirect: "follow", cache: "no-store", signal: controller.signal });
    const text = await response.text();
    return { response, text, url: response.url || url };
  } finally {
    clearTimeout(timer);
  }
}

async function tryHosts<T>(sourceUrl: unknown, fn: (host: string) => Promise<T>) {
  let last: unknown = null;
  for (const host of uniqueHosts(sourceUrl)) {
    try { return await fn(host); } catch (error) { last = error; }
  }
  throw last instanceof Error ? last : new Error("读漫屋所有站点均请求失败");
}

function decodeHtml(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function stripTags(value: string) {
  return decodeHtml(value.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function attr(tag: string, name: string) {
  const re = new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, "i");
  return decodeHtml(tag.match(re)?.[1] || "").trim();
}

function abs(base: string, value: string) {
  if (!value) return "";
  try { return new URL(value, base).toString(); } catch { return value; }
}

function blocks(html: string, className: string) {
  const re = new RegExp(`<[^>]*class=["'][^"']*\\b${className}\\b[^"']*["'][^>]*>[\\s\\S]*?(?=<[^>]*class=["'][^"']*\\b${className}\\b|$)`, "gi");
  return html.match(re) || [];
}

function parseSearch(html: string, base: string) {
  const output: any[] = [];
  for (const block of blocks(html, "itemnar")) {
    const img = block.match(/<img\b[^>]*>/i)?.[0] || "";
    const link = block.match(/<a\b[^>]*href=["']([^"']+)["'][^>]*>/i)?.[1] || "";
    const span = block.match(/<img\b[^>]*>\s*<span\b[^>]*>([\s\S]*?)<\/span>/i)?.[1] || "";
    const title = attr(img, "alt") || stripTags(block).slice(0, 80);
    if (!title || !link) continue;
    output.push({
      title,
      author: "",
      cover: abs(base, attr(img, "data-src") || attr(img, "src")),
      latestChapterTitle: stripTags(span),
      bookUrl: abs(base, link),
      raw: { title, cover: attr(img, "data-src") || attr(img, "src"), url: link },
    });
  }
  return output;
}

// /sort/* 使用 ruleExplore：.likedata + img@data-src + img@alt + p(最新)。
function parseExplore(html: string, base: string) {
  const output: any[] = [];
  const seen = new Set<string>();
  for (const block of blocks(html, "likedata")) {
    const img = block.match(/<img\b[^>]*>/i)?.[0] || "";
    const link = block.match(/<a\b[^>]*href=["']([^"']+)["'][^>]*>/i)?.[1] || "";
    const title = attr(img, "alt") || attr(img, "title") || stripTags(block).slice(0, 80);
    if (!title || !link) continue;
    const bookUrl = abs(base, link);
    if (!bookUrl || seen.has(bookUrl)) continue;
    seen.add(bookUrl);
    const authorMatch = block.match(/<p\b[^>]*>\s*作者\s*[：:]?\s*([\s\S]*?)<\/p>/i);
    const latestMatch = block.match(/<p\b[^>]*>\s*最新\s*[：:]?\s*([\s\S]*?)<\/p>/i);
    const introMatch = block.match(/<[^>]*class=["'][^"']*\\ble-j\\b[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/i);
    output.push({
      title,
      author: stripTags(authorMatch?.[1] || "") || undefined,
      cover: abs(base, attr(img, "data-src") || attr(img, "src")) || undefined,
      latestChapterTitle: stripTags(latestMatch?.[1] || "") || undefined,
      desc: stripTags(introMatch?.[1] || "") || undefined,
      bookUrl,
      raw: { title, url: link },
    });
  }
  return output;
}

function parseDetail(html: string, url: string) {
  const himg = blocks(html, "himg")[0] || html;
  const img = himg.match(/<img\b[^>]*>/i)?.[0] || "";
  const title = attr(img, "title") || attr(img, "alt") || stripTags(himg).slice(0, 80);
  const authorMatch = html.match(/<span\b[^>]*>\s*作者\s*[：:]?\s*<\/span>[\s\S]{0,300}?<span\b[^>]*>([\s\S]*?)<\/span>/i);
  const author = stripTags(authorMatch?.[1] || "");
  const introBlock = html.match(/<[^>]*class=["'][^"']*\bdetinfo\b[^"']*["'][^>]*>[\s\S]*?<[^>]*class=["'][^"']*\bcontent\b[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/i)?.[1] || "";
  const description = stripTags(introBlock);
  return {
    title: title || "未命名",
    author: author || undefined,
    cover: abs(url, attr(img, "data-src") || attr(img, "src")) || undefined,
    desc: description || undefined,
    intro: description || undefined,
    bookUrl: url,
    tocUrl: url,
    raw: { html },
  };
}

function parseChapters(html: string, base: string) {
  const list = html.match(/<[^>]*class=["'][^"']*\bchapterlistload\b[^"']*["'][^>]*>[\s\S]*?<\/[^>]+>/i)?.[0] || html;
  const output: any[] = [];
  const seen = new Set<string>();
  const re = /<a\b[^>]*href=["']([^"']+)["'][^>]*>[\s\S]*?<li\b[^>]*>([\s\S]*?)<\/li>[\s\S]*?<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(list))) {
    const url = abs(base, m[1]);
    const title = stripTags(m[2]);
    if (!title || !url || seen.has(url)) continue;
    seen.add(url);
    output.push({ title, url, raw: { url, title } });
  }
  return output;
}

async function fetchMoreChapters(host: string, detailUrl: string) {
  const pathname = new URL(detailUrl).pathname.replace(/^\//, "");
  const id = pathname.split("/")[0];
  if (!id) return [];
  const body = new URLSearchParams({ id }).toString();
  const result = await request(host, "/morechapter", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
    body,
  });
  if (!result.response.ok) return [];
  let data: any = null;
  try { data = JSON.parse(result.text); } catch { return []; }
  if (!Array.isArray(data?.data)) return [];
  return data.data.map((item: any) => ({
    title: String(item?.chaptername || "未命名章节"),
    url: abs(result.url, `/${id}/${item?.chapterid}.html`),
    raw: item,
  })).filter((item: any) => /https?:/.test(item.url));
}

async function search(sourceUrl: unknown, keyword: string) {
  return tryHosts(sourceUrl, async (host) => {
    const body = new URLSearchParams({ k: keyword }).toString();
    const result = await request(host, "/s", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
      body,
    });
    if (!result.response.ok) throw new Error(`搜索 HTTP ${result.response.status}`);
    const items = parseSearch(result.text, result.url);
    if (!items.length) throw new Error("搜索成功但没有解析到漫画");
    return items;
  });
}

async function module(sourceUrl: unknown, moduleUrl: string) {
  return tryHosts(sourceUrl, async (host) => {
    const target = new URL(moduleUrl, host).toString();
    const result = await request(host, new URL(target).pathname + new URL(target).search);
    if (!result.response.ok) throw new Error(`分类页面 HTTP ${result.response.status}`);
    const items = parseExplore(result.text, result.url);
    if (!items.length) throw new Error("分类页面请求成功但没有解析到漫画");
    return items;
  });
}

async function detail(sourceUrl: unknown, bookUrl: string) {
  return tryHosts(sourceUrl, async (host) => {
    const target = new URL(bookUrl, host).toString();
    const result = await request(host, new URL(target).pathname + new URL(target).search);
    if (!result.response.ok) throw new Error(`详情 HTTP ${result.response.status}`);
    return parseDetail(result.text, result.url);
  });
}

async function catalog(sourceUrl: unknown, bookUrl: string) {
  return tryHosts(sourceUrl, async (host) => {
    const target = new URL(bookUrl, host).toString();
    const result = await request(host, new URL(target).pathname + new URL(target).search);
    if (!result.response.ok) throw new Error(`目录 HTTP ${result.response.status}`);
    const chapters = parseChapters(result.text, result.url);
    const more = /class=["'][^"']*\bchaplist-more\b/i.test(result.text)
      ? await fetchMoreChapters(host, result.url).catch(() => [])
      : [];
    const seen = new Set<string>();
    return [...chapters, ...more].filter((item: any) => {
      if (!item.url || seen.has(item.url)) return false;
      seen.add(item.url);
      return true;
    });
  });
}

async function content(sourceUrl: unknown, chapterUrl: string) {
  return tryHosts(sourceUrl, async (host) => {
    const target = new URL(chapterUrl, host).toString();
    const result = await request(host, new URL(target).pathname + new URL(target).search);
    if (!result.response.ok) throw new Error(`正文 HTTP ${result.response.status}`);

    // 使用平衡标签扫描而不是简单的正则，避免 .main_img 内部嵌套 div 时被提前截断。
    const open = result.text.match(/<([a-z0-9]+)\b[^>]*class=["'][^"']*\bmain_img\b[^"']*["'][^>]*>/i);
    if (!open) throw new Error("正文页面没有找到 .main_img");
    const tag = open[1];
    const start = (open.index ?? 0) + open[0].length;
    const token = new RegExp(`<\\/?${tag}\\b[^>]*>`, "gi");
    token.lastIndex = start;
    let depth = 1;
    let cursor = start;
    let match: RegExpExecArray | null;
    while ((match = token.exec(result.text))) {
      if (/^<\//.test(match[0])) {
        depth -= 1;
        if (depth === 0) {
          cursor = match.index;
          break;
        }
      } else if (!/\/\s*>$/.test(match[0])) {
        depth += 1;
      }
    }
    const html = result.text.slice(start, cursor || result.text.length).trim();
    if (!html) throw new Error(".main_img 中没有正文图片");
    return { content: html, baseUrl: result.url };
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const action = String(body?.action || "").trim();
    const sourceUrl = body?.sourceUrl;
    if (!action) return NextResponse.json({ ok: false, error: "缺少 action" }, { status: 400 });

    if (action === "search") return NextResponse.json({ ok: true, data: await search(sourceUrl, String(body?.keyword || "").trim()) });
    if (action === "module") return NextResponse.json({ ok: true, data: await module(sourceUrl, String(body?.moduleUrl || "")) });
    if (action === "detail") return NextResponse.json({ ok: true, data: await detail(sourceUrl, String(body?.bookUrl || "")) });
    if (action === "catalog") return NextResponse.json({ ok: true, data: await catalog(sourceUrl, String(body?.bookUrl || "")) });
    if (action === "content") return NextResponse.json({ ok: true, data: await content(sourceUrl, String(body?.chapterUrl || "")) });

    return NextResponse.json({ ok: false, error: `不支持的读漫屋操作：${action}` }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "读漫屋请求失败" }, { status: 502 });
  }
}
