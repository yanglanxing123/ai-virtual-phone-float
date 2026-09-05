import { loadReadingSourceState, saveReadingSourceState, type ReadingBookSource } from "./reading-source";
import { createDeviceId, getShushanChapterContent, getShushanCatalog, getShushanDetail, loadShushanAccount, type ShushanChapter, type ShushanDetail, type ShushanSearchBook } from "./shushan-client";
import { getMangaSourceAdapter } from "./manga-source-adapters";

export type GenericSourceBook = {
  title: string;
  author?: string;
  cover?: string;
  desc?: string;
  latestChapterTitle?: string;
  wordCount?: string | number;
  tags?: string;
  source?: string;
  bookId?: string;
  bookUrl: string;
  raw?: unknown;
};

export type GenericSourceChapter = {
  title: string;
  url: string;
  isPay?: boolean;
  isVip?: boolean;
  raw?: unknown;
};

export type GenericSourceDetail = GenericSourceBook & {
  tocUrl?: string;
  intro?: string;
  raw?: unknown;
};

type Json = Record<string, unknown> | unknown[];
type ProxyPayload = { ok: true; url: string; contentType: string; text: string };

function asText(value: unknown) {
  return value == null ? "" : String(value);
}

function unwrapJs(rule: unknown) {
  const value = asText(rule).trim();
  if (!value) return "";
  if (/^<js>|^@js:/i.test(value)) return "";
  return value;
}

function containsJs(rule: unknown) {
  return /<js>|@js:/i.test(asText(rule));
}

function safeTemplateValue(expression: string, vars: Record<string, string>) {
  const expr = expression.trim();
  if (Object.prototype.hasOwnProperty.call(vars, expr)) return vars[expr];
  if (/^[A-Za-z_$][\w$]*$/.test(expr) && vars[expr] !== undefined) return vars[expr];

  // Safe arithmetic subset used by many Legado URLs, e.g. {{(page-1)*100}}.
  if (/^[0-9A-Za-z_$+\-*/%().\s]+$/.test(expr)) {
    const identifiers = expr.match(/[A-Za-z_$][\w$]*/g) || [];
    if (identifiers.every((id) => Object.prototype.hasOwnProperty.call(vars, id) && /^-?\d+(?:\.\d+)?$/.test(String(vars[id])))) {
      try {
        const substituted = expr.replace(/[A-Za-z_$][\w$]*/g, (id) => String(vars[id]));
        if (/^[0-9+\-*/%().\s]+$/.test(substituted)) {
          // No property access, calls, strings, or other JS syntax can reach this evaluator.
          const result = Function(`"use strict"; return (${substituted})`)();
          if (typeof result === "number" && Number.isFinite(result)) return String(result);
        }
      } catch {}
    }
  }
  return "";
}

function replaceVars(input: string, vars: Record<string, string>) {
  return input.replace(/\{\{([^}]+)\}\}/g, (_, expression: string) => {
    const value = safeTemplateValue(expression, vars);
    return encodeURIComponent(value ?? "");
  });
}

function isJson(value: unknown): value is Json {
  return !!value && typeof value === "object";
}

function jsonPath(root: unknown, path: string): unknown {
  let clean = path.trim().replace(/^json:/i, "");
  if (clean === "$" || clean === "$." || clean === "") return root;
  clean = clean.replace(/^\$\.?/, "");
  const parts = clean.match(/[^.[\]]+|\[(\d+)\]/g) || [];
  let cur: any = root;
  for (const raw of parts) {
    const key = raw.startsWith("[") ? Number(raw.slice(1, -1)) : raw;
    if (cur == null) return undefined;
    cur = cur[key as any];
  }
  return cur;
}

function normalizeRule(rule: unknown) {
  const clean = unwrapJs(rule);
  if (!clean) return [];
  // Legado commonly uses && as a fallback chain. Use the first working rule.
  return clean.split(/\s*&&\s*/).map((x) => x.trim()).filter(Boolean);
}

function decodeEntities(value: string) {
  if (!value) return "";
  const textarea = typeof document !== "undefined" ? document.createElement("textarea") : null;
  if (!textarea) return value;
  textarea.innerHTML = value;
  return textarea.value;
}

function textOf(el: Element) {
  return (el.textContent || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function cssValue(root: ParentNode, rule: string): unknown {
  for (const candidate of normalizeRule(rule)) {
    const parts = candidate.split("@");
    const selector = parts.shift()?.trim() || "";
    const attr = parts.join("@").trim() || "text";
    if (!selector) continue;
    try {
      const node = root.querySelector(selector);
      if (!node) continue;
      if (attr === "text" || attr === "textNodes") return textOf(node);
      if (attr === "html") return node.innerHTML;
      if (attr === "outerHtml" || attr === "outerHTML") return node.outerHTML;
      if (attr === "href" || attr === "src" || attr === "data-src") return node.getAttribute(attr) || "";
      return node.getAttribute(attr) || textOf(node);
    } catch {
      continue;
    }
  }
  return undefined;
}

function firstValue(root: unknown, rule: unknown): unknown {
  const rules = normalizeRule(rule);
  if (!rules.length) return undefined;
  for (const clean of rules) {
    if (isJson(root) && (/^\$/.test(clean) || /^json:/i.test(clean))) {
      const value = jsonPath(root, clean);
      if (value !== undefined && value !== null && !(typeof value === "string" && !value.trim())) return value;
      continue;
    }
    if ((typeof Document !== "undefined" && root instanceof Document) || (typeof Element !== "undefined" && root instanceof Element)) {
      if (/^xpath:/i.test(clean) || /^\//.test(clean)) {
        const value = xpathValue(root as Document | Element, clean);
        if (value !== undefined && value !== "") return value;
      }
      const value = cssValue(root, clean);
      if (value !== undefined && value !== "") return value;
      continue;
    }
  }
  return undefined;
}

function manyValues(root: unknown, rule: unknown): unknown[] {
  const rules = normalizeRule(rule);
  if (!rules.length) return [];
  for (const clean of rules) {
    if (isJson(root) && (/^\$/.test(clean) || /^json:/i.test(clean))) {
      const value = jsonPath(root, clean);
      if (Array.isArray(value)) return value;
      if (value != null) return [value];
    }
    if ((typeof Document !== "undefined" && root instanceof Document) || (typeof Element !== "undefined" && root instanceof Element)) {
      if (/^xpath:/i.test(clean) || /^\//.test(clean)) {
        const values = xpathValue(root as Document | Element, clean, true);
        if (Array.isArray(values) && values.length) return values;
      }
      try {
        const values = Array.from((root as ParentNode).querySelectorAll(clean));
        if (values.length) return values;
      } catch { /* try next */ }
    }
  }
  return [];
}

function xpathValue(root: Document | Element, rule: string, many = false): unknown {
  if (typeof document === "undefined" || typeof document.evaluate !== "function") return undefined;
  const clean = rule.trim().replace(/^xpath:/i, "");
  try {
    const result = document.evaluate(
      clean,
      root,
      null,
      many ? XPathResult.ORDERED_NODE_SNAPSHOT_TYPE : XPathResult.FIRST_ORDERED_NODE_TYPE,
      null,
    );
    if (many) {
      const values: unknown[] = [];
      for (let i = 0; i < result.snapshotLength; i++) values.push(result.snapshotItem(i));
      return values;
    }
    const node = result.singleNodeValue;
    if (!node) return undefined;
    if (node.nodeType === Node.ATTRIBUTE_NODE) return node.nodeValue || "";
    return node.textContent || "";
  } catch {
    return undefined;
  }
}

function scalar(root: unknown, rule: unknown) {
  const ruleText = asText(rule).trim();
  if (ruleText && /\{\{[^}]+\}\}/.test(ruleText)) {
    const replaced = ruleText.replace(/\{\{([^}]+)\}\}/g, (_, expression: string) => {
      const value = jsonPath(root, expression.trim());
      return encodeURIComponent(value == null ? "" : asText(value));
    });
    return decodeEntities(decodeURIComponent(replaced)).trim();
  }
  const value = firstValue(root, rule);
  if (Array.isArray(value)) return value[0] == null ? "" : asText(value[0]);
  return decodeEntities(asText(value)).trim();
}

