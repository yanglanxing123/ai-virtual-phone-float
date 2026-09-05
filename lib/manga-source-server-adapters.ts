function extractScriptImageUrls(html: string, base: string) {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (value: unknown) => {
    if (typeof value !== "string") return;
    const v = decodeHtml(value).trim();
    if (!v || /^(?:javascript:|data:|#)/i.test(v)) return;
    const u = abs(base, v);
    if (!/^https?:\/\//i.test(u) || seen.has(u)) return;
    // 漫画正文图片通常有图片扩展名；同时允许无扩展名 CDN 地址。
    if (/\.(?:jpe?g|png|webp|gif|avif)(?:[?#]|$)/i.test(u) || /(?:image|comic|chapter|upload|uploads|pic|img)/i.test(u)) {
      seen.add(u);
      out.push(u);
    }
  };

  const scripts = html.match(/<script\b[^>]*>[\s\S]*?<\/script>/gi) || [];
  for (const script of scripts) {
    const code = script.replace(/^<script\b[^>]*>/i, "").replace(/<\/script>$/i, "");

    // 常见的读漫屋数据变量：chapter_images / images / image_list 等。
    const names = ["chapter_images", "chapterImages", "images", "image_list", "imageList", "pics", "picList"];
    for (const name of names) {
      const re = new RegExp(`(?:["']?${name}["']?\\s*[:=]\\s*)(\\[[\\s\\S]*?\\])`, "i");
      const m = code.match(re);
      if (!m) continue;
      const raw = m[1].trim();
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) parsed.forEach(add);
      } catch {
        // JS 数组可能使用单引号；逐项提取 URL，避免引入 JS 执行器。
        const itemRe = /["']((?:https?:)?\/\/[^"']+|\/[^"']+(?:jpe?g|png|webp|gif|avif)(?:[?#][^"']*)?)["']/gi;
        let item: RegExpExecArray | null;
        while ((item = itemRe.exec(raw))) add(item[1]);
      }
    }

    // 另一类模板把图片放在 JSON 字符串里，例如 {"src":"..."}。
    const srcRe = /["'](?:src|url|image|imageUrl|path)["']\s*:\s*["']([^"']+)["']/gi;
    let srcMatch: RegExpExecArray | null;
    while ((srcMatch = srcRe.exec(code))) add(srcMatch[1]);
  }
  return out;
}

function imageTags(urls: string[]) {
  return urls.map((url) => `<img src="${url.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}" />`).join("\n");
}

function parseChapters(html: string, base: string) {
  // 读漫屋当前模板是 <ul><a><li>章节名</li></a></ul>，但部分页面/版本会变成
  // <ul><li><a>章节名</a></li></ul>。不要把 li 固定在 a 内部。
  const list = extractElementInnerHtml(html, ["chapterlistload", "chapter-list", "chapterlist"]);
  const source = list || html;
  const output: any[] = [];
  const seen = new Set<string>();
  const re = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    const href = decodeHtml(m[1]).trim();
    const url = abs(base, href);
    const title = stripTags(m[2]);
    if (!title || !url || seen.has(url)) continue;
    if (/^(?:返回|收藏|开始阅读|下载APP|APP观看|大人，更多话点这里)$/i.test(title)) continue;
    if (/^(?:javascript:|#)/i.test(href)) continue;
    seen.add(url);
    output.push({ title, url, raw: { url, title } });
  }

  // 某些新版详情页不会把章节列表包在 chapterlistload 中，
  // 直接从同一漫画 ID 下的 .html 链接兜底。
  if (!output.length) {
    const id = (() => {
      try { return new URL(base).pathname.replace(/^\//, "").split("/")[0]; } catch { return ""; }
    })();
    const fallback = /<a\b[^>]*href=["']([^"']+\.html(?:[?#][^"']*)?)["'][^>]*>([\s\S]*?)<\/a>/gi;
    while ((m = fallback.exec(html))) {
      const href = decodeHtml(m[1]).trim();
      if (id && !new RegExp(`(?:^|/)${id}(?:/|$)`, "i").test(href)) continue;
      const url = abs(base, href);
      const title = stripTags(m[2]);
      if (!title || !url || seen.has(url)) continue;
      seen.add(url);
      output.push({ title, url, raw: { url, title } });
    }
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
    const parsed = new URL(bookUrl, host);
    const target = new URL(parsed.pathname + parsed.search, host).toString();
    const result = await request(host, new URL(target).pathname + new URL(target).search);
    if (!result.response.ok) throw new Error(`详情 HTTP ${result.response.status}`);
    return parseDetail(result.text, result.url);
  });
}

async function catalog(sourceUrl: unknown, bookUrl: string) {
  return tryHosts(sourceUrl, async (host) => {
    const parsed = new URL(bookUrl, host);
    const target = new URL(parsed.pathname + parsed.search, host).toString();
    const result = await request(host, new URL(target).pathname + new URL(target).search);
    if (!result.response.ok) throw new Error(`目录 HTTP ${result.response.status}`);
    const chapters = parseChapters(result.text, result.url);
    // 读漫屋的“更多章节”按钮本质上就是 /morechapter POST；即使按钮样式/隐藏状态变化，
    // 也直接请求一次并与页面已有章节去重，确保详情页能拿到完整目录。
    const more = await fetchMoreChapters(host, result.url).catch(() => []);
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
    // chapterUrl 可能来自旧书源缓存，带着已经失效的旧域名。只保留 pathname/search，
    // 让当前可用站点 host 真正参与轮换，否则 tryHosts 会对同一个旧域名重复请求。
    const parsedChapter = new URL(chapterUrl, host);
    const target = new URL(parsedChapter.pathname + parsedChapter.search, host).toString();
    const result = await request(host, new URL(target).pathname + new URL(target).search);
    if (!result.response.ok) throw new Error(`正文 HTTP ${result.response.status}`);

    // 读漫屋的章节页有一类非常关键的结构：外层章节 URL 本身不放漫画图片，
    // 而是通过 iframe 再加载真正的阅读页；.main_img img 位于 iframe 文档里。
    // 只抓外层 HTML 会得到“正文为空”，这正是之前适配失败的原因。
    const directHtml = extractElementInnerHtml(result.text, [
      "main_img",
      "readerContainer",
      "comic_warp",
      "comic-content",
      "chapter-content",
      "read-content",
    ]);
    if (directHtml) return { content: directHtml, baseUrl: result.url };

    const iframeSrcs: string[] = [];
    const iframeRe = /<iframe\b[^>]*(?:src|data-src)\s*=\s*["']([^"']+)["'][^>]*>/gi;
    let iframeMatch: RegExpExecArray | null;
    while ((iframeMatch = iframeRe.exec(result.text))) {
      const src = decodeHtml(iframeMatch[1]).trim();
      if (!src || /^(?:javascript:|#)/i.test(src)) continue;
      const absolute = abs(result.url, src);
      if (absolute && !iframeSrcs.includes(absolute)) iframeSrcs.push(absolute);
    }

    for (const iframeUrl of iframeSrcs) {
      try {
        const frame = await request(new URL(iframeUrl).origin, new URL(iframeUrl).pathname + new URL(iframeUrl).search);
        if (!frame.response.ok) continue;
        const frameHtml = extractElementInnerHtml(frame.text, [
          "main_img",
          "readerContainer",
          "comic_warp",
          "comic-content",
          "chapter-content",
          "read-content",
        ]);
        if (frameHtml) return { content: frameHtml, baseUrl: frame.url };

        const frameScriptImages = extractScriptImageUrls(frame.text, frame.url);
        if (frameScriptImages.length) return { content: frameScriptImages.join("\n"), baseUrl: frame.url };

        const frameImages = frame.text.match(/<img\b[^>]*(?:data-src|data-original|src)\s*=\s*["'][^"']+["'][^>]*>/gi) || [];
        if (frameImages.length >= 1) return { content: frameImages.join("\n"), baseUrl: frame.url };
      } catch {
        // 某个 iframe 失败时继续尝试下一个。
      }
    }

    // 个别轮换模板会把正文图片直接输出在外层页面，但没有固定容器。
    // 只有检测到至少两张图片才启用外层兜底，避免把详情页的单张封面误当正文。
    const scriptImages = extractScriptImageUrls(result.text, result.url);
    if (scriptImages.length) return { content: scriptImages.join("\n"), baseUrl: result.url };

    const images = result.text.match(/<img\b[^>]*(?:data-src|data-original|src)\s*=\s*["'][^"']+["'][^>]*>/gi) || [];
    if (images.length >= 2) return { content: images.join("\n"), baseUrl: result.url };

    throw new Error("正文页面没有找到漫画图片（已检查 .main_img、iframe 和章节图片脚本）");
  });
}



export type MangaServerAction = "search" | "detail" | "catalog" | "content" | "module";

export type MangaServerAdapter = {
  id: string;
  label: string;
  handle: (action: MangaServerAction, body: any) => Promise<unknown>;
};

const DUMANWU_ADAPTER: MangaServerAdapter = {
  id: "dumanwu",
  label: "读漫屋",
  async handle(action, body) {
    const sourceUrl = body?.sourceUrl;
    if (action === "search") return search(sourceUrl, String(body?.keyword || "").trim());
    if (action === "module") return module(sourceUrl, String(body?.moduleUrl || ""));
    if (action === "detail") return detail(sourceUrl, String(body?.bookUrl || ""));
    if (action === "catalog") return catalog(sourceUrl, String(body?.bookUrl || ""));
    if (action === "content") return content(sourceUrl, String(body?.chapterUrl || ""));
    throw new Error(`不支持的漫画源操作：${action}`);
  },
};

const MANGA_SERVER_ADAPTERS: MangaServerAdapter[] = [DUMANWU_ADAPTER];

export function getMangaServerAdapter(adapterId: string) {
  return MANGA_SERVER_ADAPTERS.find((item) => item.id === adapterId) || null;
}

export function listMangaServerAdapters() {
  return MANGA_SERVER_ADAPTERS.map(({ id, label }) => ({ id, label }));
}
