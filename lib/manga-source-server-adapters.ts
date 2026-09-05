import crypto from "node:crypto";

export type MangaServerAction = "search" | "detail" | "catalog" | "content" | "module";
export type MangaServerAdapter = { id: string; label: string; handle: (action: MangaServerAction, body: any) => Promise<unknown> };

type Rule = Record<string, any>;

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36";

function esc(v: unknown) { return String(v ?? "").replace(/[&<>\"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]!)); }
function decodeHtml(v: string) { return v.replace(/&amp;/g,"&").replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,"<").replace(/&gt;/g,">"); }
function abs(base: string, value: string) { try { return new URL(decodeHtml(value), base).toString(); } catch { return value; } }
function stripTags(v: string) { return decodeHtml(v.replace(/<[^>]+>/g, " ")).replace(/\s+/g," ").trim(); }
function attr(html: string, name: string) { const m = html.match(new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, "i")); return m ? decodeHtml(m[1]) : ""; }
function textOf(html: string) { return stripTags(html); }

function parseRequestRule(rawUrl: unknown, base: string, vars: Record<string,string>) {
  let s = String(rawUrl ?? "").trim().replace(/\{\{(key|keyword)\}\}/g, () => vars.key);
  const comma = s.indexOf(",{\"");
  if (comma < 0) return { url: abs(base, s), method: "GET", headers: {} as Record<string,string>, body: undefined as string|undefined };
  const url = abs(base, s.slice(0, comma));
  let options: any = {};
  try { options = JSON.parse(s.slice(comma + 1)); } catch { /* fall back to GET */ }
  let body = typeof options.body === "string" ? options.body.replace(/\{\{(key|keyword)\}\}/g, () => vars.key) : undefined;
  return { url, method: String(options.method || "GET").toUpperCase(), headers: options.headers || {}, body };
}

function findBlocks(html: string, selector: string): string[] {
  const s = String(selector || "").trim();
  if (!s) return [html];
  // 支持常用 CSS：#id、.class、tag、tag.class，以及空格后代选择器。
  const parts = s.split(/\s+/).filter(Boolean);
  let current = [html];
  for (const part of parts) {
    const next: string[] = [];
    const token = part.match(/^([a-z0-9_-]+)?(?:#([a-z0-9_-]+))?(?:\.([a-z0-9_-]+))?$/i);
    if (!token) continue;
    const tag = token[1] || "[a-z][a-z0-9:-]*";
    const id = token[2] ? `(?=[^>]*\\bid=["']${token[2]}["'])` : "";
    const cls = token[3] ? `(?=[^>]*\\bclass=["'][^"']*\\b${token[3]}\\b[^"']*["'])` : "";
    const re = new RegExp(`<${tag}\\b${id}${cls}[^>]*>[\\s\\S]*?<\\/${tag}>`, "gi");
    for (const block of current) { let m: RegExpExecArray|null; while ((m = re.exec(block))) next.push(m[0]); }
    current = next;
  }
  return current;
}

function firstValue(block: string, rule: unknown, base: string) {
  const r = String(rule ?? "").trim();
  if (!r) return "";
  const [selectorPart, transform] = r.split("##", 2);
  const [selector, attribute] = selectorPart.split("@", 2);
  const nodes = findBlocks(block, selector.trim());
  const node = nodes[0] || "";
  if (!node) return "";
  let value = attribute ? (attribute.toLowerCase() === "text" ? textOf(node) : attr(node, attribute)) : textOf(node);
  if (transform) { try { value = value.replace(new RegExp(transform.replace(/\\,/g,","), "g"), "").trim(); } catch {} }
  return value ? abs(base, value) : "";
}

function parseList(html: string, listSelector: string, rules: Rule, base: string) {
  const blocks = findBlocks(html, listSelector);
  return blocks.map((block) => ({
    title: firstValue(block, rules.name || rules.title, base) || "未命名",
    author: firstValue(block, rules.author, base) || undefined,
    cover: firstValue(block, rules.coverUrl || rules.cover, base) || undefined,
    desc: firstValue(block, rules.intro || rules.desc, base) || undefined,
    latestChapterTitle: firstValue(block, rules.lastChapter || rules.latestChapterTitle, base) || undefined,
    bookUrl: firstValue(block, rules.bookUrl || rules.url || rules.detailUrl, base),
    raw: block,
  })).filter((x) => x.bookUrl || x.title !== "未命名");
}

async function request(url: string, options: { method?: string; headers?: Record<string,string>; body?: string } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const headers = { "User-Agent": UA, Accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8", ...(options.headers || {}) };
    const response = await fetch(url, { method: options.method || "GET", headers, body: options.body, redirect: "follow", signal: controller.signal });
    return { response, text: await response.text(), url: response.url };
  } finally { clearTimeout(timer); }
}

function sourceConfig(body: any): Rule {
  const raw = body?.sourceRaw || {};
  const sourceUrl = String(body.sourceUrl || "");

  // 如果是楠楠漫画，直接使用预设规则（忽略 raw.mangaAdapter）
  if (sourceUrl.includes("nnmh.me") || sourceUrl.includes("nnmh.info")) {
    const preset = {
      search: {
        url: "/index.php?m=&c=mh&a=load_searchpage,{\"method\":\"POST\",\"body\":\"page={{page}}&key={{key}}&paixu=&status=0&limitStatus=0\",\"headers\":{\"X-Requested-With\":\"XMLHttpRequest\"}}",
        listSelector: "$.info[*]",
        fields: {
          title: "$.title",
          bookUrl: "/home/book/index/id/{{id}}/",
          cover: "$.cover_pic"
        }
      },
      catalog: {
        listSelector: "#html_box .item",
        fields: {
          chapterName: "a@text",
          chapterUrl: "a@href"
        }
      },
      content: {
        encryptedDataSelector: "var encryptedData = \"([^\"]+)\"",
        algorithm: "AES-CBC",
        key: "tH1rU6qZ4vU1sK7pN1wO7mX4bY6dQ9gX",
        ivMode: "prefix",
        imagePath: "$",
        referer: "https://nnmh.me/"
      }
    };
    return { raw, cfg: preset };
  }

  // 其他书源仍从 raw.mangaAdapter 读取
  const cfg = raw?.mangaAdapter || raw?.manga || {};
  return { raw, cfg };
}

async function search(body: any) {
  const { raw, cfg } = sourceConfig(body);
  const vars = { key: String(body.keyword || ""), keyword: String(body.keyword || "") };
  const rule = cfg.search || {};
  const requestRule = rule.url || raw.searchUrl;
  if (!requestRule) throw new Error("漫画源没有配置搜索地址");
  const req = parseRequestRule(requestRule, String(body.sourceUrl), vars);
  const result = await request(req.url, { method: rule.method || req.method || "POST", headers: req.headers, body: rule.body?.replace(/\{\{(key|keyword)\}\}/g, () => vars.key) || req.body });
  if (!result.response.ok) throw new Error(`搜索 HTTP ${result.response.status}`);
  const rules = rule.fields || raw.ruleSearch || {};
  const listSelector = rule.listSelector || cfg.searchListSelector || ".itemnar";
  return parseList(result.text, listSelector, rules, result.url);
}

async function detail(body: any) {
  const { raw, cfg } = sourceConfig(body);
  const result = await request(abs(String(body.sourceUrl), String(body.bookUrl || "")), { headers: cfg.headers });
  if (!result.response.ok) throw new Error(`详情 HTTP ${result.response.status}`);
  const rules = cfg.detail?.fields || raw.ruleBookInfo || {};
  const title = firstValue(result.text, rules.name || rules.title, result.url) || body.title || "未命名";
  const author = firstValue(result.text, rules.author, result.url) || body.author;
  const desc = firstValue(result.text, rules.intro || rules.desc, result.url) || body.desc;
  const cover = firstValue(result.text, rules.coverUrl || rules.cover, result.url) || body.cover;
  return { ...body, title, author, desc, intro: desc, cover, tocUrl: body.bookUrl, raw: result.text };
}

async function catalog(body: any) {
  const { raw, cfg } = sourceConfig(body);
  const result = await request(abs(String(body.sourceUrl), String(body.bookUrl || "")), { headers: cfg.headers });
  if (!result.response.ok) throw new Error(`目录 HTTP ${result.response.status}`);
  const rule = cfg.catalog || {};
  const selector = rule.listSelector || "#html_box .item";
  const blocks = findBlocks(result.text, selector);
  const fields = rule.fields || raw.ruleToc || {};
  return blocks.map((block, i) => {
    const hrefRule = fields.chapterUrl || fields.url || "a@href";
    const titleRule = fields.chapterName || fields.name || fields.title || "@text";
    const url = firstValue(block, hrefRule, result.url) || abs(result.url, attr(block,"href"));
    const title = firstValue(block, titleRule, result.url) || textOf(block);
    return { title: title || `第${i+1}章`, url, raw: block };
  }).filter((x) => !!x.url);
}

function extractEncrypted(html: string, cfg: Rule) {
  const selector = String(cfg.encryptedDataSelector || "").trim();
  if (selector) {
    const nodes = findBlocks(html, selector);
    const n = nodes[0] || "";
    const v = attr(n, "value") || attr(n, "data-value") || textOf(n);
    if (v) return v;
  }
  const patterns = [
    /(?:window\.)?encryptedData\s*=\s*["']([^"']+)["']/i,
    /["']encryptedData["']\s*:\s*["']([^"']+)["']/i,
    /encryptedData\s*[:=]\s*`([\s\S]*?)`/i,
  ];
  for (const re of patterns) { const m = html.match(re); if (m?.[1]) return m[1]; }
  throw new Error("章节页面没有找到 encryptedData");
}

function decodeBase64(value: string) {
  const normalized = value.trim().replace(/\\/g,"").replace(/-/g,"+").replace(/_/g,"/");
  return Buffer.from(normalized, "base64");
}

function decryptEncryptedData(encoded: string, cfg: Rule): unknown {
  const keyText = String(cfg.key || cfg.aesKey || "");
  if (!keyText) throw new Error("encryptedData 需要配置 AES key");
  const algorithm = String(cfg.algorithm || "AES-CBC").toUpperCase();
  if (algorithm !== "AES-CBC") throw new Error(`暂不支持 ${algorithm}`);
  const data = decodeBase64(encoded);
  const ivMode = String(cfg.ivMode || "prefix").toLowerCase();
  const iv = cfg.iv ? decodeBase64(String(cfg.iv)) : (ivMode === "prefix" ? data.subarray(0,16) : Buffer.alloc(16));
  const ciphertext = ivMode === "prefix" && !cfg.iv ? data.subarray(16) : data;
  const key = Buffer.from(keyText, String(cfg.keyEncoding || "utf8"));
  const cipherName = key.length === 16 ? "aes-128-cbc" : key.length === 24 ? "aes-192-cbc" : key.length === 32 ? "aes-256-cbc" : "";
  if (!cipherName) throw new Error("AES key 长度必须为 16/24/32 字节");
  const decipher = crypto.createDecipheriv(cipherName, key, iv);
  decipher.setAutoPadding(true); // PKCS7
  const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  try { return JSON.parse(plain); } catch { return plain; }
}

function collectUrls(value: unknown, base: string, path?: string): string[] {
  let target: any = value;
  if (path) for (const part of path.split(".").filter(Boolean)) target = target?.[part];
  const out: string[] = [];
  const walk = (v: any) => {
    if (typeof v === "string") { const u = abs(base, v.trim()); if (/^https?:\/\//i.test(u) && /\.(?:jpe?g|png|webp|gif|avif)(?:[?#]|$)/i.test(u)) out.push(u); }
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(target);
  return [...new Set(out)];
}

async function content(body: any) {
  const { raw, cfg } = sourceConfig(body);
  const contentCfg = cfg.content || {};
  const chapterUrl = abs(String(body.sourceUrl), String(body.chapterUrl || ""));
  const result = await request(chapterUrl, { headers: contentCfg.headers || cfg.headers });
  if (!result.response.ok) throw new Error(`正文 HTTP ${result.response.status}`);

  const encoded = extractEncrypted(result.text, contentCfg);
  const decoded = decryptEncryptedData(encoded, contentCfg);
  const urls = collectUrls(decoded, result.url, contentCfg.imagePath || contentCfg.urlPath);
  if (!urls.length) throw new Error("encryptedData 解密成功，但没有找到图片 URL");
  const referer = contentCfg.referer === false ? "" : (contentCfg.referer || result.url);
  const proxy = urls.map((u) => `/api/reading/manga?image=${encodeURIComponent(u)}&referer=${encodeURIComponent(referer)}`);
  return { content: proxy.map((u) => `[[MANGA_IMAGE]]${u}`).join("\n"), baseUrl: result.url };
}

async function module(body: any) {
  const result = await request(abs(String(body.sourceUrl), String(body.moduleUrl || "")));
  if (!result.response.ok) throw new Error(`分类 HTTP ${result.response.status}`);
  const { cfg } = sourceConfig(body);
  const rule = cfg.module || {};
  return parseList(result.text, rule.listSelector || ".likedata", rule.fields || {}, result.url);
}

const GENERIC_MANGA_ADAPTER: MangaServerAdapter = {
  id: "generic-manga",
  label: "通用漫画源",
  async handle(action, body) {
    if (action === "search") return search(body);
    if (action === "detail") return detail(body);
    if (action === "catalog") return catalog(body);
    if (action === "content") return content(body);
    if (action === "module") return module(body);
    throw new Error(`不支持的漫画源操作：${action}`);
  },
};

export function getMangaServerAdapter(adapterId: string) { return adapterId === GENERIC_MANGA_ADAPTER.id ? GENERIC_MANGA_ADAPTER : null; }
export function listMangaServerAdapters() { return [{ id: GENERIC_MANGA_ADAPTER.id, label: GENERIC_MANGA_ADAPTER.label }]; }

export async function fetchMangaImage(url: string, referer?: string) {
  const target = new URL(url);
  if (!/^https?:$/.test(target.protocol)) throw new Error("只允许 HTTP/HTTPS 图片");
  const result = await request(target.toString(), { headers: referer ? { Referer: referer } : {} });
  if (!result.response.ok) throw new Error(`图片 HTTP ${result.response.status}`);
  return result;
}