function joinUrl(base: string, value: string) {
  const clean = value.trim();
  if (!clean) return "";
  try { return new URL(clean, base).toString(); } catch { return clean; }
}

function parseHeaderRule(source: ReadingBookSource, vars: Record<string, string> = {}): Record<string, string> {
  const raw = source.raw as any;
  const value = raw?.header;
  if (!value) return {};
  if (typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, replaceVars(String(v ?? ""), vars)]));
  if (typeof value !== "string") return {};
  const staticJs = parseStaticJsObject(value);
  if (staticJs) return Object.fromEntries(Object.entries(staticJs).map(([k, v]) => [k, replaceVars(v, vars)]));
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === "object") return Object.fromEntries(Object.entries(parsed).map(([k, v]) => [k, replaceVars(String(v ?? ""), vars)]));
  } catch {}
  return {};
}

function parseRequestUrl(rawUrl: string, base: string) {
  // Supports the common Legado `url,{"method":"POST","body":...}` form.
  const comma = rawUrl.indexOf(",{\"");
  if (comma < 0) return { url: joinUrl(base, rawUrl), options: {} as any };
  const urlPart = rawUrl.slice(0, comma).trim();
  const jsonPart = rawUrl.slice(comma + 1).trim();
  try { return { url: joinUrl(base, urlPart), options: JSON.parse(jsonPart) as any }; } catch { return { url: joinUrl(base, urlPart), options: {} as any }; }
}

async function fetchSource(request: {
  source?: ReadingBookSource;
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
}): Promise<ProxyPayload & { setCookie?: string }> {
  const sourceState = request.source ? loadReadingSourceState(request.source.id) : {};
  const headers = { ...(request.headers || {}) };
  if (sourceState.cookies && !Object.keys(headers).some((k) => k.toLowerCase() === "cookie")) {
    headers.Cookie = sourceState.cookies;
  }
  const response = await fetch("/api/reading/source", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...request, headers }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.ok) throw new Error(data?.error || `请求失败（${response.status}）`);
  if (request.source && data.setCookie) {
    saveReadingSourceState(request.source.id, { ...sourceState, cookies: mergeCookies(sourceState.cookies, data.setCookie) });
  }
  return data as ProxyPayload & { setCookie?: string };
}

export async function fetchReadingSourceModule(source: ReadingBookSource, moduleUrl: string, page = 1): Promise<unknown> {
  // 读漫屋的分类页（/sort/1 等）依赖 ruleExplore，直接交给专用 route，
  // 这样分类页和搜索/详情/正文使用同一套站点切换与请求头兼容逻辑。
  const mangaAdapter = getMangaSourceAdapter(source);
  if (mangaAdapter) {
    return mangaAdapter.request("module", { moduleUrl, page }) as Promise<GenericSourceBook[]>;
  }

  // 楠楠漫画的 exploreUrl 本身就是标准 Legado「发现页模块」数组，
  // 每个模块只是一个带 POST 参数的请求地址；直接复用漫画源自己的 ruleExplore。
  if (isNanmComicSource(source)) {
    return fetchNanmExploreModule(source, moduleUrl, page);
  }

  const state = loadReadingSourceState(source.id);
  const vars = { ...(state.variables || {}), key: "", page: String(page), pageIndex: String(page), keyword: "" };
  const templated = replaceVars(moduleUrl, vars);
  const request = parseRequestUrl(templated, source.url);
  if (!/^https?:/i.test(request.url)) throw new Error("首页模块地址不是有效的 HTTP/HTTPS 地址");

  // 书山发现页的 style_top / type_style 并不是普通“书源 HTTP 模块”。
  // 原书源是在 Legado 的 Java.ajax 环境里请求，并依赖书山自己的服务器轮换；
  // 浏览器直接走通用代理容易遇到 404/CORS/服务器节点差异，因此交给专用适配器。
  if (isShushanSource(source) && /vossc\.com\/style_top|vossc\.com\/type_style/i.test(request.url)) {
    const account = requireShushanAccount();
    const response = await fetch("/api/reading/shushan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "module",
        apiKey: account.apiKey,
        moduleUrl: request.url,
        host: state.variables?.host || source.url,
      }),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.ok) throw new Error(data?.error || `首页榜单请求失败（${response.status}）`);
    let moduleData: any = data.data ?? data.result ?? data;
    // 兼容服务端/上游返回 JSON 字符串的情况。
    for (let i = 0; i < 2 && typeof moduleData === "string"; i += 1) {
      try { moduleData = JSON.parse(moduleData); } catch { break; }
    }
    return moduleData;
  }

  const options = request.options || {};
  const payload = await fetchSource({
    source,
    url: request.url,
    method: options.method || "GET",
    headers: { ...parseHeaderRule(source, vars), ...(options.headers || {}) },
    body: typeof options.body === "string" ? replaceVars(options.body, vars) : options.body,
  });
  return parsePayload(payload.text, payload.contentType);
}

function mergeCookies(existing: string | undefined, setCookie: string | undefined) {
  const map = new Map<string, string>();
  for (const item of (existing || "").split(/;\s*/).filter(Boolean)) {
    const eq = item.indexOf("="); if (eq > 0) map.set(item.slice(0, eq).trim(), item.slice(eq + 1).trim());
  }
  for (const item of (setCookie || "").split(/,(?=[^;,=]+=[^;,]+)/g).filter(Boolean)) {
    const pair = item.split(";")[0]?.trim() || "";
    const eq = pair.indexOf("="); if (eq > 0) map.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
  return [...map.entries()].map(([k,v]) => `${k}=${v}`).join("; ");
}

function parsePayload(text: string, contentType: string): unknown {
  const trimmed = text.trim();
  const looksJson = /json/i.test(contentType) || /^[\[{]/.test(trimmed);
  if (looksJson) {
    try { return JSON.parse(trimmed); } catch { /* HTML/text fallback */ }
  }
  return typeof DOMParser !== "undefined"
    ? new DOMParser().parseFromString(text, "text/html")
    : text;
}

function requireSimpleRule(rule: unknown, label: string) {
  if (containsJs(rule)) throw new Error(`${label}使用了无法安全转换的 JS/Java 规则`);
}

function decodeBase64Utf8(value: string) {
  try {
    if (typeof atob !== "function") return undefined;
    const binary = atob(value);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch { return undefined; }
}

function encodeBase64Utf8(value: string) {
  try {
    if (typeof btoa !== "function") return undefined;
    const bytes = new TextEncoder().encode(value);
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  } catch { return undefined; }
}

function parseQuoted(value: string) {
  const quote = value.trim()[0];
  if (!quote || !["'", '"', "`"].includes(quote) || value.trim().at(-1) !== quote) return undefined;
  const body = value.trim().slice(1, -1);
  try { return JSON.parse(JSON.stringify(body)).replace(/\\([\\'"`])/g, "$1"); } catch { return body; }
}

function applySafeJsExpression(value: unknown, expression: string, source?: ReadingBookSource): unknown {
  const expr = expression.trim();
  if (expr === "result") return value;
  if (expr === "result.trim()") return asText(value).trim();
  if (expr === "JSON.parse(result)") {
    try { return JSON.parse(asText(value)); } catch { return undefined; }
  }
  if (expr === "JSON.stringify(result)") {
    try { return JSON.stringify(value); } catch { return undefined; }
  }
  const jsonChain = expr.match(/^JSON\.parse\(result\)(?:\.([A-Za-z_$][\w$]*)|\[([0-9]+)\])$/);
  if (jsonChain) {
    try {
      const parsed = JSON.parse(asText(value));
      return jsonChain[1] ? parsed?.[jsonChain[1]] : parsed?.[Number(jsonChain[2])];
    } catch { return undefined; }
  }
  const base64DecodeMatch = expr.match(/^(?:java\.)?base64Decode\(result\)$/);
  if (base64DecodeMatch) return decodeBase64Utf8(asText(value));
  const base64EncodeMatch = expr.match(/^(?:java\.)?base64Encode\(result\)$/);
  if (base64EncodeMatch) return encodeBase64Utf8(asText(value));
  if (/^(?:java\.)?base64DecodeToString\(result\)$/.test(expr)) return decodeBase64Utf8(asText(value));
  if (/^(?:java\.)?hexDecodeToString\(result\)$/.test(expr)) {
    try {
      const hex = asText(value).replace(/\s+/g, "");
      if (!/^(?:[0-9a-fA-F]{2})+$/.test(hex)) return undefined;
      const bytes = new Uint8Array(hex.match(/../g)!.map((part) => parseInt(part, 16)));
      return new TextDecoder().decode(bytes);
    } catch { return undefined; }
  }
  const decodeUri = expr.match(/^decodeURIComponent\(result\)$/);
  if (decodeUri) { try { return decodeURIComponent(asText(value)); } catch { return undefined; } }
  const encodeUri = expr.match(/^encodeURIComponent\(result\)$/);
  if (encodeUri) { try { return encodeURIComponent(asText(value)); } catch { return undefined; } }
  const javaEncodeUri = expr.match(/^java\.encodeURIComponent\(result\)$/);
  if (javaEncodeUri) { try { return encodeURIComponent(asText(value)); } catch { return undefined; } }
  const javaDecodeUri = expr.match(/^java\.decodeURIComponent\(result\)$/);
  if (javaDecodeUri) { try { return decodeURIComponent(asText(value)); } catch { return undefined; } }

  const variable = expr.match(/^source\.getVariable\(([^)]+)\)$/);
  if (variable && source) {
    const key = parseQuoted(variable[1]);
    if (key !== undefined) return loadReadingSourceState(source.id).variables?.[key] ?? "";
  }
  const javaVariable = expr.match(/^java\.getVariable\(([^)]+)\)$/);
  if (javaVariable && source) {
    const key = parseQuoted(javaVariable[1]);
    if (key !== undefined) return loadReadingSourceState(source.id).variables?.[key] ?? "";
  }

  // These APIs are side-effect-only in the supported compatibility subset.
  if (/^(?:java\.)?toast\((?:["\'`]).*(?:["\'`])\)$/.test(expr)) return value;

  const prop = expr.match(/^result(?:\.([A-Za-z_$][\w$]*|data|content|text)|\[['"]([^'\"]+)['"]\])$/);
  if (prop) {
    const key = prop[1] || prop[2];
    if (value == null || (typeof value !== "object" && typeof value !== "function")) return undefined;
    return (value as any)[key];
  }
  const index = expr.match(/^result\[(\d+)\]$/);
  if (index && (Array.isArray(value) || typeof value === "string")) return (value as any)[Number(index[1])];

  const matchGroup = expr.match(/^result\.match\(\/((?:\\.|[^/])*)\/([gimsuy]*)\)\[(\d+)\]$/);
  if (matchGroup) {
    try {
      const found = asText(value).match(new RegExp(matchGroup[1], matchGroup[2]));
      return found?.[Number(matchGroup[3])];
    } catch { return undefined; }
  }

  const slice = expr.match(/^result\.(substring|slice)\(\s*(-?\d+)\s*(?:,\s*(-?\d+)\s*)?\)$/);
  if (slice) {
    const input = asText(value);
    const a = Number(slice[2]);
    const b = slice[3] === undefined ? undefined : Number(slice[3]);
    return slice[1] === "substring" ? input.substring(Math.max(0, a), b) : input.slice(a, b);
  }

  const splitJoin = expr.match(/^result\.split\((.*)\)\.join\((.*)\)$/);
  if (splitJoin) {
    const sep = parseQuoted(splitJoin[1]);
    const joiner = parseQuoted(splitJoin[2]);
    if (sep !== undefined && joiner !== undefined) return asText(value).split(sep).join(joiner);
  }

  return undefined;
}



type JavaAjaxRequest = {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
};

function sourceServerHost(source?: ReadingBookSource) {
  try { return source ? new URL(source.url).origin : ""; } catch { return source?.url || ""; }
}

function parseSimpleObjectLiteral(text: string, result: unknown, source?: ReadingBookSource): Record<string, unknown> | undefined {
  const body = text.trim().replace(/^\{/, "").replace(/\}$/, "");
  if (!body.trim()) return {};
  const out: Record<string, unknown> = {};
  const parts = body.match(/(?:[^,'"]|"(?:\\.|[^"])*"|'(?:\\.|[^'])*')+/g) || [];
  const joined = parts.join(",");
  const pairs = [...joined.matchAll(/([A-Za-z_$][\w$-]*)\s*:\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|true|false|null|result)$/g)];
  if (!pairs.length) return undefined;
  for (const pair of pairs) {
    const key = pair[1];
    const value = pair[2];
    if (value === "result") out[key] = result;
    else if (value === "true" || value === "false") out[key] = value === "true";
    else if (value === "null") out[key] = null;
    else out[key] = parseQuoted(value) ?? value;
  }
  return Object.keys(out).length ? out : undefined;
}

function decodeAjaxUrlExpression(expression: string, result: unknown, source?: ReadingBookSource): string | undefined {
  let value = expression.trim().replace(/[;]+$/, "");
  const host = sourceServerHost(source);
  value = value.replace(/getServerHost\(\)/g, JSON.stringify(host));
  value = value.replace(/\b(?:String\()?result(?:\))?/g, JSON.stringify(asText(result)));
  value = value.replace(/\bsource\.getVariable\(([^)]+)\)/g, (_, key) => JSON.stringify(source ? (loadReadingSourceState(source.id).variables?.[parseQuoted(key) || ""] || "") : ""));
  const templateMatch = value.match(/^`([\s\S]*)`$/);
  if (templateMatch) {
    let out = templateMatch[1];
    out = out.replace(/\$\{([^}]+)\}/g, (_, inner) => {
      const trimmed = inner.trim();
      if (trimmed === "result") return asText(result);
      if (/^JSON\.stringify\(result\)$/.test(trimmed)) return JSON.stringify(result);
      const parsed = applySafeJsExpression(result, trimmed, source);
      return parsed === undefined ? "" : asText(parsed);
    });
    return out;
  }
  const quoted = parseQuoted(value);
  if (quoted !== undefined) return quoted;
  if (!/^\s*["']/.test(expression)) {
    try {
      // Restricted URL expression: concatenation of quoted fragments and already-replaced literals.
      if (/^[\s"'+.:/?&=_\-A-Za-z0-9%{}()]+$/.test(value)) {
        const pieces = value.split(/\s*\+\s*/).map((part) => parseQuoted(part) ?? part.trim().replace(/^"|"$/g, ""));
        if (pieces.length) return pieces.join("");
      }
    } catch {}
  }
  return undefined;
}

function findBalancedCallArgument(text: string, start: number) {
  let depth = 0;
  let quote = "";
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (escape) { escape = false; continue; }
      if (ch === "\\") { escape = true; continue; }
      if (ch === quote) quote = "";
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") { quote = ch; continue; }
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) return text.slice(start + 1, i).trim();
    }
  }
  return undefined;
}

function extractJavaAjaxRequest(body: string, result: unknown, source?: ReadingBookSource): JavaAjaxRequest | undefined {
  const normalized = body.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const marker = /java\.ajax\s*\(/i.exec(normalized);
  if (!marker || marker.index == null) return undefined;
  const arg = findBalancedCallArgument(normalized, marker.index + marker[0].length - 1);
  if (!arg) return undefined;

  const splitTopLevel = (value: string) => {
    let depth = 0;
    let quote = "";
    let escape = false;
    for (let i = 0; i < value.length; i++) {
      const ch = value[i];
      if (quote) {
        if (escape) { escape = false; continue; }
        if (ch === "\\") { escape = true; continue; }
        if (ch === quote) quote = "";
        continue;
      }
      if (ch === '"' || ch === "'" || ch === "`") { quote = ch; continue; }
      if (ch === "(" || ch === "[" || ch === "{") depth++;
      else if (ch === ")" || ch === "]" || ch === "}") depth--;
      else if (ch === "," && depth === 0) return [value.slice(0, i), value.slice(i + 1)];
    }
    return [value, ""];
  };

  const [urlExpr, optionText] = splitTopLevel(arg).map((x) => x.trim());
  const url = decodeAjaxUrlExpression(urlExpr, result, source);
  if (!url) return undefined;
  const req: JavaAjaxRequest = { url };

  if (optionText) {
    const objectMatch = optionText.match(/JSON\.stringify\s*\(\s*(\{[\s\S]*\})\s*\)$/i) || optionText.match(/^(\{[\s\S]*\})$/);
    if (objectMatch) {
      const object = objectMatch[1];
      const method = object.match(/(?:^|,)\s*method\s*:\s*["']([^"']+)["']/i);
      if (method) req.method = method[1].toUpperCase();
      const bodyMatch = object.match(/(?:^|,)\s*body\s*:\s*(result|\{[\s\S]*\})/i);
      if (bodyMatch) req.body = bodyMatch[1] === "result" ? result : parseSimpleObjectLiteral(bodyMatch[1], result, source);
      const headersMatch = object.match(/headers\s*:\s*(\{[\s\S]*?\})/i);
      if (headersMatch) req.headers = Object.fromEntries(Object.entries(parseSimpleObjectLiteral(headersMatch[1], result, source) || {}).map(([k,v]) => [k, asText(v)]));
    }
  }
  return req;
}

function runJavaAjaxBridge(input: string, rule: unknown, source?: ReadingBookSource): Promise<string | undefined> {
  const js = asText(rule).trim();
  if (!/^<js>|^@js:/i.test(js) || !/java\.ajax\b/i.test(js)) return Promise.resolve(undefined);
  const body = js.replace(/^<js>/i, "").replace(/<\/js>$/i, "").replace(/^@js:/i, "").trim();
  let seed: unknown = input;
  const decoded = applySafeJsExpression(seed, body.match(/JSON\.parse\(java\.hexDecodeToString\(result\)\)/i) ? "java.hexDecodeToString(result)" : "result", source);
  if (decoded !== undefined && /JSON\.parse\(java\.hexDecodeToString\(result\)\)/i.test(body)) {
    try { seed = JSON.parse(asText(decoded)); } catch { seed = decoded; }
  }
  const assignments = [...body.matchAll(/(?:let|const|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(["'`][\s\S]*?["'`]|getServerHost\(\)\s*\+\s*["'`][\s\S]*?["'`])/g)];
  for (const match of assignments) {
    const name = match[1];
    const expr = match[2];
    const value = decodeAjaxUrlExpression(expr, seed, source);
    if (value && new RegExp(String.raw`java\.ajax\s*\(\s*${name}\s*\)`, "i").test(body)) {
      return fetchSource({ source, url: value, headers: { ...parseHeaderRule(source), }, }).then((payload) => payload.text);
    }
  }
  const request = extractJavaAjaxRequest(body, seed, source);
  if (!request?.url) return Promise.resolve(undefined);
  return fetchSource({ source, url: request.url, method: request.method, headers: { ...parseHeaderRule(source), ...(request.headers || {}) }, body: request.body })
    .then((payload) => payload.text);
}

function safeJsTransform(input: string, rule: unknown, source?: ReadingBookSource): string | undefined {
  const js = asText(rule).trim();
  if (!/^<js>|^@js:/i.test(js)) return undefined;
  const body = js.replace(/^<js>/i, "").replace(/<\/js>$/i, "").replace(/^@js:/i, "").trim();
  if (!body) return undefined;

  let result: unknown = input;
  let matched = false;

  // Support a deliberately small, non-evaluating subset of common Legado transforms.
  const statements = body
    .replace(/\/\/.*$/gm, "")
    .split(/[;\n]+/)
    .map((x) => x.trim())
    .filter(Boolean);

  for (const statement of statements) {
    const direct = statement.match(/^(?:result\s*=\s*)?(.+)$/);
    if (!direct) continue;
    let expr = direct[1].trim();
    if (/^result\s*=/.test(statement)) expr = statement.replace(/^result\s*=\s*/, "").trim();
    const next = applySafeJsExpression(result, expr, source);
    if (next !== undefined) {
      result = next;
      matched = true;
      continue;
    }

    const replacement = statement.match(/^result\s*=\s*result\.replace\(\s*\/((?:\\.|[^/])*)\/([gimsuy]*)\s*,\s*(["'`])([\s\S]*?)\3\s*\)$/);
    if (replacement) {
      try { result = asText(result).replace(new RegExp(replacement[1], replacement[2]), replacement[4]); matched = true; continue; } catch { return undefined; }
    }
  }

  // Handle compact chains that were written as one JS expression.
  if (!matched) {
    const compact = body.match(/^result\s*=\s*(.+)$/i);
    if (compact) {
      const next = applySafeJsExpression(result, compact[1].trim(), source);
      if (next !== undefined) { result = next; matched = true; }
    }
  }

  return matched ? asText(result) : undefined;
}

function parseStaticJsObject(rule: unknown): Record<string, string> | undefined {
  const body = asText(rule).trim().replace(/^@js:/i, "").trim();
  const match = body.match(/^JSON\.stringify\(\s*\{([\s\S]*)\}\s*\)\s*;?$/i);
  if (!match) return undefined;
  const out: Record<string, string> = {};
  const pairs = [...match[1].matchAll(/([A-Za-z_$][\w$-]*)\s*:\s*(["'`])([\s\S]*?)\2/g)];
  if (!pairs.length) return undefined;
  for (const pair of pairs) out[pair[1]] = pair[3];
  return out;
}

function ruleString(raw: any, ...keys: string[]) {
  for (const key of keys) {
    const value = raw?.[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return "";
}

export function sourceCapabilities(source: ReadingBookSource) {
  const raw = source.raw || {};
  const values = [
    raw.searchUrl,
    (raw as any).header,
    (raw as any).ruleSearch?.bookList,
    (raw as any).ruleBookInfo?.init,
    (raw as any).ruleBookInfo?.tocUrl,
    (raw as any).ruleToc?.chapterList,
    (raw as any).ruleContent?.content,
    (raw as any).ruleContent?.subContent,
    (raw as any).ruleContent?.callBackJs,
  ];
  const hasJs = values.some(containsJs);
  const hasJava = values.some((rule) => /\bjava\./i.test(asText(rule)));
  const safeJs = values.some((rule) => {
    const body = asText(rule).replace(/^<js>/i, "").replace(/<\/js>$/i, "").replace(/^@js:/i, "").trim();
    return !!body && (parseStaticJsObject(rule) !== undefined || safeJsTransform("", rule, source) !== undefined);
  });
  const ajaxBridge = values.some((rule) => /java\.ajax\b/i.test(asText(rule)) && !/eval\s*\(|java\.(runJS|reflect|class|webView|getWebView)\b/i.test(asText(rule)));
  const safeJava = values.some((rule) => {
    const body = asText(rule);
    return /java\.(base64Decode|base64Encode|base64DecodeToString|hexDecodeToString|encodeURIComponent|decodeURIComponent|getVariable|toast)\b/i.test(body) && !/java\.(ajax|webView|getWebView|runJS|eval|class|reflect)\b/i.test(body);
  });
  return {
    hasJs,
    hasJava,
    safeJs,
    safeJava,
    ajaxBridge,
    mode: isShushanSource(source) ? "书山聚合专用适配器" : !hasJs ? "通用规则" : (safeJs || safeJava || ajaxBridge) ? "通用规则 + 安全 JS/Java 兼容" : "兼容适配器",
    canSearch: !containsJs(raw.searchUrl) || parseStaticJsObject(raw.searchUrl) !== undefined,
  } as const;
}



function isNanmComicSource(source: ReadingBookSource) {
  const raw = source.raw as any;
  return /楠楠漫画|nnmh\.(info|me)/i.test(`${source.name} ${source.url}`);
}
function normalizeNanmCover(value: unknown, base: string) {
  const url = joinUrl(base, asText(value));
  return url || undefined;
}

async function decryptNanmEncryptedData(encoded: string): Promise<string> {
  const normalized = encoded.trim().replace(/\\/g, "");
  const binary = atob(normalized.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  if (bytes.byteLength <= 16) throw new Error("漫画正文密文长度异常");
  const iv = bytes.slice(0, 16);
  const ciphertext = bytes.slice(16);
  const keyBytes = new TextEncoder().encode("tH1rU6qZ4vU1sK7pN1wO7mX4bY6dQ9gX");
  if (!globalThis.crypto?.subtle) throw new Error("当前浏览器不支持漫画正文解密");
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "AES-CBC" }, false, ["decrypt"]);
  const plainBuffer = await crypto.subtle.decrypt({ name: "AES-CBC", iv }, key, ciphertext);
  const plain = new Uint8Array(plainBuffer);
  if (!plain.length) return "[]";
  const pad = plain[plain.length - 1];
  const end = pad >= 1 && pad <= 16 && pad <= plain.length ? plain.length - pad : plain.length;
  return new TextDecoder("utf-8").decode(plain.slice(0, end));
}

async function fetchNanmExploreModule(source: ReadingBookSource, moduleUrl: string, page: number): Promise<unknown> {
  const state = loadReadingSourceState(source.id);
  const vars = { ...(state.variables || {}), key: "", page: String(page), pageIndex: String(page), keyword: "" };
  const templated = replaceVars(moduleUrl, vars);
  const request = parseRequestUrl(templated, source.url);
  const options = request.options || {};
  const payload = await fetchSource({
    source,
    url: request.url,
    method: options.method || "GET",
    headers: { ...parseHeaderRule(source, vars), ...(options.headers || {}) },
    body: typeof options.body === "string" ? replaceVars(options.body, vars) : options.body,
  });
  return parsePayload(payload.text, payload.contentType);
}

async function getNanmSearch(source: ReadingBookSource, keyword: string, page: number): Promise<GenericSourceBook[]> {
  const raw = source.raw as any;
  const searchUrlRule = ruleString(raw, "searchUrl");
  if (!searchUrlRule) throw new Error("漫画书源没有配置 searchUrl");
  const state = loadReadingSourceState(source.id);
  const vars = { ...(state.variables || {}), key: keyword, page: String(page), pageIndex: String(page), keyword };
  const templated = replaceVars(searchUrlRule, vars);
  const request = parseRequestUrl(templated, source.url);
  const options = request.options || {};
  const payload = await fetchSource({
    source,
    url: request.url,
    method: options.method || "GET",
    headers: { ...parseHeaderRule(source, vars), ...(options.headers || {}) },
    body: typeof options.body === "string" ? replaceVars(options.body, vars) : options.body,
  });
  const root = parsePayload(payload.text, payload.contentType);
  const list = manyValues(root, "$.info[*]");
  return list.map((item: any) => {
    const title = asText(item?.title).trim() || "未命名";
    const author = asText(item?.author).trim() || undefined;
    const cover = normalizeNanmCover(item?.cover_pic, payload.url || source.url);
    const desc = asText(item?.summary).trim() || undefined;
    const id = asText(item?.id).trim();
    const bookUrl = id ? joinUrl(payload.url || source.url, `/home/book/index/id/${id}/`) : "";
    return { title, author, cover, desc, latestChapterTitle: asText(item?.maxepisodes).trim() || undefined, bookUrl, raw: item };
  }).filter((book) => !!book.bookUrl);
}

async function getNanmDetail(source: ReadingBookSource, book: GenericSourceBook): Promise<GenericSourceDetail> {
  const payload = await fetchSource({ source, url: joinUrl(source.url, book.bookUrl), headers: parseHeaderRule(source) });
  const root = parsePayload(payload.text, payload.contentType);
  const title = scalar(root, ".cover-box .container .title@text") || book.title;
  const author = scalar(root, ".author@text") || book.author;
  const coverRaw = scalar(root, ".cover-box .bg img@src") || book.cover;
  const desc = scalar(root, ".article .body@text") || book.desc;
  const tags = manyValues(root, ".label .item a").map(textOf).filter(Boolean).join(",");
  return {
    ...book,
    title,
    author,
    cover: coverRaw ? normalizeNanmCover(coverRaw, payload.url || source.url) : undefined,
    desc,
    intro: desc,
    bookUrl: book.bookUrl,
    tocUrl: book.bookUrl,
    tags,
    raw: { title, author, cover: coverRaw, desc, tags, sourceUrl: book.bookUrl },
  };
}

async function getNanmCatalog(source: ReadingBookSource, detail: GenericSourceDetail): Promise<GenericSourceChapter[]> {
  const payload = await fetchSource({ source, url: joinUrl(source.url, detail.bookUrl), headers: parseHeaderRule(source) });
  const root = parsePayload(payload.text, payload.contentType);
  const items = manyValues(root, "#html_box .item");
  return items.map((item) => ({
    title: scalar(item, "a@text") || "未命名章节",
    url: joinUrl(payload.url || source.url, scalar(item, "a@href")),
    raw: item,
  })).filter((chapter) => !!chapter.url);
}

async function getNanmContent(source: ReadingBookSource, chapter: GenericSourceChapter): Promise<string> {
  const payload = await fetchSource({ source, url: joinUrl(source.url, chapter.url), headers: parseHeaderRule(source) });
  const match = payload.text.match(/var\s+encryptedData\s*=\s*["']([^"']+)["']/i);
  if (!match?.[1]) throw new Error("漫画正文没有找到 encryptedData");
  let jsonText: string;
  try {
    jsonText = await decryptNanmEncryptedData(match[1]);
  } catch (error) {
    throw new Error(`漫画正文解密失败：${error instanceof Error ? error.message : "未知错误"}`);
  }
  let urls: unknown;
  try { urls = JSON.parse(jsonText); } catch { throw new Error("漫画正文解密后不是有效图片列表"); }
  if (!Array.isArray(urls)) throw new Error("漫画正文图片列表格式异常");
  return urls.filter((url) => /^https?:\/\//i.test(asText(url))).map((url) => `[[MANGA_IMAGE]]${asText(url)}`).join("\n");
}

function isShushanSource(source: ReadingBookSource) {
  return source.adapter === "shushan" || /vossc\.com|书山聚合|书山/i.test(`${source.name} ${source.url}`);
}

function requireShushanAccount() {
  const account = loadShushanAccount();
  if (!account.apiKey || account.apiKey.length < 10) {
    throw new Error("书山聚合需要先登录账号，请在书源页面完成登录");
  }
  return account;
}

function toShushanSearchBook(book: GenericSourceBook): ShushanSearchBook {
  const raw = book.raw && typeof book.raw === "object" ? book.raw as Record<string, unknown> : {};
  return {
    ...raw,
    title: String(raw.title || raw.book_name || raw.bookName || book.title || ""),
    author: raw.author ? String(raw.author) : book.author,
    cover: raw.cover ? String(raw.cover) : book.cover,
    desc: raw.desc ? String(raw.desc) : book.desc,
    source: String(raw.source || "小说"),
    book_url: String(raw.book_url || raw.bookUrl || book.bookUrl || ""),
    latestChapterTitle: raw.latestChapterTitle ? String(raw.latestChapterTitle) : book.latestChapterTitle,
    tab: raw.tab ? String(raw.tab) : undefined,
  };
}

function toShushanDetail(book: GenericSourceDetail): ShushanDetail {
  const raw = book.raw && typeof book.raw === "object" ? book.raw as Record<string, unknown> : {};
  return {
    ...raw,
    title: String(raw.title || raw.book_name || book.title || ""),
    name: raw.name ? String(raw.name) : book.title,
    author: raw.author ? String(raw.author) : book.author,
    cover: raw.cover ? String(raw.cover) : book.cover,
    desc: raw.desc ? String(raw.desc) : book.desc,
    source: String(raw.source || "小说"),
    book_url: String(raw.book_url || raw.bookUrl || book.bookUrl || ""),
    latestChapterTitle: raw.latestChapterTitle ? String(raw.latestChapterTitle) : book.latestChapterTitle,
    tab: raw.tab ? String(raw.tab) : undefined,
  };
}

async function searchShushanAdapter(source: ReadingBookSource, keyword: string, page: number): Promise<GenericSourceBook[]> {
  const account = requireShushanAccount();
  const raw = source.raw as any;
  const state = loadReadingSourceState(source.id);
  const vars = state.variables || {};
  let inlineSource = String(vars.source || vars.sourceName || "").trim();
  if (!inlineSource) {
    const configured = String(raw?.bookSourceComment || "");
    const match = configured.match(/自定义源站示例[^\n]*[:：]\s*([^\n]+)/);
    inlineSource = match?.[1]?.trim() || "";
  }
  const result = await import("./shushan-client").then(({ searchShushan }) => searchShushan(account.apiKey, keyword, inlineSource, page));
  return (result.data || []).map((item) => ({
    title: item.title || "未命名",
    author: item.author,
    cover: item.cover,
    desc: item.desc,
    latestChapterTitle: item.latestChapterTitle,
    bookUrl: item.book_url,
    raw: item,
  }));
}

async function getShushanDetailAdapter(source: ReadingBookSource, book: GenericSourceBook): Promise<GenericSourceDetail> {
  const account = requireShushanAccount();
  const result = await getShushanDetail(account.apiKey, toShushanSearchBook(book));
  const item = result.data;
  return {
    title: item.title || item.name || book.title,
    author: item.author || book.author,
    cover: item.cover || book.cover,
    desc: item.desc || book.desc,
    latestChapterTitle: item.latestChapterTitle || book.latestChapterTitle,
    bookUrl: item.book_url || book.bookUrl,
    tocUrl: item.book_url || book.bookUrl,
    intro: item.desc || book.desc,
    raw: item,
  };
}

async function getShushanCatalogAdapter(source: ReadingBookSource, detail: GenericSourceDetail): Promise<GenericSourceChapter[]> {
  const account = requireShushanAccount();
  const result = await getShushanCatalog(account.apiKey, toShushanDetail(detail));
  return (result.data || []).filter((item) => !item.isVolume).map((item: ShushanChapter, index) => ({
    title: item.title || `第${index + 1}章`,
    url: String(item.url || ""),
    isPay: item.isPay === true,
    isVip: item.isVip === true,
    raw: item,
  }));
}

async function getShushanContentAdapter(source: ReadingBookSource, chapter: GenericSourceChapter, detail?: GenericSourceDetail): Promise<string> {
  const account = requireShushanAccount();
  const raw = chapter.raw && typeof chapter.raw === "object" ? chapter.raw as ShushanChapter : {} as ShushanChapter;
  const catalogRaw = detail?.raw && typeof detail.raw === "object" ? detail.raw as Record<string, unknown> : {};
  const catalog = {
    source: String(catalogRaw.source || ""),
    url: String(catalogRaw.book_url || catalogRaw.bookUrl || detail?.bookUrl || ""),
    name: String(catalogRaw.title || catalogRaw.name || detail?.title || ""),
    tab: String(catalogRaw.tab || "novel"),
  };
  const result = await getShushanChapterContent(account.apiKey, raw, catalog, createDeviceId());
  return result.content || "";
}

export async function searchGenericSource(source: ReadingBookSource, keyword: string, page = 1): Promise<GenericSourceBook[]> {
  {
    const mangaAdapter = getMangaSourceAdapter(source);
    if (mangaAdapter) return mangaAdapter.request("search", { keyword, page }) as Promise<GenericSourceBook[]>;
  }
  if (isNanmComicSource(source)) return getNanmSearch(source, keyword, page);
  if (isShushanSource(source)) return searchShushanAdapter(source, keyword, page);
  const raw = source.raw as any;
  const searchUrlRule = ruleString(raw, "searchUrl");
  requireSimpleRule(searchUrlRule, "搜索地址");
  if (!searchUrlRule) throw new Error("书源没有配置 searchUrl");

  const state = loadReadingSourceState(source.id);
  const vars = { ...(state.variables || {}), key: keyword, page: String(page), pageIndex: String(page), keyword };
  const templated = replaceVars(searchUrlRule, vars);
  const request = parseRequestUrl(templated, source.url);
  if (!/^https?:/i.test(request.url)) throw new Error("搜索地址不是有效的 HTTP/HTTPS 地址");
  const options = request.options || {};
  const payload = await fetchSource({
    url: request.url,
    method: options.method || "GET",
    headers: { ...parseHeaderRule(source, vars), ...(options.headers || {}) },
    body: typeof options.body === "string" ? replaceVars(options.body, vars) : options.body,
    source,
  });
  const root = parsePayload(payload.text, payload.contentType);
  const listRule = ruleString(raw.ruleSearch || {}, "bookList");
  requireSimpleRule(listRule, "搜索列表");
  if (!listRule) throw new Error("书源没有配置 ruleSearch.bookList");

  const items = manyValues(root, listRule);
  const rules = raw.ruleSearch || {};
  return items.map((item) => {
    const name = scalar(item, ruleString(rules, "name", "title"));
    const author = scalar(item, ruleString(rules, "author")) || undefined;
    const cover = scalar(item, ruleString(rules, "coverUrl", "cover")) || undefined;
    const desc = scalar(item, ruleString(rules, "intro", "desc")) || undefined;
    const latestChapterTitle = scalar(item, ruleString(rules, "lastChapter", "latestChapterTitle")) || undefined;
    const href = scalar(item, ruleString(rules, "bookUrl", "url", "detailUrl"));
    return {
      title: name || "未命名",
      author,
      cover: cover ? joinUrl(payload.url || source.url, cover) : undefined,
      desc,
      latestChapterTitle,
      bookUrl: joinUrl(payload.url || source.url, href),
      raw: item,
    };
  }).filter((book) => !!book.bookUrl || book.title !== "未命名");
}

export async function getGenericDetail(source: ReadingBookSource, book: GenericSourceBook): Promise<GenericSourceDetail> {
  {
    const mangaAdapter = getMangaSourceAdapter(source);
    if (mangaAdapter) return mangaAdapter.request("detail", { bookUrl: book.bookUrl }) as Promise<GenericSourceDetail>;
  }
  if (isNanmComicSource(source)) return getNanmDetail(source, book);
  if (isShushanSource(source)) return getShushanDetailAdapter(source, book);
  const raw = source.raw as any;
  if (!book.bookUrl) throw new Error("搜索结果没有 bookUrl");
  const rule = raw.ruleBookInfo || {};

  const state = loadReadingSourceState(source.id);
  const vars = state.variables || {};
  const payload = await fetchSource({ source, url: joinUrl(source.url, replaceVars(book.bookUrl, vars)), headers: parseHeaderRule(source, vars) });
  const root = parsePayload(payload.text, payload.contentType);
  const title = scalar(root, ruleString(rule, "name", "title")) || book.title;
  const author = scalar(root, ruleString(rule, "author")) || book.author;
  const desc = scalar(root, ruleString(rule, "intro", "desc", "content")) || book.desc;
  const coverRaw = scalar(root, ruleString(rule, "coverUrl", "cover")) || book.cover;
  const cover = coverRaw ? joinUrl(payload.url || source.url, coverRaw) : undefined;
  const tocRule = ruleString(rule, "tocUrl", "catalogUrl");
  const tocUrl = tocRule ? joinUrl(payload.url || source.url, scalar(root, tocRule)) : book.bookUrl;

  return { ...book, title, author, desc, intro: desc, cover, tocUrl, raw: root };
}

export async function getGenericCatalog(source: ReadingBookSource, detail: GenericSourceDetail): Promise<GenericSourceChapter[]> {
  {
    const mangaAdapter = getMangaSourceAdapter(source);
    if (mangaAdapter) return mangaAdapter.request("catalog", { bookUrl: detail.bookUrl }) as Promise<GenericSourceChapter[]>;
  }
  if (isNanmComicSource(source)) return getNanmCatalog(source, detail);
  if (isShushanSource(source)) return getShushanCatalogAdapter(source, detail);
  const raw = source.raw as any;
  const rule = raw.ruleToc || {};
  const url = detail.tocUrl || detail.bookUrl;
  if (!url) throw new Error("书籍没有目录地址");

  const state = loadReadingSourceState(source.id);
  const vars = state.variables || {};
  const payload = await fetchSource({ source, url: joinUrl(source.url, replaceVars(url, vars)), headers: parseHeaderRule(source, vars) });
  const root = parsePayload(payload.text, payload.contentType);
  const listRule = ruleString(rule, "chapterList");
  requireSimpleRule(listRule, "目录列表");
  if (!listRule) throw new Error("书源没有配置 ruleToc.chapterList");
  const items = manyValues(root, listRule);

  return items.map((item) => {
    const title = scalar(item, ruleString(rule, "chapterName", "name", "title")) || "未命名章节";
    const href = scalar(item, ruleString(rule, "chapterUrl", "url"));
    const pay = scalar(item, ruleString(rule, "isPay"));
    const vip = scalar(item, ruleString(rule, "isVip"));
    return {
      title,
      url: joinUrl(payload.url || source.url, href),
      isPay: /^(true|1|yes)$/i.test(pay),
      isVip: /^(true|1|yes)$/i.test(vip),
      raw: item,
    };
  }).filter((chapter) => !!chapter.url || !!chapter.title);
}

export function normalizeMangaImageHtml(content: string, baseUrl: string) {
  const html = String(content || "").trim();
  if (!html) return "";

  // 漫画阅读器已经支持 [[MANGA_IMAGE]] 标记。
  // 不要把图片 HTML 再交给 htmlToParagraphs，否则 <img> 没有文本内容会被解析成空正文。
  const images: string[] = [];
  const imageRe = /<img\b[^>]*(?:data-src|data-original|src)\s*=\s*["']([^"']+)["'][^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = imageRe.exec(html))) {
    const source = String(match[1] || "").trim();
    if (!source) continue;
    const absolute = joinUrl(baseUrl, source);
    if (absolute && !images.includes(absolute)) images.push(absolute);
  }

  if (images.length > 0) {
    return images.map((url) => `[[MANGA_IMAGE]]${url}`).join("\n");
  }

  // 有些正文接口已经直接返回图片 URL，一行一个；保留这种格式。
  const directUrls = html
    .split(/\r?\n+/)
    .map((line) => line.trim())
    .filter((line) => /^https?:\/\//i.test(line));
  if (directUrls.length > 0) {
    return directUrls.map((url) => `[[MANGA_IMAGE]]${url}`).join("\n");
  }

  return html;
}

function applyReplaceRules(text: string, rules: unknown) {
  let result = text;
  const raw = asText(rules).trim();
  if (!raw) return result;
  // Supports the common RegExp replacement form serialized as /pattern/flags/replacement.
  const chunks = raw.split(/\\n|\n/).map((x) => x.trim()).filter(Boolean);
  for (const chunk of chunks) {
    const match = chunk.match(/^\/((?:\\.|[^/])*)\/([gimsuy]*)\s*=>\s*(.*)$/);
    if (!match) continue;
    try { result = result.replace(new RegExp(match[1], match[2]), match[3]); } catch { /* ignore malformed replacement */ }
  }
  return result;
}

export async function getGenericChapterContent(source: ReadingBookSource, chapter: GenericSourceChapter, detail?: GenericSourceDetail): Promise<string> {
  {
    const mangaAdapter = getMangaSourceAdapter(source);
    if (mangaAdapter) {
      const result = await mangaAdapter.request("content", { chapterUrl: chapter.url }) as { content: string; baseUrl?: string };
      return normalizeMangaImageHtml(result.content, result.baseUrl || chapter.url);
    }
  }
  if (isNanmComicSource(source)) return getNanmContent(source, chapter);
  if (!chapter.url) throw new Error("章节没有正文地址");
  if (isShushanSource(source)) return getShushanContentAdapter(source, chapter, detail);
  const raw = source.raw as any;
  const rule = raw.ruleContent || {};

  const state = loadReadingSourceState(source.id);
  const vars = state.variables || {};
  const chapterUrl = joinUrl(source.url, replaceVars(chapter.url, vars));
  const payload = await fetchSource({ source, url: chapterUrl, headers: parseHeaderRule(source, vars) });
  const root = parsePayload(payload.text, payload.contentType);
  const contentRule = ruleString(rule, "content", "body", "text");
  const bridged = await runJavaAjaxBridge(payload.text, contentRule, source);
  if (bridged !== undefined) return applyReplaceRules(bridged, raw.replaceRegex);
  const safeJs = safeJsTransform(payload.text, contentRule, source);
  if (safeJs !== undefined) return applyReplaceRules(safeJs, raw.replaceRegex);
  requireSimpleRule(contentRule, "正文规则");
  const value = scalar(root, contentRule);
  let content = value || (typeof root === "string" ? root : payload.text);
  const subContentRule = ruleString(rule, "subContent");
  const transformedSub = subContentRule ? safeJsTransform(content, subContentRule, source) : undefined;
  if (transformedSub !== undefined) content = transformedSub;
  return applyReplaceRules(content, raw.replaceRegex);
}

export function htmlToParagraphs(content: string) {
  const html = String(content || "").trim();
  if (!html) return [];
  const looksHtml = /<\/?[a-z][\s\S]*>/i.test(html);
  if (!looksHtml) return html.split(/\r?\n+/).map((x) => x.trim()).filter(Boolean);
  if (typeof DOMParser === "undefined") return html.split(/\r?\n+/).map((x) => x.trim()).filter(Boolean);
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
  const root = doc.body.firstElementChild;
  if (!root) return [];
  const lines = Array.from(root.querySelectorAll("p,div,br,li"))
    .map((el) => el.tagName === "BR" ? "\n" : textOf(el))
    .filter(Boolean)
    .join("\n");
  return (lines || textOf(root)).split(/\n+/).map((x) => x.trim()).filter(Boolean);
}


export type GenericSourceTestStep = {
  key: "search" | "detail" | "catalog" | "content";
  status: "ok" | "warn" | "error";
  message: string;
  count?: number;
};

export type GenericSourceTestReport = {
  sourceName: string;
  mode: string;
  hasJs: boolean;
  steps: GenericSourceTestStep[];
};

export async function testGenericSource(source: ReadingBookSource, keyword: string): Promise<GenericSourceTestReport> {
  const caps = sourceCapabilities(source);
  const steps: GenericSourceTestStep[] = [];
  if (caps.hasJs) steps.push({ key: "search", status: "warn", message: "检测到 JS/Java 规则；测试仅验证可直接解析的部分。" });
  try {
    const results = await searchGenericSource(source, keyword.trim(), 1);
    steps.push({ key: "search", status: results.length ? "ok" : "warn", message: results.length ? `搜索成功：${results.length} 条` : "搜索请求成功，但没有解析到书籍", count: results.length });
    if (!results[0]) return { sourceName: source.name, mode: caps.mode, hasJs: caps.hasJs, steps };
    try {
      const detail = await getGenericDetail(source, results[0]);
      steps.push({ key: "detail", status: "ok", message: `详情成功：${detail.title || results[0].title}` });
      try {
        const chapters = await getGenericCatalog(source, detail);
        steps.push({ key: "catalog", status: chapters.length ? "ok" : "warn", message: chapters.length ? `目录成功：${chapters.length} 章` : "目录请求成功，但没有解析到章节", count: chapters.length });
        if (chapters[0]) {
          try {
            const content = await getGenericChapterContent(source, chapters[0], detail);
            steps.push({ key: "content", status: content.trim() ? "ok" : "warn", message: content.trim() ? `正文成功：${content.length} 字符` : "正文请求成功，但内容为空" });
          } catch (error) {
            steps.push({ key: "content", status: "error", message: error instanceof Error ? error.message : "正文测试失败" });
          }
        }
      } catch (error) {
        steps.push({ key: "catalog", status: "error", message: error instanceof Error ? error.message : "目录测试失败" });
      }
    } catch (error) {
      steps.push({ key: "detail", status: "error", message: error instanceof Error ? error.message : "详情测试失败" });
    }
  } catch (error) {
    steps.push({ key: "search", status: "error", message: error instanceof Error ? error.message : "搜索测试失败" });
  }
  return { sourceName: source.name, mode: caps.mode, hasJs: caps.hasJs, steps };
}
