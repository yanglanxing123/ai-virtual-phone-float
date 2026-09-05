"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { BookOpen, Library, Search, Palette, Compass, X, Upload, Trash2, MoreVertical, LogIn, Plus, ChevronRight, RefreshCw } from "lucide-react";
import { hydrateReadingStorage } from "@/lib/reading-storage";
import { ReadingShelf } from "./reading-shelf";
import { ReadingViewer } from "./reading-viewer";
import {
  DEFAULT_READING_APPEARANCE,
  loadReadingAppearance,
  loadReadingBackground,
  loadReadingReaderBackground,
  loadReadingCustomFont,
  resolveReadingFontFamily,
  saveReadingAppearance,
  saveReadingBackground,
  saveReadingReaderBackground,
  saveReadingCustomFont,
  type ReadingAppearance,
} from "@/lib/reading-appearance";
import type { Book } from "@/lib/reading-types";
import {
  clearShushanAccount,
  getShushanBookInfo,
  getShushanDetail,
  getShushanCatalog,
  loadShushanAccount,
  saveRemoteBook,
  saveShushanAccount,
  searchShushan,
  type ShushanAccount,
  type ShushanChapter,
  type ShushanSearchBook,
} from "@/lib/shushan-client";
import { addBook, saveChapters, saveCover } from "@/lib/reading-storage";
import { importReadingSources, loadReadingSources, removeReadingSource, setReadingSourceEnabled, updateReadingSourceMeta, saveReadingRemoteBook, clearReadingSourceState, loadReadingSourceState, saveReadingSourceState, type ReadingBookSource } from "@/lib/reading-source";
import { fetchReadingSourceModule, getGenericCatalog, getGenericDetail, searchGenericSource, type GenericSourceBook, type GenericSourceChapter, type GenericSourceDetail } from "@/lib/reading-source-engine";
import "./reading-hub.css";

type Tab = "home" | "discovery" | "shelf" | "sources" | "appearance";

type HomeModule = { id: string; title: string; url: string; sourceId: string; enabled: boolean; };

type LoginField = { name: string; type: string; action?: string };

const SHUSHAN_SOURCE_VALUES: Record<string, string> = {
  sou0: "", sou1: "番茄小说", sou2: "番茄听书", sou3: "番茄畅听", sou4: "番茄漫画", sou5: "番茄短剧",
  sou6: "七猫", sou7: "起点", sou8: "企鹅看书", sou9: "书旗", sou10: "60看书", sou11: "半夏", sou12: "69书吧",
  sou13: "得间", sou14: "知乎", sou15: "茶马", sou16: "爱下电子书", sou17: "笔趣阁", sou18: "米读", sou19: "追书神器",
  sou20: "小米阅读", sou21: "猫眼看书", sou22: "圣武书屋", sou23: "疯读", sou24: "淘小说", sou25: "思兔", sou26: "甜梦文库",
  sou27: "三七轻小说", sou28: "歪瑞古德", sou29: "包子漫画", sou30: "西瓜", sou31: "速读谷", sou32: "919", sou33: "七猫短剧",
  sou34: "69书吧co", sou35: "笔下小说", sou36: "百度", sou37: "酷我", sou38: "笔趣阁78", sou39: "全面漫画", sou40: "书音",
  sou41: "云端", sou42: "全本", sou43: "红牛小说", sou44: "3a中文", sou45: "萝卜", sou46: "精品", sou47: "喜马拉雅",
  sou48: "万相书城", sou49: "得奇", sou50: "台湾", sou51: "QQ阅读", sou52: "书耽网", sou53: "云图有声", sou54: "番薯小说", sou55: "晋江",
};

const SHUSHAN_HOSTS = [
  "https://v1.vossc.com", "https://v2.vossc.com", "https://v3.vossc.com", "https://v4.vossc.com", "http://1.94.248.5:7001",
];

type Props = {
  onClose: () => void;
};

const READING_CUSTOM_CSS_KEY = "reading-custom-css-v1";

const DEFAULT_READING_CUSTOM_CSS = `/* 阅读 APP 全局主题：参考聊天 APP 的 --c-* / --ui-* 体系
   只修改变量，就能统一影响首页 / 书源 / 书架 / 详情 / 目录 / 阅读界面。 */
.reading-app-surface {
  --c-bg: #fffced;
  --c-bg-soft: #f7f1e7;
  --c-card: rgba(255,255,255,.82);
  --c-card-border: rgba(80,55,20,.08);
  --c-input: rgba(255,255,255,.72);
  --c-input-border: rgba(80,55,20,.10);
  --c-text: #5f5148;
  --c-text-title: #2b241f;
  --c-icon: #8b7e73;
  --c-icon-active: #e6bd4e;
  --c-line: rgba(80,55,20,.08);
  --ui-radius: 12px;
  --ui-radius-card: 18px;
  --ui-blur: 16px;
  --ui-saturate: 150%;
}
`;



function sourceReaderType(source: ReadingBookSource | null | undefined): "manga" | "text" {
  return source && (source.raw as any)?.bookSourceType === 2 ? "manga" : "text";
}

function isMangaSource(source: ReadingBookSource | null | undefined) {
  if (!source) return false;
  const raw = source.raw as any;
  return raw?.bookSourceType === 2 || /楠楠漫画|nnmh\.info/i.test(`${source.name} ${source.url}`);
}

function getSourceTypeLabel(source: ReadingBookSource | null | undefined) {
  return sourceReaderType(source) === "manga" ? "漫画" : "小说";
}

/**
 * loginUi 在 Legado 书源里并不等于“需要登录”。
 * 很多书源会用 loginUi 保存地址、测速、发布页等普通设置，甚至 loginUrl 只是空函数。
 * 因此只有真正存在登录动作/凭据字段时才显示“登录”，避免无登录漫画源被误判。
 */
function sourceNeedsLogin(source: ReadingBookSource | null | undefined) {
  if (!source) return false;
  if (source.adapter === "shushan") return true;
  const raw = source.raw as any;
  const loginUrl = String(raw?.loginUrl || "").trim();
  const loginUi = String(raw?.loginUi || "").trim();
  if (!loginUrl && !loginUi) return false;
  if (/^function\s+login\s*\(\s*\)\s*\{\s*\}$/i.test(loginUrl)) return false;
  try {
    const parsed = JSON.parse(loginUi);
    if (Array.isArray(parsed)) {
      const fields = parsed.filter((item: any) => item && item.type !== "button");
      const hasCredential = fields.some((item: any) => {
        const name = String(item.name || "").toLowerCase();
        const type = String(item.type || "").toLowerCase();
        return /账号|用户名|邮箱|密码|token|令牌|验证码|cookie|密钥|key/.test(name) || /password|email|tel|number/.test(type);
      });
      if (hasCredential) return true;
      const hasLoginAction = parsed.some((item: any) => item && item.type === "button" && /^(login|signin|sign_in)\s*\(/i.test(String(item.action || "")));
      if (hasLoginAction) return true;
    }
  } catch {}
  return /(^|[\s;])(?:login|signin|sign_in)\s*\(/i.test(loginUrl) || /登录|signin|sign in/i.test(loginUrl);
}

function isShushanSource(source: ReadingBookSource | null | undefined) {
  if (!source) return false;
  return source.adapter === "shushan" || /vossc\.com|书山聚合|书山/i.test(`${source.name} ${source.url}`);
}

function getTitle(tab: Tab) {
  switch (tab) {
    case "home":
      return "首页";
    case "discovery":
      return "发现";
    case "shelf":
      return "书架";
    case "sources":
      return "书源";
    case "appearance":
      return "外观";
  }
}


function normalizeRemoteUrl(value: unknown, base?: string) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith("//")) return `https:${raw}`;
  if (base) {
    try { return new URL(raw, base).toString(); } catch {}
  }
  return raw;
}

function detailValue(obj: unknown, keys: string[]): string {
  if (!obj || typeof obj !== "object") return "";
  const record = obj as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return "";
}

function compositeMetaText(obj: unknown): string {
  const raw = detailValue(obj, ["tags", "tag", "book_tags", "labels", "label"]);
  return raw;
}

function detailTags(obj: unknown): string {
  const value = compositeMetaText(obj);
  if (Array.isArray((obj as any)?.tags)) return (obj as any).tags.join(" · ");
  if (!value) return "暂无标签";
  const parts = value.split(/[，,|]/).map(x => x.trim()).filter(Boolean);
  const filtered = parts.filter(part =>
    !/^\d+(?:\.\d+)?\s*分$/.test(part) &&
    !/^(?:连载|完结|已完本|更新中|finished|complete|serial)$/i.test(part) &&
    !/^20\d{2}[\/-]\d{1,2}[\/-]\d{1,2}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?$/.test(part)
  );
  return (filtered.length ? filtered : parts).join(" · ") || "暂无标签";
}

function detailStatus(obj: unknown): string {
  const record = obj && typeof obj === "object" ? obj as Record<string, unknown> : {};
  const value = detailValue(obj, ["status", "book_status", "novel_status", "state", "serial_status", "book_status_code"]);
  const composite = compositeMetaText(obj);
  const source = `${value},${composite}`;
  if (/完结|已完本|finished|complete/i.test(source)) return "完结";
  if (/连载|更新中|serial/i.test(source)) return "连载";
  if (value === "1") return "连载";
  if (value === "0") return "完结";
  if (String(record.book_search_visible).toLowerCase() === "false") return "下架";
  return value || "连载";
}

function formatDetailTimestamp(value: string): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const numeric = Number(raw);
  if (Number.isFinite(numeric) && numeric > 1000000000) {
    try {
      const ms = numeric < 10000000000 ? numeric * 1000 : numeric;
      const date = new Date(ms);
      if (!Number.isNaN(date.getTime())) {
        const pad = (n: number) => String(n).padStart(2, "0");
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
      }
    } catch {}
  }
  return raw.replace(/T/, " ").replace(/\//g, "-").replace(/\.\d+Z?$/, "");
}

function detailRating(obj: unknown): string {
  const value = detailValue(obj, ["score", "rating", "rate", "book_score", "rating_score"]);
  if (value) {
    const direct = value.match(/\d+(?:\.\d+)?/);
    if (direct) return `${direct[0]}${/分/.test(value) ? "" : "分"}`;
  }
  const composite = compositeMetaText(obj).match(/(\d+(?:\.\d+)?)\s*分/);
  return composite ? `${composite[1]}分` : "暂无评分";
}

function detailUpdatedAt(obj: unknown): string {
  const value = detailValue(obj, [
    "update_time", "updated_at", "updateTime", "updatedAt",
    "last_update_time", "lastUpdateTime", "latest_update", "latestUpdate",
    "latest_update_time", "latestUpdateTime", "latest_chapter_update_time",
    "last_chapter_update_time", "modify_time", "modifyTime", "update_date", "updateDate",
  ]);
  if (value) return formatDetailTimestamp(value);
  const composite = compositeMetaText(obj).match(/(20\d{2}[\/-]\d{1,2}[\/-]\d{1,2}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?)/);
  return composite ? formatDetailTimestamp(composite[1]) : "";
}

function detailWordCount(obj: unknown): string {
  const value = detailValue(obj, [
    "wordCount", "word_count", "word_number", "wordNumber", "words", "wordNum", "word_num",
    "WordsCount", "WordsNum", "total_word_count", "totalWordCount", "length",
  ]);
  if (!value) return "暂无";
  const numeric = Number(value.replace(/[, ]/g, ""));
  if (Number.isFinite(numeric) && numeric > 0) return `${Math.round(numeric).toLocaleString("zh-CN")} 字`;
  return value;
}

function discoverSourceModules(source: ReadingBookSource): Array<{ title: string; url: string }> {
  const text = String((source.raw as any)?.exploreUrl || "");
  const items: Array<{ title: string; url: string }> = [];
  const seen = new Set<string>();
  const push = (title: string, url: string) => {
    const t = title.trim(); const u = url.trim();
    if (!t || !u || seen.has(`${t}|${u}`)) return;
    seen.add(`${t}|${u}`); items.push({ title: t, url: u });
  };

  // 书山原书源的 exploreUrl 是运行时 JS，网页端不会执行 Java/Legado JS。
  // 这里直接把它的动态榜单模板还原成可请求的 HTTP 地址。
  if (/vossc\.com|书山聚合|书山/i.test(`${source.url} ${source.name}`)) {
    const maleBlock = text.match(/let\s+categories\s*=\s*isMale\s*\?\s*\[([\s\S]*?)\]\s*:\s*\[([\s\S]*?)\]\s*;/i);
    const parseCats = (block: string | undefined) => {
      if (!block) return [] as Array<{ id: string; name: string }>;
      return [...block.matchAll(/\{\s*id\s*:\s*(\d+)\s*,\s*name\s*:\s*(["'`])([^"'`]+)\2\s*\}/g)]
        .map(m => ({ id: m[1], name: m[3] }));
    };
    let male = parseCats(maleBlock?.[1]);
    let female = parseCats(maleBlock?.[2]);

    // 兼容已经被转义/压缩过的书源 JSON；即使动态 JS 被截断，也不能让发现页变空。
    const fallbackFemale = [
      ["1139", "古风世情"], ["8", "科幻末世"], ["746", "游戏体育"], ["1015", "女频衍生"],
      ["248", "玄幻言情"], ["23", "种田"], ["79", "年代"], ["267", "现言脑洞"], ["246", "宫斗宅斗"],
      ["539", "悬疑脑洞"], ["253", "古言脑洞"], ["24", "快穿"], ["749", "青春甜宠"], ["745", "星光璀璨"],
      ["747", "女频悬疑"], ["750", "职场婚恋"], ["748", "豪门总裁"], ["1017", "民国言情"],
    ].map(([id, name]) => ({ id, name }));
    const fallbackMale = [
      ["1141", "西方奇幻"], ["1140", "东方仙侠"], ["8", "科幻末世"], ["261", "都市日常"], ["124", "都市修真"],
      ["1014", "都市高武"], ["273", "历史古代"], ["27", "战神赘婿"], ["263", "都市种田"], ["258", "传统玄幻"],
      ["272", "历史脑洞"], ["262", "都市脑洞"], ["257", "玄幻脑洞"], ["751", "悬疑灵异"], ["504", "抗战谍战"],
      ["746", "游戏体育"], ["718", "动漫衍生"], ["1016", "男频衍生"],
    ].map(([id, name]) => ({ id, name }));
    if (!female.length) female = fallbackFemale;
    if (!male.length) male = fallbackMale;

    const shushanHost = /vossc\.com/i.test(source.url) ? source.url.replace(/\/$/, "") : SHUSHAN_HOSTS[0];
    const rankUrl = `${shushanHost}/style_top?rank_list_type=3&offset={{(page-1)*10}}&limit=10&category_id={{categoryId}}&gender={{genderCode}}&rankMold={{rankMold}}`;
    for (const [genderCode, label, cats] of [["0", "女频", female], ["1", "男频", male]] as const) {
      for (const [rankMold, rankLabel] of [["2", "阅读榜"], ["1", "新书榜"]] as const) {
        for (const cat of cats) {
          const url = rankUrl
            .replace(/\{\{categoryId\}\}/g, cat.id)
            .replace(/\{\{genderCode\}\}/g, genderCode)
            .replace(/\{\{rankMold\}\}/g, rankMold);
          push(`${label}${rankLabel} · ${cat.name}`, url);
        }
      }
    }
    return items;
  }

  // 读漫屋的 exploreUrl 是 @js 动态脚本：先请求 /sort/1，再读取 .type-list li a。
  // 浏览器端不会执行 Legado 的 java.ajax / Jsoup，因此这里提供与站点分类一致的兼容映射。
  // 分类页地址本身仍交给读漫屋专用 route 处理，站点切换时不会绕过适配器。
  if (/读漫屋|dumanwu/i.test(`${source.name} ${source.url}`)) {
    const categories = [
      ["冒险", "/sort/1"],
      ["热血", "/sort/2"],
      ["都市", "/sort/3"],
      ["玄幻", "/sort/4"],
      ["悬疑", "/sort/5"],
      ["耽美", "/sort/6"],
      ["恋爱", "/sort/7"],
      ["生活", "/sort/8"],
      ["搞笑", "/sort/9"],
      ["穿越", "/sort/10"],
      ["修真", "/sort/11"],
      ["后宫", "/sort/12"],
      ["女主", "/sort/13"],
      ["古风", "/sort/14"],
      ["连载", "/sort/15"],
      ["完结", "/sort/16"],
    ] as const;
    for (const [title, url] of categories) push(title, url);
    return items;
  }

  // 楠楠漫画的 exploreUrl 是标准 Legado 发现页 JSON 数组，
  // 这里原样读取模块标题与请求地址，不把分类硬编码进 App。
  if ((source.raw as any)?.enabledExplore) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (item && typeof item === "object") {
            push(String((item as any).title || ""), String((item as any).url || ""));
          }
        }
        if (items.length) return items;
      }
    } catch {
      // 兼容少数书源把 JSON 数组包在字符串里的情况，继续尝试 push()。
    }
  }

  // 普通 Legado 书源：保留可直接识别的静态 push() 模块。
  for (const m of text.matchAll(/push\(\s*(["'`])([^"'`]+)\1\s*,\s*(["'`])([^"'`]+)\3/g)) {
    push(m[2], m[4]);
  }
  return items;
}

export default function ReadingApp({ onClose }: Props) {
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState<Tab>("home");
  const [activeBook, setActiveBook] = useState<Book | null>(null);
  const [sourceKeyword, setSourceKeyword] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [sourceResults, setSourceResults] = useState<ShushanSearchBook[]>([]);
  const [sourceLoading, setSourceLoading] = useState(false);
  const [sourceMessage, setSourceMessage] = useState("");
  const [sourceDrawerOpen, setSourceDrawerOpen] = useState(false);
  const [sourceDrawerMode, setSourceDrawerMode] = useState<"home" | "discovery" | "search">("search");
  const [sourceImportTarget, setSourceImportTarget] = useState<"home" | "discovery" | "search">("search");
  const [homeSourceIds, setHomeSourceIds] = useState<string[]>([]);
  const [discoverySourceIds, setDiscoverySourceIds] = useState<string[]>([]);
  const [sourceLoginOpen, setSourceLoginOpen] = useState(false);
  const [loginFields, setLoginFields] = useState<Record<string, string>>({});
  const [homeModules, setHomeModules] = useState<HomeModule[]>([]);
  const [homeModuleLoading, setHomeModuleLoading] = useState<string | null>(null);
  const [homeModuleData, setHomeModuleData] = useState<Record<string, GenericSourceBook[]>>({});
  const [homeModuleEditorOpen, setHomeModuleEditorOpen] = useState(false);
  const [homeModuleTitle, setHomeModuleTitle] = useState("");
  const [homeModuleUrl, setHomeModuleUrl] = useState("");
  const [homeModuleSourceId, setHomeModuleSourceId] = useState("");
  const [discoveryModuleSourceId, setDiscoveryModuleSourceId] = useState("");
  const [selectedSourceBook, setSelectedSourceBook] = useState<ShushanSearchBook | null>(null);
  const [sourceDetail, setSourceDetail] = useState<ShushanSearchBook | null>(null);
  const [sourceChapters, setSourceChapters] = useState<ShushanChapter[]>([]);
  const [genericResults, setGenericResults] = useState<GenericSourceBook[]>([]);
  const [genericBook, setGenericBook] = useState<GenericSourceBook | null>(null);
  const [genericDetail, setGenericDetail] = useState<GenericSourceDetail | null>(null);
  const [genericChapters, setGenericChapters] = useState<GenericSourceChapter[]>([]);
  // 首页排行榜使用独立的详情状态，不复用“书源搜索页”状态，避免点击榜单书籍后被切回书源页。
  const [homeDetailOpen, setHomeDetailOpen] = useState(false);
  const [homeDetailBook, setHomeDetailBook] = useState<ShushanSearchBook | null>(null);
  const [homeDetailChapters, setHomeDetailChapters] = useState<ShushanChapter[]>([]);
  const [homeDetailLoading, setHomeDetailLoading] = useState(false);
  const [homeDetailMessage, setHomeDetailMessage] = useState("");
  const [bookSources, setBookSources] = useState<ReadingBookSource[]>([]);
  const [selectedSourceId, setSelectedSourceId] = useState<string>("");
  const [editingSource, setEditingSource] = useState(false);
  const [sourceEditName, setSourceEditName] = useState("");
  const [sourceEditGroup, setSourceEditGroup] = useState("");
  const sourceFileInputRef = useRef<HTMLInputElement>(null);

  const [appearance, setAppearance] = useState<ReadingAppearance>(
    DEFAULT_READING_APPEARANCE,
  );
  const [backgroundUrl, setBackgroundUrl] = useState<string | null>(null);
  const [readerBackgroundUrl, setReaderBackgroundUrl] = useState<string | null>(null);
  const [customFontFamily, setCustomFontFamily] = useState<string | undefined>();
  const [customCss, setCustomCss] = useState(DEFAULT_READING_CUSTOM_CSS);

  const backgroundUrlRef = useRef<string | null>(null);
  const readerBackgroundUrlRef = useRef<string | null>(null);
  const customFontUrlRef = useRef<string | null>(null);

  const updateBackgroundUrl = (nextUrl: string | null) => {
    if (
      backgroundUrlRef.current &&
      backgroundUrlRef.current !== nextUrl
    ) {
      URL.revokeObjectURL(backgroundUrlRef.current);
    }
    backgroundUrlRef.current = nextUrl;
    setBackgroundUrl(nextUrl);
  };

  const updateReaderBackgroundUrl = (nextUrl: string | null) => {
    if (readerBackgroundUrlRef.current && readerBackgroundUrlRef.current !== nextUrl) {
      URL.revokeObjectURL(readerBackgroundUrlRef.current);
    }
    readerBackgroundUrlRef.current = nextUrl;
    setReaderBackgroundUrl(nextUrl);
  };

  const loadCustomFontFace = async (blob: Blob | null) => {
    if (customFontUrlRef.current) {
      URL.revokeObjectURL(customFontUrlRef.current);
      customFontUrlRef.current = null;
    }

    setCustomFontFamily(undefined);

    if (!blob || typeof FontFace === "undefined") return;

    const url = URL.createObjectURL(blob);
    customFontUrlRef.current = url;

    const familyName = `AIVirtualPhoneReadingFont_${Date.now()}`;

    try {
      const face = new FontFace(familyName, `url("${url}")`);
      await face.load();
      document.fonts.add(face);
      setCustomFontFamily(`"${familyName}"`);
    } catch {
      setCustomFontFamily(undefined);
    }
  };

  useEffect(() => {
    let cancelled = false;

    hydrateReadingStorage().then(() => {
      if (!cancelled) setReady(true);
    });

    setAppearance(loadReadingAppearance());
    try {
      const savedCss = window.localStorage.getItem(READING_CUSTOM_CSS_KEY);
      if (savedCss !== null) setCustomCss(savedCss);
    } catch {}
    const installed = loadReadingSources();
    try {
      const savedModules = JSON.parse(window.localStorage.getItem("reading-home-modules-v2") || "[]");
      if (Array.isArray(savedModules)) setHomeModules(savedModules);
    } catch {}
    setBookSources(installed);
    const installedIds = new Set(installed.map((item) => item.id));
    let savedHomeSourceIds: string[] | null = null;
    let savedDiscoverySourceIds: string[] | null = null;
    try {
      const homeRaw = JSON.parse(window.localStorage.getItem("reading-home-source-ids-v1") || "null");
      if (Array.isArray(homeRaw)) savedHomeSourceIds = homeRaw.filter((id): id is string => typeof id === "string" && installedIds.has(id));
    } catch {}
    try {
      const discoveryRaw = JSON.parse(window.localStorage.getItem("reading-discovery-source-ids-v1") || "null");
      if (Array.isArray(discoveryRaw)) savedDiscoverySourceIds = discoveryRaw.filter((id): id is string => typeof id === "string" && installedIds.has(id));
    } catch {}
    const defaultHomeSourceIds = installed.filter((item) => !isMangaSource(item)).map((item) => item.id);
    const defaultDiscoverySourceIds = installed.filter((item) => isMangaSource(item)).map((item) => item.id);
    const nextHomeSourceIds = savedHomeSourceIds ?? defaultHomeSourceIds;
    const nextDiscoverySourceIds = savedDiscoverySourceIds ?? defaultDiscoverySourceIds;
    setHomeSourceIds(nextHomeSourceIds);
    setDiscoverySourceIds(nextDiscoverySourceIds);
    try {
      window.localStorage.setItem("reading-home-source-ids-v1", JSON.stringify(nextHomeSourceIds));
      window.localStorage.setItem("reading-discovery-source-ids-v1", JSON.stringify(nextDiscoverySourceIds));
    } catch {}
    const firstNovelSource = installed.find((item) => item.enabled && !isMangaSource(item)) || installed.find((item) => !isMangaSource(item));
    const firstSourceId = firstNovelSource?.id || installed.find((item) => item.enabled)?.id || installed[0]?.id || "";
    setSelectedSourceId(firstSourceId);
    setHomeModuleSourceId(firstNovelSource?.id || firstSourceId);
    const firstMangaSource = installed.find((item) => item.enabled && isMangaSource(item)) || installed.find(isMangaSource);
    setDiscoveryModuleSourceId(firstMangaSource?.id || "");
    let savedModules: unknown[] = [];
    try {
      const rawModules = JSON.parse(window.localStorage.getItem("reading-home-modules-v2") || "[]");
      savedModules = Array.isArray(rawModules) ? rawModules : [];
    } catch {}
    // 首次使用时给一个真正来自发现页的细分榜单示例；之后完全由用户管理。
    const shouldRepairDiscoverModules = savedModules.length > 0 && savedModules.every((item: any) => {
      const url = String(item?.url || "");
      const title = String(item?.title || "");
      return /vossc\.com/i.test(url) && (/女频|男频|榜|快穿|年代|玄幻|都市|分类/.test(title));
    });
    {
      const selected = installed.find(item => item.id === firstSourceId);
      if (selected) {
        const discovered = discoverSourceModules(selected);
        const sourceSaved = savedModules.filter((item: any) => item && item.sourceId === firstSourceId);
        let finalModules = savedModules as HomeModule[];

        if (selected.adapter === "shushan") {
          const byTitle = new Map(discovered.map(item => [item.title, item.url]));
          const isDiscoverTitle = (title: string) => /^(?:女频|男频)(?:阅读榜|新书榜)\s*·/.test(title);
          const repaired = savedModules.map((item: any) => {
            if (!item || typeof item !== "object") return item;
            const title = String(item.title || "");
            const freshUrl = byTitle.get(title);
            if (!freshUrl || !isDiscoverTitle(title) || item.sourceId !== firstSourceId) return item;
            return { ...item, url: freshUrl, enabled: item.enabled !== false };
          });
          const hasDiscover = repaired.some((item: any) => item && item.sourceId === firstSourceId && isDiscoverTitle(String(item.title || "")));
          finalModules = repaired as HomeModule[];
          if (!hasDiscover) {
            const preferred = discovered.find(item => /女频新书榜\s*·\s*快穿/.test(item.title));
            const defaults = discovered.filter(item => /女频(?:阅读榜|新书榜)\s*·/.test(item.title)).slice(0, 4);
            const initial = [preferred, ...defaults].filter((item, i, arr) => item && arr.findIndex(x => x?.url === item.url) === i).slice(0, 5);
            const additions = initial.map((item, i) => ({ id: `${firstSourceId}_discover_${i}`, title: item!.title, url: item!.url, sourceId: firstSourceId, enabled: true }));
            finalModules = [...additions, ...finalModules];
          }
        } else if (discovered.length && sourceSaved.length === 0) {
          const additions = discovered.slice(0, 8).map((item, i) => ({ id: `${firstSourceId}_discover_${i}`, title: item.title, url: item.url, sourceId: firstSourceId, enabled: true }));
          finalModules = [...additions, ...finalModules];
        }

        if (JSON.stringify(finalModules) !== JSON.stringify(savedModules)) {
          setHomeModules(finalModules);
          try { window.localStorage.setItem("reading-home-modules-v2", JSON.stringify(finalModules)); } catch {}
        }
      }
    }

    void loadReadingBackground().then((blob) => {
      if (cancelled) return;
      updateBackgroundUrl(blob ? URL.createObjectURL(blob) : null);
    });

    void loadReadingReaderBackground().then((blob) => {
      if (cancelled) return;
      updateReaderBackgroundUrl(blob ? URL.createObjectURL(blob) : null);
    });

    void loadReadingCustomFont().then((blob) => {
      if (cancelled) return;
      void loadCustomFontFace(blob);
    });

    return () => {
      cancelled = true;

      if (backgroundUrlRef.current) {
        URL.revokeObjectURL(backgroundUrlRef.current);
      }
      if (readerBackgroundUrlRef.current) {
        URL.revokeObjectURL(readerBackgroundUrlRef.current);
      }

      if (customFontUrlRef.current) {
        URL.revokeObjectURL(customFontUrlRef.current);
      }
    };
  }, []);

  // 进入书源页时不要主动唤起 iOS 键盘；搜索框仅在用户主动点击时获得焦点。
  useEffect(() => {
    if (tab !== "sources") return;
    const active = document.activeElement;
    if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
      active.blur();
    }
  }, [tab]);

  const handleSaveAppearance = async (
    nextAppearance: ReadingAppearance,
    options: {
      backgroundFile: File | null;
      clearBackground: boolean;
      readerBackgroundFile?: File | null;
      clearReaderBackground?: boolean;
      customFontFile: File | null;
      clearCustomFont: boolean;
    },
  ) => {
    const normalized = saveReadingAppearance(nextAppearance);
    setAppearance(normalized);

    if (options.clearBackground) {
      await saveReadingBackground(null);
      updateBackgroundUrl(null);
    } else if (options.backgroundFile) {
      await saveReadingBackground(options.backgroundFile);
      updateBackgroundUrl(URL.createObjectURL(options.backgroundFile));
    }

    if (options.clearReaderBackground) {
      await saveReadingReaderBackground(null);
      updateReaderBackgroundUrl(null);
    } else if (options.readerBackgroundFile) {
      await saveReadingReaderBackground(options.readerBackgroundFile);
      updateReaderBackgroundUrl(URL.createObjectURL(options.readerBackgroundFile));
    }

    if (options.clearCustomFont) {
      await saveReadingCustomFont(null);
      await loadCustomFontFace(null);
    } else if (options.customFontFile) {
      await saveReadingCustomFont(options.customFontFile);
      await loadCustomFontFace(options.customFontFile);
    }
  };

  const persistSourceSet = (kind: "home" | "discovery", ids: string[]) => {
    const unique = [...new Set(ids)];
    if (kind === "home") setHomeSourceIds(unique);
    else setDiscoverySourceIds(unique);
    try {
      window.localStorage.setItem(kind === "home" ? "reading-home-source-ids-v1" : "reading-discovery-source-ids-v1", JSON.stringify(unique));
    } catch {}
  };

  const sourceIdsForDrawer = sourceDrawerMode === "home" ? homeSourceIds : sourceDrawerMode === "discovery" ? discoverySourceIds : bookSources.map((source) => source.id);
  const drawerSources = bookSources.filter((source) => {
    if (!sourceIdsForDrawer.includes(source.id)) return false;
    if (sourceDrawerMode === "home") return !isMangaSource(source);
    if (sourceDrawerMode === "discovery") return isMangaSource(source);
    return true;
  });
  const openSourceDrawer = (mode: "home" | "discovery" | "search") => {
    setSourceDrawerMode(mode);
    setSourceImportTarget(mode);
    if (mode === "home" && !homeModuleSourceId) {
      const first = bookSources.find((source) => homeSourceIds.includes(source.id)) || bookSources.find((source) => source.enabled && !isMangaSource(source)) || bookSources.find((source) => !isMangaSource(source));
      if (first) setHomeModuleSourceId(first.id);
    }
    if (mode === "discovery" && !discoveryModuleSourceId) {
      const first = bookSources.find((source) => discoverySourceIds.includes(source.id)) || bookSources.find(isMangaSource);
      if (first) setDiscoveryModuleSourceId(first.id);
    }
    setSourceDrawerOpen(true);
  };

  const appearanceStyle = {
    "--reading-font-family": resolveReadingFontFamily(
      appearance.fontFamily,
      customFontFamily,
    ),
    "--reading-user-font-size": `${appearance.fontSize}px`,
    "--reading-user-text-color": appearance.textColor,
    "--reading-user-line-height": String(appearance.lineHeight),
    "--reading-bg-image": backgroundUrl
      ? `url("${backgroundUrl}")`
      : "none",
    "--reading-function-bg-image": backgroundUrl ? `url("${backgroundUrl}")` : "none",
    "--reading-viewer-bg-image": readerBackgroundUrl ? `url("${readerBackgroundUrl}")` : "none",
  } as CSSProperties;

  const saveCustomCss = (value: string) => {
    setCustomCss(value);
    try { window.localStorage.setItem(READING_CUSTOM_CSS_KEY, value); } catch {}
  };

  const resetCustomCss = () => {
    saveCustomCss(DEFAULT_READING_CUSTOM_CSS);
  };

  const persistHomeModules = (next: HomeModule[]) => {
    setHomeModules(next);
    try { window.localStorage.setItem("reading-home-modules-v2", JSON.stringify(next)); } catch {}
  };

  const downloadCoverForBook = async (bookId: string, coverUrl?: string) => {
    const url = normalizeRemoteUrl(coverUrl);
    if (!/^https?:\/\//i.test(url)) return false;
    try {
      const response = await fetch("/api/reading/source", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, asset: true, timeoutMs: 15000 }),
      });
      if (!response.ok) return false;
      const blob = await response.blob();
      if (!blob.size || blob.size > 8 * 1024 * 1024) return false;
      await saveCover(bookId, blob);
      return true;
    } catch {
      // 某些书源封面服务器会拒绝服务端抓取；书架仍保留 coverUrl，避免“TXT 无封面”。
      return false;
    }
  };

  const openHomeBookDetail = async (module: HomeModule, book: GenericSourceBook) => {
    const source = bookSources.find((item) => item.id === module.sourceId);
    if (!source) {
      setHomeDetailMessage("书源不存在");
      return;
    }

    setHomeDetailOpen(true);
    setHomeDetailBook(null);
    setHomeDetailChapters([]);
    setHomeDetailMessage("");
    setHomeDetailLoading(true);

    try {
      if (source.adapter !== "shushan") {
        // 非书山榜单也保持独立详情页，不跳转到书源搜索页。
        const detail = await getGenericDetail(source, book);
        const chapters = await getGenericCatalog(source, detail);
        const converted: ShushanSearchBook = {
          title: detail.title || book.title,
          author: detail.author || book.author,
          cover: normalizeRemoteUrl(detail.cover || book.cover, detail.bookUrl || book.bookUrl),
          desc: detail.desc || book.desc,
          source: source.name,
          book_url: detail.bookUrl || book.bookUrl,
          wordCount: detail.wordCount,
          tags: detail.tags,
        };
        setHomeDetailBook(converted);
        setHomeDetailChapters(chapters.map((c) => ({
          title: c.title,
          url: c.url,
          isPay: c.isPay,
          isVip: c.isVip,
          isVolume: c.isVolume,
          cid: c.cid,
        })));
        return;
      }

      const raw = book.raw && typeof book.raw === "object" ? book.raw as Record<string, unknown> : {};
      const bid = String(book.bookId || raw.book_id_str || raw.book_id || raw.bookId || "").trim();
      const rawSource = String(book.source || raw.source || raw.source_name || raw.book_source || "").trim();
      const inferredSource = /^\d{19}$/.test(bid) ? "番茄小说" : rawSource;
      const shushanItem: ShushanSearchBook = {
        ...raw,
        title: book.title,
        author: book.author,
        cover: book.cover,
        desc: book.desc,
        source: inferredSource,
        book_url: String(book.bookUrl || raw.book_url || raw.bookUrl || raw.detail_url || raw.detailUrl || raw.url || ""),
        latestChapterTitle: book.latestChapterTitle,
        wordCount: book.wordCount,
        tags: book.tags,
        bookid: bid || undefined,
        book_id: bid || undefined,
        bookId: bid || undefined,
      };

      const account = loadShushanAccount();
      if (!account.apiKey) throw new Error("请先在书源中登录书山聚合");

      let detail: ShushanSearchBook;
      if (/^\d{19}$/.test(bid)) {
        const info = await getShushanBookInfo(account.apiKey, bid);
        const infoData = Array.isArray(info.data)
          ? (info.data[0] || {})
          : ((info.data && typeof info.data === "object") ? info.data : {});
        const fanqieUrl = `https://api5-normal-sinfonlineb.fqnovel.com/reading/bookapi/multi-detail/v/?aid=1967&iid=1&version_code=999&book_id=${encodeURIComponent(bid)}`;
        detail = ({
          ...shushanItem,
          ...infoData,
          source: String((infoData as any)?.source || "番茄小说"),
          book_url: String((infoData as any)?.book_url || (infoData as any)?.url || fanqieUrl),
          bookid: String((infoData as any)?.bookid || (infoData as any)?.book_id || (infoData as any)?.bookId || bid),
        } as ShushanSearchBook);
      } else {
        const result = await getShushanDetail(account.apiKey, shushanItem);
        detail = ({
          ...shushanItem,
          ...(result.data || {}),
          source: String((result.data as any)?.source || shushanItem.source),
          book_url: String((result.data as any)?.book_url || (result.data as any)?.url || shushanItem.book_url),
          bookid: String((result.data as any)?.bookid || (result.data as any)?.book_id || (result.data as any)?.bookId || shushanItem.bookid || ""),
        } as ShushanSearchBook);
      }

      const catalog = await getShushanCatalog(account.apiKey, detail);
      const chapters = Array.isArray(catalog.data) ? catalog.data : [];
      setHomeDetailBook(detail);
      setHomeDetailChapters(chapters);
    } catch (error) {
      setHomeDetailMessage(error instanceof Error ? error.message : "打开书籍失败");
    } finally {
      setHomeDetailLoading(false);
    }
  };

  const closeHomeBookDetail = () => {
    setHomeDetailOpen(false);
    setHomeDetailBook(null);
    setHomeDetailChapters([]);
    setHomeDetailMessage("");
  };

  const saveHomeDetailBook = async (mode: "shelf" | "read") => {
    if (!homeDetailBook) return;
    const chapters = homeDetailChapters.filter((chapter) => !chapter.isVolume);
    if (!chapters.length) {
      setHomeDetailMessage("目录暂时没有加载成功，无法加入书架");
      return;
    }

    const title = homeDetailBook.title || homeDetailBook.name || "未命名";
    const author = homeDetailBook.author || "未知作者";
    const cover = normalizeRemoteUrl(homeDetailBook.cover, homeDetailBook.book_url);
    const id = `shushan_${Date.now()}`;
    const coverSaved = false;
    void downloadCoverForBook(id, cover);
    const book: Book = {
      id,
      title,
      author,
      format: "txt",
      totalChapters: chapters.length,
      createdAt: new Date().toISOString(),
      hasCover: coverSaved,
      coverUrl: cover,
    } as Book & { coverUrl?: string };

    await addBook(book);
    await saveChapters(id, chapters.map((chapter, index) => ({
      id: `${id}_ch${index}`,
      bookId: id,
      index,
      title: chapter.title || `第${index + 1}章`,
      paragraphs: [],
    })));
    const rawBookId = homeDetailBook.bookid ?? homeDetailBook.book_id ?? homeDetailBook.bookId;
    saveRemoteBook(id, {
      source: homeDetailBook.source || "书山聚合",
      url: homeDetailBook.book_url,
      name: title,
      apiKey: loadShushanAccount().apiKey,
      bookId: rawBookId == null ? "" : String(rawBookId),
      cover,
      desc: homeDetailBook.desc,
      chapters,
    });

    if (mode === "read") {
      setActiveBook(book);
      closeHomeBookDetail();
    } else {
      setHomeDetailMessage("✅ 已加入书架");
    }
  };

  const refreshHomeModule = async (module: HomeModule) => {
    setHomeModuleLoading(module.id);
    try {
      const source = bookSources.find((item) => item.id === module.sourceId);
      if (!source) throw new Error("书源不存在");
      let parsed: unknown;
      if (source.adapter === "shushan" && /vossc\.com\/style_top|vossc\.com\/type_style/i.test(module.url)) {
        const account = loadShushanAccount();
        if (!account.apiKey) throw new Error("书山聚合需要先登录账号，请在书源页面完成登录");
        const response = await fetch("/api/reading/shushan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "module", apiKey: account.apiKey, moduleUrl: module.url, host: source.url }),
        });
        const data = await response.json().catch(() => null);
        if (!response.ok || !data?.ok) throw new Error(data?.error || `榜单请求失败（${response.status}）`);
        parsed = data.data;
      } else {
        parsed = await fetchReadingSourceModule(source, module.url, 1);
      }
      const books = extractHomeBooks(parsed);
      setHomeModuleData((prev) => ({ ...prev, [module.id]: books }));
      if (!books.length) throw new Error("榜单接口已返回，但没有识别到书籍数据");
    } catch (error) {
      setHomeModuleData((prev) => ({ ...prev, [module.id]: [] }));
      setSourceMessage(error instanceof Error ? error.message : "首页模块加载失败");
    } finally {
      setHomeModuleLoading(null);
    }
  };

  const refreshDiscoveryModule = async (module: HomeModule) => {
    setHomeModuleLoading(module.id);
    try {
      const source = bookSources.find((item) => item.id === module.sourceId);
      if (!source) throw new Error("发现页书源不存在");
      if (sourceReaderType(source) !== "manga") throw new Error("发现页仅支持漫画书源");
      const parsed = await fetchReadingSourceModule(source, module.url, 1);
      const books = extractHomeBooks(parsed);
      setHomeModuleData((prev) => ({ ...prev, [module.id]: books }));
      if (!books.length) throw new Error("漫画发现接口已返回，但没有识别到漫画数据");
    } catch (error) {
      setHomeModuleData((prev) => ({ ...prev, [module.id]: [] }));
      setSourceMessage(error instanceof Error ? error.message : "发现模块加载失败");
    } finally {
      setHomeModuleLoading(null);
    }
  };

  const extractHomeBooks = (value: unknown): GenericSourceBook[] => {
    let normalized: any = value;
    for (let i = 0; i < 3 && typeof normalized === "string"; i += 1) {
      try { normalized = JSON.parse(normalized); } catch { break; }
    }
    const list: GenericSourceBook[] = [];
    const seen = new Set<string>();
    const visit = (v: any, depth = 0) => {
      if (depth > 6 || v == null) return;
      if (Array.isArray(v)) { for (const item of v) visit(item, depth + 1); return; }
      if (typeof v !== "object") return;
      const title = v.title ?? v.book_name ?? v.bookName ?? v.name ?? v.book_title ?? v.novel_name ?? v.original_book_name;
      const bookId = String(v.book_id_str ?? v.book_id ?? v.bookId ?? v.series_id ?? "");
      const rawBookUrl = v.book_url ?? v.bookUrl ?? v.detail_url ?? v.detailUrl ?? v.url ?? "";
      const bookUrl = String(rawBookUrl || "");
      if (title && (bookUrl || bookId || v.author || v.author_name || v.cover || v.cover_url || v.image_url || v.thumb_url || v.thumbUri || v.audio_thumb_uri)) {
        const key = `${String(title)}|${String(bookUrl)}|${bookId}`;
        if (!seen.has(key)) {
          seen.add(key);
          list.push({
            title: String(title),
            author: v.author ?? v.author_name,
            cover: normalizeRemoteUrl(v.cover ?? v.cover_url ?? v.image_url ?? v.book_cover ?? v.thumb_url ?? v.thumbUri ?? v.audio_thumb_uri),
            desc: v.desc ?? v.abstract ?? v.description,
            latestChapterTitle: v.latest_chapter_title ?? v.latestChapterTitle ?? v.last_chapter_title,
            wordCount: v.word_number ?? v.WordsCount ?? v.wordCount,
            tags: v.tags ?? v.kind,
            source: v.source ?? v.source_name ?? v.book_source ?? v.origin,
            bookId: String(v.book_id_str ?? v.book_id ?? v.bookId ?? "") || undefined,
            bookUrl: String(bookUrl),
            raw: v,
          });
        }
      }
      for (const item of Object.values(v)) if (item && typeof item === "object") visit(item, depth + 1);
    };
    visit(normalized);
    return list.slice(0, 20);
  };

  // 发现页与首页彻底分源：楠楠漫画只在发现页出现，并首次安装后自动生成它自己的发现模块。
  useEffect(() => {
    if (!ready || !bookSources.length) return;
    const mangaSource = bookSources.find((item) => item.enabled && isMangaSource(item)) || bookSources.find(isMangaSource);
    if (!mangaSource) return;
    const discovered = discoverSourceModules(mangaSource);
    if (!discovered.length) return;
    setHomeModules((current) => {
      const existing = new Set(current.filter((item) => item.sourceId === mangaSource.id).map((item) => `${item.title}|${item.url}`));
      const additions = discovered.filter((item) => !existing.has(`${item.title}|${item.url}`)).map((item, index) => ({
        id: `${mangaSource.id}_discovery_${index}_${Date.now()}`,
        title: item.title,
        url: item.url,
        sourceId: mangaSource.id,
        enabled: true,
      }));
      if (!additions.length) return current;
      const next = [...current, ...additions];
      try { window.localStorage.setItem("reading-home-modules-v2", JSON.stringify(next)); } catch {}
      return next;
    });
  }, [ready, bookSources]);

  useEffect(() => {
    if (!ready || !homeModules.length || !bookSources.length) return;
    // 首页自动加载小说模块；漫画模块由发现页单独加载。
    const pending = homeModules.filter((module) => {
      const source = bookSources.find((item) => item.id === module.sourceId);
      return module.enabled && !!source && !isMangaSource(source) && homeModuleData[module.id] === undefined;
    });
    if (!pending.length) return;
    void Promise.all(pending.map((module) => refreshHomeModule(module)));
    // 只在模块数据尚未存在时自动首刷；手动刷新仍由右侧按钮触发。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, homeModules, bookSources]);

  // 进入独立发现页后自动加载首个尚未加载的模块。
  // 必须放在 ReadingApp 内，不能放进 NavButton，否则会访问不到页面状态。
  useEffect(() => {
    if (tab !== "discovery" || homeModuleLoading) return;
    const pending = homeModules.find((module) => {
      const source = bookSources.find((item) => item.id === module.sourceId);
      return module.enabled && isMangaSource(source) && !homeModuleData[module.id];
    });
    if (pending) void refreshDiscoveryModule(pending);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, homeModules, homeModuleData, homeModuleLoading]);

  if (!ready) {
    return (
      <div
        className="absolute inset-0 z-[100] flex items-center justify-center"
        style={{ background: "#fffced" }}
      >
        <span className="ts-14" style={{ color: "#a39487" }}>
          加载中...
        </span>
      </div>
    );
  }

  return (
    <div
      className={`reading-app-surface reading-hub-root${activeBook ? " is-viewing" : ""}`}
      style={appearanceStyle}
    >
      <style data-reading-custom-css>{customCss.replace(/<\/style/gi, "<\\/style")}</style>
      {activeBook ? (
        <div className="reading-hub-viewer">
          <ReadingViewer
            book={activeBook}
            onBack={() => setActiveBook(null)}
          />
        </div>
      ) : homeDetailOpen ? (
        <div className="reading-hub-home-detail-page">
          <button type="button" className="reading-hub-backlink" onClick={closeHomeBookDetail}>← 返回排行榜</button>
          {!homeDetailBook ? (
            <div className="reading-hub-source-loading">{homeDetailLoading ? "正在获取书籍详情与目录…" : (homeDetailMessage || "暂时无法打开这本书")}</div>
          ) : (
          <div className="reading-discovery-detail-card" style={homeDetailBook.cover ? { backgroundImage: `linear-gradient(180deg, rgba(255,250,247,.62), rgba(255,250,247,.96) 58%, rgba(255,250,247,.99)), url("${normalizeRemoteUrl(homeDetailBook.cover, homeDetailBook.book_url)}")` } : undefined}>
            <div className="reading-discovery-detail-content">
              <div className="reading-discovery-book-head">
                <div className="reading-discovery-cover">{homeDetailBook.cover ? <img src={normalizeRemoteUrl(homeDetailBook.cover, homeDetailBook.book_url)} alt="" /> : <BookOpen size={32} />}</div>
                <div className="reading-discovery-book-main"><h2>{homeDetailBook.title || homeDetailBook.name || "未命名"}</h2><p>{homeDetailBook.author || "未知作者"}</p><span>📚 {homeDetailBook.source || "书山聚合"}</span></div>
              </div>
              <div className="reading-discovery-meta-grid">
                <div><small>标签</small><strong>{detailTags(homeDetailBook)}</strong></div>
                <div><small>评分</small><strong>{detailRating(homeDetailBook)}</strong></div>
                <div><small>状态</small><strong>{detailStatus(homeDetailBook)}</strong></div>
                <div><small>最近更新</small><strong>{detailUpdatedAt(homeDetailBook) || "暂无"}</strong></div>
                <div><small>全书字数</small><strong>{detailWordCount(homeDetailBook)}</strong></div>
                <div><small>章节</small><strong>{homeDetailChapters.filter((x) => !x.isVolume).length} 章</strong></div>
              </div>
              <section className="reading-discovery-intro"><h3>简介</h3><p>{homeDetailBook.desc || "暂无简介"}</p></section>
              {homeDetailMessage && <div className="reading-hub-source-help">{homeDetailMessage}</div>}
              <div className="reading-discovery-actions reading-discovery-actions--compact">
                <button type="button" disabled={homeDetailLoading || !homeDetailChapters.some((x) => !x.isVolume)} onClick={() => void saveHomeDetailBook("shelf")}><span>🔖</span>加入书架</button>
                <button type="button" disabled={homeDetailLoading || !homeDetailChapters.some((x) => !x.isVolume)} onClick={() => void saveHomeDetailBook("read")}><span>▣</span>开始阅读</button>
                <button type="button" onClick={() => setHomeDetailMessage(`目录共 ${homeDetailChapters.filter((x) => !x.isVolume).length} 章`)}><span>☷</span>查看目录</button>
              </div>
              {homeDetailLoading && <div className="reading-hub-source-loading">正在获取书籍详情与目录…</div>}
              {!homeDetailLoading && homeDetailChapters.length > 0 && <div className="reading-hub-chapter-list">{homeDetailChapters.filter((x) => !x.isVolume).slice(0, 120).map((chapter, index) => <div key={`${chapter.title}-${index}`}><span>{chapter.title || `第${index + 1}章`}</span>{(chapter.isPay || chapter.isVip) && <em>付费</em>}</div>)}</div>}
            </div>
          </div>
          )}
        </div>
      ) : (
        <>
          <header className="reading-hub-topbar">
            <div>
              <div className="reading-hub-kicker">READING</div>
              <h1>{getTitle(tab)}</h1>
            </div>
          </header>

          <main className="reading-hub-content">
            {tab === "home" && (
              <section className="reading-hub-home">
                {(selectedSourceBook && sourceDetail) || (genericBook && genericDetail) ? (
                  <div className="reading-hub-discovery-detail">
                    <button type="button" className="reading-hub-backlink" onClick={() => { setSelectedSourceBook(null); setSourceDetail(null); setSourceChapters([]); setGenericBook(null); setGenericDetail(null); setGenericChapters([]); setSourceMessage(""); }}>← 返回发现页</button>
                    {selectedSourceBook && sourceDetail ? (() => {
                      const cover = normalizeRemoteUrl(sourceDetail.cover || selectedSourceBook.cover, sourceDetail.book_url);
                      const title = sourceDetail.title || selectedSourceBook.title || "未命名";
                      const author = sourceDetail.author || selectedSourceBook.author || "未知作者";
                      const desc = sourceDetail.desc || selectedSourceBook.desc || "暂无简介";
                      const tags = detailTags(sourceDetail);
                      const rating = detailRating(sourceDetail);
                      const status = detailStatus(sourceDetail);
                      const updatedAt = detailUpdatedAt(sourceDetail) || detailUpdatedAt(selectedSourceBook) || "暂无";
                      const wordCount = detailWordCount(sourceDetail);
                      const chapterCount = sourceChapters.filter(x => !x.isVolume).length;
                      const openRemoteBook = async () => {
                        if (!chapterCount) {
                          setSourceMessage("目录还没有加载成功，请先刷新发现页后重试");
                          return;
                        }
                        const id = `shushan_${Date.now()}`;
                        const chapters = sourceChapters.filter(x => !x.isVolume);
                        const coverSaved = false;
                        void downloadCoverForBook(id, cover);
                        const rawBookId = (sourceDetail as any).bookid ?? (sourceDetail as any).book_id ?? (sourceDetail as any).bookId ?? (selectedSourceBook as any).bookid ?? (selectedSourceBook as any).book_id ?? (selectedSourceBook as any).bookId;
                        const bookId = rawBookId == null ? "" : String(rawBookId);
                        const book: Book = { id, title, author, format: "txt", readerType: sourceReaderType(source), totalChapters: chapters.length, createdAt: new Date().toISOString(), hasCover: coverSaved, coverUrl: cover } as Book & { coverUrl?: string };
                        await addBook(book);
                        await saveChapters(id, chapters.map((c, i) => ({ id: `${id}_ch${i}`, bookId: id, index: i, title: c.title || `第${i + 1}章`, paragraphs: [] as string[] })));
                        saveRemoteBook(id, { source: sourceDetail.source, url: sourceDetail.book_url, name: title, apiKey: loadShushanAccount().apiKey, bookId, cover, desc, chapters });
                        setActiveBook(book);
                      };
                      return (
                        <div className="reading-discovery-detail-card" style={cover ? { backgroundImage: `linear-gradient(180deg, rgba(255,250,247,.58), rgba(255,250,247,.93) 54%, rgba(255,250,247,.99)), url("${cover}")` } : undefined}>
                          <div className="reading-discovery-detail-content">
                            <div className="reading-discovery-book-head">
                              <div className="reading-discovery-cover">{cover ? <img src={cover} alt="" /> : <BookOpen size={32} />}</div>
                              <div className="reading-discovery-book-main"><h2>{title}</h2><p>{author}</p><span>📚 {sourceDetail.source || selectedSourceBook.source || "书山聚合"}</span></div>
                            </div>
                            <div className="reading-discovery-meta-grid">
                              <div><small>标签</small><strong>{tags}</strong></div>
                              <div><small>评分</small><strong>{rating}</strong></div>
                              <div><small>状态</small><strong>{status}</strong></div>
                              <div><small>最近更新</small><strong>{updatedAt}</strong></div>
                              <div><small>全书字数</small><strong>{wordCount}</strong></div>
                              <div><small>章节</small><strong>{chapterCount} 章</strong></div>
                            </div>
                            <section className="reading-discovery-intro">
                              <h3>简介</h3>
                              <p>{desc}</p>
                            </section>
                            <div className="reading-discovery-actions reading-discovery-actions--compact">
                              <button type="button" onClick={openRemoteBook}><span>🔖</span>放入书架</button>
                              <button type="button" onClick={() => setSourceMessage(`目录共 ${chapterCount} 章`)}><span>☷</span>查看目录</button>
                              <button type="button" onClick={() => setSourceDrawerOpen(true)}><span>&lt;&gt;</span>书源</button>
                              <button type="button" onClick={() => setSourceMessage("阅读记录会在开始阅读后自动保存") }><span>⌁</span>阅读记录</button>
                            </div>
                            <div className="reading-discovery-current">
                              <strong>在读 · 第1章 {sourceChapters[0]?.title || "暂无章节"}</strong>
                              <span>共 {chapterCount} 章</span>
                            </div>
                            <section className="reading-discovery-intro reading-discovery-intro--source">
                              <h3>来源信息</h3>
                              <p>源站：{sourceDetail.source || selectedSourceBook.source || "书山聚合"}</p>
                              <p>作者：{author}</p>
                            </section>
                            <button type="button" className="reading-hub-primary reading-discovery-read" disabled={!chapterCount || sourceLoading} onClick={openRemoteBook}>▣ 阅读</button>
                          </div>
                        </div>
                      );
                    })() : genericBook && genericDetail ? (
                      <div className="reading-discovery-book-card"><div className="reading-discovery-book-head"><div className="reading-discovery-cover">{genericDetail.cover||genericBook.cover?<img src={genericDetail.cover||genericBook.cover} alt=""/>:<BookOpen size={32}/>}</div><div className="reading-discovery-book-main"><h2>{genericDetail.title}</h2><p>{genericDetail.author||"未知作者"}</p><span>📚 {bookSources.find(x=>x.id===selectedSourceId)?.name||"书源"}</span></div></div><div className="reading-discovery-stats"><div><small>标签</small><strong>{genericDetail.tags||"—"}</strong></div><div><small>字数</small><strong>{genericDetail.wordCount||"—"}</strong></div><div><small>状态</small><strong>连载</strong></div><div><small>章节</small><strong>{genericChapters.length}章</strong></div></div><div className="reading-discovery-source"><p>📝 简介：{genericDetail.desc||"暂无简介"}</p></div></div>
                    ) : null}
                  </div>
                ) : (
                <>
                <button type="button" className="reading-hub-desktop-back" onClick={onClose}>
                  ← 返回桌面
                </button>
                <div className="reading-hub-section"><div className="reading-hub-section-head"><div><h2>排行榜</h2><p>首页管理小说书源，和发现页漫画源完全分开。</p></div><button type="button" className="reading-hub-icon-btn" onClick={() => openSourceDrawer("home")} aria-label="管理首页书源"><MoreVertical size={20} /></button></div>
                  <div className="reading-hub-module-list">{homeModules.filter(x=>x.enabled && homeSourceIds.includes(x.sourceId) && !isMangaSource(bookSources.find(source => source.id === x.sourceId))).map(module=><div key={module.id} className="reading-hub-module"><div className="reading-hub-module-head"><strong>{module.title}</strong><div className="reading-hub-module-actions"><button type="button" title="上移" onClick={()=>{const i=homeModules.findIndex(x=>x.id===module.id);if(i>0){const next=[...homeModules];[next[i-1],next[i]]=[next[i],next[i-1]];persistHomeModules(next);}}}>↑</button><button type="button" title="下移" onClick={()=>{const i=homeModules.findIndex(x=>x.id===module.id);if(i>=0&&i<homeModules.length-1){const next=[...homeModules];[next[i],next[i+1]]=[next[i+1],next[i]];persistHomeModules(next);}}}>↓</button><button type="button" title="删除" onClick={()=>{persistHomeModules(homeModules.filter(x=>x.id!==module.id));setHomeModuleData(prev=>{const copy={...prev};delete copy[module.id];return copy;});}}>×</button><button type="button" title="刷新" onClick={() => { void refreshHomeModule(module); }}>{homeModuleLoading===module.id?<RefreshCw size={14} className="reading-spin"/>:<RefreshCw size={14}/>}</button></div></div>{homeModuleLoading===module.id&&!homeModuleData[module.id]&&<div className="reading-hub-module-empty">正在加载…</div>}{homeModuleData[module.id]?.length>0&&<div className="reading-hub-module-grid">{homeModuleData[module.id].map((book,i)=><button key={`${book.title}-${i}`} type="button" onClick={() => { void openHomeBookDetail(module, book); }}><div className="reading-hub-module-cover">{book.cover?<img src={book.cover} alt=""/>:<BookOpen size={19}/>}</div><strong>{book.title}</strong><small>{book.author||"未知作者"}</small></button>)}</div>}{!homeModuleData[module.id]&&<div className="reading-hub-module-empty">点击右侧刷新加载</div>}</div>)}</div>
                </div>
                </>
                )}
              </section>
            )}

            {tab === "discovery" && (
              <section className="reading-hub-discovery-page">
                <div className="reading-hub-search-hero">
                  <div>
                    <span>DISCOVER</span>
                    <h2>发现漫画</h2>
                    <p>{homeModules.filter(x => x.enabled && discoverySourceIds.includes(x.sourceId) && isMangaSource(bookSources.find(source => source.id === x.sourceId))).length} 个漫画发现模块 · 来自楠楠漫画</p>
                  </div>
                  <button type="button" className="reading-hub-icon-btn" onClick={() => openSourceDrawer("discovery")} aria-label="管理发现模块">
                    <MoreVertical size={20} />
                  </button>
                </div>
                {homeModules.filter(x => x.enabled && discoverySourceIds.includes(x.sourceId) && isMangaSource(bookSources.find(source => source.id === x.sourceId))).length === 0 ? (
                  <div className="reading-hub-section reading-hub-discovery-empty">
                    <Compass size={28} />
                    <strong>还没有发现内容</strong>
                    <span>打开右上角书源管理，从当前书源的发现页添加榜单或分类。</span>
                  </div>
                ) : (
                  <div className="reading-hub-discovery-modules">
                    {homeModules.filter(x => x.enabled && discoverySourceIds.includes(x.sourceId) && isMangaSource(bookSources.find(source => source.id === x.sourceId))).map(module => (
                      <section key={module.id} className="reading-hub-module">
                        <div className="reading-hub-module-head">
                          <strong>{module.title}</strong>
                          <button type="button" onClick={() => { void refreshDiscoveryModule(module); }} disabled={homeModuleLoading === module.id}>
                            {homeModuleLoading === module.id ? <RefreshCw size={14} className="reading-spin" /> : <RefreshCw size={14} />}
                          </button>
                        </div>
                        {homeModuleData[module.id]?.length ? (
                          <div className="reading-hub-module-grid">
                            {homeModuleData[module.id].map((book, i) => (
                              <button key={`${book.bookUrl}-${i}`} type="button" onClick={() => { void openHomeBookDetail(module, book); }}>
                                <div className="reading-hub-module-cover">{book.cover ? <img src={normalizeRemoteUrl(book.cover, book.bookUrl)} alt="" /> : <BookOpen size={19} />}</div>
                                <strong>{book.title}</strong>
                                <small>{book.author || "未知作者"}</small>
                              </button>
                            ))}
                          </div>
                        ) : (
                          <button type="button" className="reading-hub-module-empty" onClick={() => { void refreshDiscoveryModule(module); }} disabled={homeModuleLoading === module.id}>
                            {homeModuleLoading === module.id ? "正在加载…" : "点击加载发现内容"}
                          </button>
                        )}
                      </section>
                    ))}
                  </div>
                )}
              </section>
            )}

            {tab === "shelf" && (
              <section className="reading-hub-shelf-wrap">
                <ReadingShelf
                  onOpenBook={setActiveBook}
                  onClose={onClose}
                  appearance={appearance}
                  backgroundUrl={backgroundUrl}
                  onSaveAppearance={handleSaveAppearance}
                />
              </section>
            )}

            {tab === "sources" && (
              <section className="reading-hub-search-page">
                <div className="reading-hub-search-hero">
                  <div>
                    <span>BOOK SEARCH</span>
                    <h2>搜索你想看的书</h2>
                    <p>{bookSources.filter((item) => item.enabled).length} 个已启用书源 · 结果优先展示</p>
                  </div>
                  <button type="button" className="reading-hub-icon-btn" onClick={() => openSourceDrawer("search")} aria-label="书源管理">
                    <MoreVertical size={20} />
                  </button>
                </div>

                <div className="reading-hub-source-pills">
                  <button type="button" className={!sourceFilter ? "is-active" : ""} onClick={() => setSourceFilter("")}>全部书源</button>
                  {bookSources.filter((item) => item.enabled).map((source) => (
                    <button key={source.id} type="button" className={sourceFilter === source.id ? "is-active" : ""} onClick={() => setSourceFilter(source.id)}>{source.name}</button>
                  ))}
                </div>

                <div className="reading-hub-big-searchbox">
                  <Search size={21} />
                  <input value={sourceKeyword} onChange={(e) => setSourceKeyword(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") (e.currentTarget.parentElement?.querySelector("button") as HTMLButtonElement | null)?.click(); }} placeholder="输入书名、作者，或 书名@来源" />
                  <button type="button" disabled={sourceLoading || !sourceKeyword.trim()} onClick={async () => {
                    setSourceLoading(true); setSourceMessage(""); setGenericResults([]); setSourceResults([]);
                    setSelectedSourceBook(null); setGenericBook(null); setSourceDetail(null); setGenericDetail(null); setSourceChapters([]); setGenericChapters([]);
                    try {
                      const raw = sourceKeyword.trim();
                      const [keywordPart, inlineSource] = raw.split("@");
                      const keyword = keywordPart.trim();
                      let targets = bookSources.filter((item) => item.enabled);
                      if (sourceFilter) targets = targets.filter((item) => item.id === sourceFilter);
                      if (inlineSource?.trim()) {
                        const needle = inlineSource.trim().toLowerCase();
                        targets = targets.filter((item) => item.name.toLowerCase().includes(needle) || item.url.toLowerCase().includes(needle));
                      }
                      const account = loadShushanAccount();
                      const shushanTargets = targets.filter((item) => isShushanSource(item));
                      const genericTargets = targets.filter((item) => !isShushanSource(item));
                      const [shushanSettled, genericSettled] = await Promise.all([
                        account.apiKey && shushanTargets.length
                          ? Promise.allSettled(shushanTargets.map(async (source) => ({ sourceId: source.id, items: (await searchShushan(account.apiKey, keyword, inlineSource?.trim() || "", 1)).data || [] })))
                          : Promise.resolve([] as PromiseSettledResult<{ sourceId: string; items: ShushanSearchBook[] }>[]) ,
                        genericTargets.length
                          ? Promise.allSettled(genericTargets.map(async (source) => ({ sourceId: source.id, items: await searchGenericSource(source, keyword, 1) })))
                          : Promise.resolve([] as PromiseSettledResult<{ sourceId: string; items: GenericSourceBook[] }>[])
                      ]);
                      const shushanResults: ShushanSearchBook[] = [];
                      const genericResultsMerged: GenericSourceBook[] = [];
                      let failures = 0;
                      for (const result of shushanSettled) {
                        if (result.status === "fulfilled") for (const item of result.value.items) shushanResults.push({ ...item, _readingSourceId: result.value.sourceId } as ShushanSearchBook);
                        else failures++;
                      }
                      for (const result of genericSettled) {
                        if (result.status === "fulfilled") for (const item of result.value.items) genericResultsMerged.push({ ...item, _readingSourceId: result.value.sourceId } as GenericSourceBook);
                        else failures++;
                      }
                      setSourceResults(shushanResults);
                      setGenericResults(genericResultsMerged);
                      const total = shushanResults.length + genericResultsMerged.length;
                      setSourceMessage(total ? `共找到 ${total} 条结果${failures ? `，${failures} 个书源请求失败` : ""}` : (account.apiKey || !shushanTargets.length ? "没有找到结果" : "楠楠漫画有结果；书山请先登录后再搜索"));
                    } catch (error) { setSourceMessage(error instanceof Error ? error.message : "搜索失败"); }
                    finally { setSourceLoading(false); }
                  }}>{sourceLoading ? "搜索中…" : "搜索"}</button>
                </div>

                {sourceMessage && <p className="reading-hub-source-status">{sourceMessage}</p>}

                {sourceResults.length > 0 && !selectedSourceBook && <div className="reading-hub-result-list">{sourceResults.map((item, index) => (
                  <button key={`${item.source}-${item.book_url}-${index}`} type="button" className="reading-hub-result-card" onClick={async () => {
                    const resultSourceId = String((item as any)._readingSourceId || selectedSourceId || "");
                    const source = bookSources.find((x) => x.id === resultSourceId); if (!source) return;
                    setSelectedSourceId(source.id);
                    setSelectedSourceBook(item); setSourceDetail(null); setSourceChapters([]); setSourceLoading(true); setSourceMessage("正在打开详情…");
                    try { const result = await getShushanDetail(loadShushanAccount().apiKey, item); const mergedDetail = { ...item, ...result.data } as ShushanSearchBook; setSourceDetail(mergedDetail); const cat = await getShushanCatalog(loadShushanAccount().apiKey, mergedDetail); setSourceChapters(cat.data || []); setSourceMessage(`目录 ${cat.data?.filter((x) => !x.isVolume).length || 0} 章`); }
                    catch (error) { setSourceMessage(error instanceof Error ? error.message : "获取详情失败"); }
                    finally { setSourceLoading(false); }
                  }}><div className="reading-hub-result-cover">{item.cover ? <img src={item.cover} alt="" /> : <BookOpen size={24} />}</div><div className="reading-hub-result-main"><strong>{item.title || "未命名"}</strong><span>{item.author || "未知作者"} · {item.source || "书山"}</span><small>{item.latestChapterTitle || item.desc || ""}</small></div><ChevronRight size={18} /></button>
                ))}</div>}

                {genericResults.length > 0 && !genericBook && <div className="reading-hub-result-list">{genericResults.map((item, index) => (
                  <button key={`${item.bookUrl}-${index}`} type="button" className="reading-hub-result-card" onClick={async () => {
                    const resultSourceId = String((item as any)._readingSourceId || selectedSourceId || "");
                    const source = bookSources.find((x) => x.id === resultSourceId); if (!source) return;
                    setSelectedSourceId(source.id);
                    setGenericBook(item); setGenericDetail(null); setGenericChapters([]); setSourceLoading(true); setSourceMessage("正在打开详情…");
                    try { const detail = await getGenericDetail(source, item); setGenericDetail(detail); const chapters = await getGenericCatalog(source, detail); setGenericChapters(chapters); setSourceMessage(`目录 ${chapters.length} 章`); }
                    catch (error) { setSourceMessage(error instanceof Error ? error.message : "获取详情失败"); }
                    finally { setSourceLoading(false); }
                  }}><div className="reading-hub-result-cover">{item.cover ? <img src={item.cover} alt="" /> : <BookOpen size={24} />}</div><div className="reading-hub-result-main"><strong>{item.title}</strong><span>{item.author || "未知作者"} · {bookSources.find(x => x.id === String((item as any)._readingSourceId || ""))?.name || "书源"}</span><small>{item.latestChapterTitle || item.desc || ""}</small></div><ChevronRight size={18} /></button>
                ))}</div>}

                {selectedSourceBook && <div className="reading-hub-detail-page">
                  <button type="button" className="reading-hub-backlink" onClick={() => setSelectedSourceBook(null)}>← 返回搜索结果</button>
                  {sourceDetail ? (() => {
                    const cover = normalizeRemoteUrl(sourceDetail.cover || selectedSourceBook.cover, sourceDetail.book_url);
                    const title = sourceDetail.title || selectedSourceBook.title || "未命名";
                    const author = sourceDetail.author || selectedSourceBook.author || "未知作者";
                    const desc = sourceDetail.desc || selectedSourceBook.desc || "暂无简介";
                    const tags = detailTags(sourceDetail);
                    const rating = detailRating(sourceDetail);
                    const status = detailStatus(sourceDetail);
                    const updatedAt = detailUpdatedAt(sourceDetail) || detailUpdatedAt(selectedSourceBook) || "暂无";
                    const wordCount = detailWordCount(sourceDetail);
                    const chapterCount = sourceChapters.filter(x => !x.isVolume).length;
                    return (
                      <div className="reading-discovery-detail-card" style={cover ? { backgroundImage: `linear-gradient(180deg, rgba(255,250,247,.62), rgba(255,250,247,.96) 58%, rgba(255,250,247,.99)), url("${cover}")` } : undefined}>
                        <div className="reading-discovery-detail-content">
                          <div className="reading-discovery-book-head">
                            <div className="reading-discovery-cover">{cover ? <img src={cover} alt="" /> : <BookOpen size={32} />}</div>
                            <div className="reading-discovery-book-main"><h2>{title}</h2><p>{author}</p><span>📚 {sourceDetail.source || selectedSourceBook.source || "书山聚合"}</span></div>
                          </div>

                          <div className="reading-discovery-meta-grid">
                            <div><small>标签</small><strong>{tags}</strong></div>
                            <div><small>评分</small><strong>{rating}</strong></div>
                            <div><small>状态</small><strong>{status}</strong></div>
                            <div><small>最近更新</small><strong>{updatedAt}</strong></div>
                            <div><small>全书字数</small><strong>{wordCount}</strong></div>
                            <div><small>章节</small><strong>{chapterCount} 章</strong></div>
                          </div>

                          <section className="reading-discovery-intro">
                            <h3>简介</h3>
                            <p>{desc}</p>
                          </section>

                          <div className="reading-discovery-actions reading-discovery-actions--compact">
                            <button type="button" onClick={async () => {
                              const id = `shushan_${Date.now()}`;
                              const chapters = sourceChapters.filter(x => !x.isVolume);
                              const coverSaved = false;
                              void downloadCoverForBook(id, cover);
                              const book: Book = { id, title, author, format: "txt", readerType: sourceReaderType(source), totalChapters: chapters.length, createdAt: new Date().toISOString(), hasCover: coverSaved, coverUrl: cover } as Book & { coverUrl?: string };
                              await addBook(book);
                              await saveChapters(id, chapters.map((c, i) => ({ id: `${id}_ch${i}`, bookId: id, index: i, title: c.title || `第${i + 1}章`, paragraphs: [] as string[] })));
                              saveRemoteBook(id, { source: sourceDetail.source, url: sourceDetail.book_url, name: title, apiKey: loadShushanAccount().apiKey, bookId: String((sourceDetail as any).bookid ?? (sourceDetail as any).book_id ?? (sourceDetail as any).bookId ?? ""), cover, desc, chapters });
                              setActiveBook(book);
                            }}><span>🔖</span>放入书架</button>
                            <button type="button" onClick={() => setSourceMessage(`目录共 ${chapterCount} 章`)}><span>☷</span>目录</button>
                            <button type="button" onClick={() => setTab("sources")}><span>&lt;&gt;</span>书源</button>
                            <button type="button" onClick={() => setSourceMessage("阅读记录已保存在本地") }><span>⌁</span>记录</button>
                          </div>

                          <button type="button" className="reading-hub-primary reading-discovery-read" disabled={!chapterCount || sourceLoading} onClick={async () => {
                            const id = `shushan_${Date.now()}`;
                            const chapters = sourceChapters.filter(x => !x.isVolume);
                            const coverSaved = false;
                            void downloadCoverForBook(id, cover);
                            const book: Book = { id, title, author, format: "txt", readerType: sourceReaderType(source), totalChapters: chapters.length, createdAt: new Date().toISOString(), hasCover: coverSaved, coverUrl: cover } as Book & { coverUrl?: string };
                            await addBook(book);
                            await saveChapters(id, chapters.map((c, i) => ({ id: `${id}_ch${i}`, bookId: id, index: i, title: c.title || `第${i + 1}章`, paragraphs: [] as string[] })));
                            saveRemoteBook(id, { source: sourceDetail.source, url: sourceDetail.book_url, name: title, apiKey: loadShushanAccount().apiKey, bookId: String((sourceDetail as any).bookid ?? (sourceDetail as any).book_id ?? (sourceDetail as any).bookId ?? ""), cover, desc, chapters });
                            setActiveBook(book);
                          }}>▣ 开始阅读</button>
                        </div>
                      </div>
                    );
                  })() : <div className="reading-hub-source-loading">详情加载中…</div>}
                </div>}
                {genericBook && <div className="reading-hub-detail-page"><button type="button" className="reading-hub-backlink" onClick={() => setGenericBook(null)}>← 返回搜索结果</button>{genericDetail ? (() => {
                  const cover = normalizeRemoteUrl(genericDetail.cover || genericBook.cover, genericDetail.bookUrl);
                  const title = genericDetail.title || genericBook.title || "未命名";
                  const author = genericDetail.author || genericBook.author || "未知作者";
                  const desc = genericDetail.desc || genericBook.desc || "暂无简介";
                  const tags = detailTags(genericDetail);
                  const rating = detailRating(genericDetail);
                  const status = detailStatus(genericDetail);
                  const updatedAt = detailUpdatedAt(genericDetail) || detailUpdatedAt(genericBook) || "暂无";
                  const wordCount = detailWordCount(genericDetail);
                  const chapterCount = genericChapters.length;
                  const saveGenericBook = async () => {
                    const source = bookSources.find(x => x.id === selectedSourceId); if (!source) return;
                    const id = `source_${Date.now()}`;
                    const chapters = genericChapters;
                    const coverSaved = false;
                    void downloadCoverForBook(id, cover);
                    const book: Book = { id, title, author, format: "txt", readerType: sourceReaderType(source), totalChapters: chapters.length, createdAt: new Date().toISOString(), hasCover: coverSaved, coverUrl: cover } as Book & { coverUrl?: string };
                    await addBook(book);
                    await saveChapters(id, chapters.map((c,i) => ({ id:`${id}_ch${i}`, bookId:id, index:i, title:c.title || `第${i+1}章`, paragraphs:[] as string[] })));
                    saveReadingRemoteBook(id,{sourceId:source.id,sourceName:source.name,book:{title,author,cover,desc,bookUrl:genericDetail.bookUrl,readerType:sourceReaderType(source)},chapters,savedAt:new Date().toISOString()});
                    setActiveBook(book);
                  };
                  return <div className="reading-discovery-detail-card" style={cover ? { backgroundImage: `linear-gradient(180deg, rgba(255,250,247,.62), rgba(255,250,247,.96) 58%, rgba(255,250,247,.99)), url("${cover}")` } : undefined}>
                    <div className="reading-discovery-detail-content">
                      <div className="reading-discovery-book-head"><div className="reading-discovery-cover">{cover ? <img src={cover} alt="" /> : <BookOpen size={32} />}</div><div className="reading-discovery-book-main"><h2>{title}</h2><p>{author}</p><span>📚 {bookSources.find(x=>x.id===selectedSourceId)?.name || "书源"}</span></div></div>
                      <div className="reading-discovery-meta-grid"><div><small>标签</small><strong>{tags}</strong></div><div><small>评分</small><strong>{rating}</strong></div><div><small>状态</small><strong>{status}</strong></div><div><small>最近更新</small><strong>{updatedAt}</strong></div><div><small>全书字数</small><strong>{wordCount}</strong></div><div><small>章节</small><strong>{chapterCount} 章</strong></div></div>
                      <section className="reading-discovery-intro"><h3>简介</h3><p>{desc}</p></section>
                      <div className="reading-discovery-actions reading-discovery-actions--compact"><button type="button" onClick={saveGenericBook}><span>🔖</span>放入书架</button><button type="button" onClick={()=>setSourceMessage(`目录共 ${chapterCount} 章`)}><span>☷</span>目录</button><button type="button" onClick={()=>openSourceDrawer("search")}><span>&lt;&gt;</span>书源</button><button type="button" onClick={()=>setSourceMessage("阅读记录已保存在本地")}><span>⌁</span>记录</button></div>
                      <div className="reading-discovery-current"><strong>在读 · {genericChapters[0]?.title || "暂无章节"}</strong><span>共 {chapterCount} 章</span></div>
                      <section className="reading-discovery-intro reading-discovery-intro--source"><h3>来源信息</h3><p>源站：{bookSources.find(x=>x.id===selectedSourceId)?.name || "书源"}</p><p>作者：{author}</p></section>
                      <button type="button" className="reading-hub-primary reading-discovery-read" disabled={!chapterCount || sourceLoading} onClick={saveGenericBook}>▣ 开始阅读</button>
                    </div>
                  </div>;
                })() : <div className="reading-hub-source-loading">详情加载中…</div>}</div>}
              </section>
            )}

            {tab === "appearance" && (
              <section className="reading-hub-panel reading-hub-appearance-page">
                <div className="reading-hub-panel-head">
                  <div><h2>🎨 外观</h2><p>一套 CSS 控制整个阅读 APP，包括首页、书源、书架、详情、目录和阅读界面。</p></div>
                </div>
                <div className="reading-hub-wallpaper-card">
                  <div className="reading-hub-css-card-head"><div><strong>阅读器壁纸</strong><span>仅进入真正的阅读器后使用，不影响首页、书源、书架、外观。</span></div></div>
                  <div className="reading-hub-wallpaper-preview" style={readerBackgroundUrl ? { backgroundImage: `url("${readerBackgroundUrl}")` } : undefined}>
                    {!readerBackgroundUrl && <span>暂未设置阅读器壁纸</span>}
                  </div>
                  <div className="reading-hub-wallpaper-actions">
                    <label className="reading-hub-wallpaper-button">更换阅读器壁纸<input type="file" accept="image/*" onChange={async (e) => { const file = e.target.files?.[0]; e.target.value = ""; if (!file) return; await saveReadingReaderBackground(file); updateReaderBackgroundUrl(URL.createObjectURL(file)); }} /></label>
                    <button type="button" className="reading-hub-wallpaper-clear" disabled={!readerBackgroundUrl} onClick={async () => { await saveReadingReaderBackground(null); updateReaderBackgroundUrl(null); }}>清除</button>
                  </div>
                </div>
                <div className="reading-hub-css-card">
                  <div className="reading-hub-css-card-head"><div><strong>全局 CSS</strong><span>参考聊天 APP 的 --c-* / --ui-* 变量体系</span></div><button type="button" onClick={resetCustomCss}>恢复模板</button></div>
                  <textarea className="reading-hub-css-editor" value={customCss} onChange={e => saveCustomCss(e.target.value)} spellCheck={false} placeholder="在这里输入你的 CSS…" />
                </div>
                <div className="reading-hub-css-card">
                  <div className="reading-hub-css-card-head"><div><strong>可直接修改的核心变量</strong><span>后续换主题只需要改这一组变量</span></div></div>
                  <pre className="reading-hub-css-reference">{`--c-bg              页面背景\n--c-bg-soft         次级背景\n--c-card            卡片 / 面板\n--c-card-border     卡片边框\n--c-input           输入框 / 次级按钮\n--c-input-border    输入框边框\n--c-text            正文文字\n--c-text-title      标题文字\n--c-icon            次要图标 / 弱文字\n--c-icon-active     主色 / 激活色\n--c-line            分割线\n--ui-radius         小控件圆角\n--ui-radius-card    卡片圆角\n--ui-blur           毛玻璃模糊\n--ui-saturate       毛玻璃饱和度`}</pre>
                </div>
                <div className="reading-hub-appearance-scope-note">全屏背景只作用于首页、发现、书源、书架、外观等功能界面；阅读器壁纸只作用于整个 ReadingViewer（顶部栏、正文、底部控制和浮动控件），两者独立保存。</div>
              </section>
            )}
          </main>

          <input
            ref={sourceFileInputRef}
            type="file"
            accept=".json,application/json,text/json"
            className="reading-hub-hidden-file-input"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              event.currentTarget.value = "";
              if (!file) return;
              try {
                const text = await file.text();
                const parsed = JSON.parse(text);
                const result = importReadingSources(parsed);
                const next = result.sources;
                setBookSources(next);
                const importedItems = Array.isArray(parsed) ? parsed : [parsed];
                const importedKeys = new Set(importedItems.filter((item: any) => item && typeof item === "object").map((item: any) => `${String(item.bookSourceName || item.name || "").trim()}|${String(item.bookSourceUrl || item.url || "").trim()}`));
                const importedIds = next.filter((item) => importedKeys.has(`${item.name}|${item.url}`)).map((item) => item.id);
                const allowedImportedIds = importedIds.filter((id) => {
                  const source = next.find((item) => item.id === id);
                  return sourceImportTarget === "home" ? !isMangaSource(source) : sourceImportTarget === "discovery" ? isMangaSource(source) : true;
                });
                if (sourceImportTarget === "home" || sourceImportTarget === "discovery") {
                  const base = sourceImportTarget === "home" ? homeSourceIds : discoverySourceIds;
                  persistSourceSet(sourceImportTarget, [...base, ...allowedImportedIds]);
                }
                const first = next.find((item) => item.enabled)?.id || "";
                if (!selectedSourceId && first) setSelectedSourceId(first);
                if (!homeModuleSourceId && first) setHomeModuleSourceId(first);
                setSourceMessage(`已导入 ${result.added} 个书源${result.skipped ? `，跳过 ${result.skipped} 个` : ""}；仅加入当前${sourceImportTarget === "home" ? "首页" : sourceImportTarget === "discovery" ? "发现页" : "搜索库"}`);
              } catch (error) {
                setSourceMessage(error instanceof Error ? `书源导入失败：${error.message}` : "书源导入失败");
              }
            }}
          />

          {sourceDrawerOpen && (
            <div className="reading-hub-drawer-backdrop" onClick={() => setSourceDrawerOpen(false)}>
              <aside className="reading-hub-drawer" onClick={(e) => e.stopPropagation()}>
                <div className="reading-hub-drawer-head">
                  <strong>{sourceDrawerMode === "home" ? "首页书源" : sourceDrawerMode === "discovery" ? "发现页书源" : "全部书源"}</strong>
                  <button type="button" onClick={() => setSourceDrawerOpen(false)}><X size={18} /></button>
                </div>
                <div className="reading-hub-drawer-actions">
                  <button type="button" onClick={() => { setSourceImportTarget(sourceDrawerMode); sourceFileInputRef.current?.click(); }}><Upload size={16} /> 导入书源</button>
                  {sourceNeedsLogin(bookSources.find((x) => x.id === selectedSourceId)) && <button type="button" onClick={() => {
                    const source = bookSources.find((x) => x.id === selectedSourceId);
                    if (!source) return;
                    try {
                      const parsed = JSON.parse(String((source.raw as any).loginUi || "[]"));
                      const fields = (Array.isArray(parsed) ? parsed : [])
                        .filter((x: any) => x && x.type !== "button")
                        .map((x: any) => ({ name: String(x.name || "账号"), type: String(x.type || "text") }));
                      const init: Record<string, string> = {};
                      for (const field of fields) init[field.name] = "";
                      if (source.adapter === "shushan") {
                        const account = loadShushanAccount();
                        if (fields.some((x: LoginField) => x.name === "邮箱")) init["邮箱"] = account.email;
                        if (fields.some((x: LoginField) => x.name === "密码")) init["密码"] = account.password;
                      }
                      setLoginFields(init);
                      setSourceLoginOpen(true);
                    } catch {
                      setSourceMessage("该书源登录配置无法读取");
                    }
                  }}><LogIn size={16} /> 书源登录</button>}
                  <button type="button" onClick={() => setTab("appearance")}><Palette size={16} /> 阅读外观</button>
                </div>
                {sourceDrawerMode !== "search" && <div className="reading-hub-drawer-section">
                  <div className="reading-hub-drawer-title">{sourceDrawerMode === "discovery" ? "发现页模块" : "首页排行榜"}</div>
                  <label className="reading-hub-field reading-hub-drawer-source-select"><span>选择书源</span><select value={sourceDrawerMode === "home" ? homeModuleSourceId : discoveryModuleSourceId} onChange={e => sourceDrawerMode === "home" ? setHomeModuleSourceId(e.target.value) : setDiscoveryModuleSourceId(e.target.value)}>{bookSources.filter(source => (sourceDrawerMode === "home" ? homeSourceIds : discoverySourceIds).includes(source.id)).map(source => <option key={source.id} value={source.id}>{source.name}</option>)}</select></label>
                  <div className="reading-hub-drawer-discovered">
                    <div className="reading-hub-drawer-subtitle">{sourceDrawerMode === "discovery" ? "漫画发现模块" : "小说排行榜"}</div>
                    <div className="reading-hub-drawer-discovered-list">
                      {(() => {
                        const sourceId = sourceDrawerMode === "home" ? homeModuleSourceId : discoveryModuleSourceId;
                        const source = bookSources.find(x => x.id === sourceId);
                        const items = source ? discoverSourceModules(source) : [];
                        return items.map(item => {
                          const id = `${source!.id}_${item.title}`;
                          const exists = homeModules.some(x => x.id === id);
                          return <button key={`${item.title}-${item.url}`} type="button" className={exists ? "is-added" : ""} disabled={exists} onClick={() => {
                            const next = [...homeModules, { id, title:item.title, url:item.url, sourceId:source!.id, enabled:true }];
                            persistHomeModules(next);
                          }}><Plus size={12}/><span>{item.title}</span>{exists && <em>已添加</em>}</button>;
                        });
                      })()}
                    </div>
                  </div>
                  {sourceDrawerMode === "home" && <button type="button" className="reading-hub-drawer-wide-action" onClick={() => { setTab("home"); setHomeModuleEditorOpen(v => !v); }}>＋ 自定义首页模块</button>}
                  <div className="reading-hub-drawer-module-list">
                    {homeModules.filter(module => (sourceDrawerMode === "home" ? homeSourceIds : discoverySourceIds).includes(module.sourceId)).map((module, index) => (
                      <div key={module.id} className="reading-hub-drawer-module">
                        <span>{module.title}</span>
                        <div>
                          <button type="button" onClick={() => { if (index <= 0) return; const allowedIds = sourceDrawerMode === "home" ? homeSourceIds : discoverySourceIds; const visible = homeModules.filter(x => allowedIds.includes(x.sourceId)); const pos = visible.findIndex(x => x.id === module.id); if (pos <= 0) return; const swap = visible[pos - 1]; const next=[...homeModules]; const a=next.findIndex(x=>x.id===module.id); const b=next.findIndex(x=>x.id===swap.id); [next[a],next[b]]=[next[b],next[a]]; persistHomeModules(next); }}>↑</button>
                          <button type="button" onClick={() => { const allowedIds = sourceDrawerMode === "home" ? homeSourceIds : discoverySourceIds; const visible = homeModules.filter(x => allowedIds.includes(x.sourceId)); const pos = visible.findIndex(x => x.id === module.id); if (pos < 0 || pos >= visible.length - 1) return; const swap = visible[pos + 1]; const next=[...homeModules]; const a=next.findIndex(x=>x.id===module.id); const b=next.findIndex(x=>x.id===swap.id); [next[a],next[b]]=[next[b],next[a]]; persistHomeModules(next); }}>↓</button>
                          <button type="button" onClick={() => { persistHomeModules(homeModules.filter(x => x.id !== module.id)); setHomeModuleData(prev => { const copy={...prev}; delete copy[module.id]; return copy; }); }}>×</button>
                        </div>
                      </div>
                    ))}
                  </div>
                  {sourceDrawerMode === "home" && homeModuleEditorOpen && <div className="reading-hub-module-form">
                    <label className="reading-hub-field"><span>模块名称</span><input value={homeModuleTitle} onChange={e=>setHomeModuleTitle(e.target.value)} placeholder="例如：女频新书榜 · 快穿" /></label>
                    <label className="reading-hub-field"><span>模块地址</span><input value={homeModuleUrl} onChange={e=>setHomeModuleUrl(e.target.value)} placeholder="https://..." /></label>
                    <label className="reading-hub-field"><span>使用书源</span><select value={homeModuleSourceId} onChange={e=>setHomeModuleSourceId(e.target.value)}>{bookSources.filter(source => homeSourceIds.includes(source.id)).map(source=><option key={source.id} value={source.id}>{source.name}</option>)}</select></label>
                    <button type="button" className="reading-hub-primary" disabled={!homeModuleTitle.trim()||!/^https?:\/\//i.test(homeModuleUrl.trim())||!homeModuleSourceId} onClick={()=>{const id=`custom_${Date.now()}`;persistHomeModules([...homeModules,{id,title:homeModuleTitle.trim(),url:homeModuleUrl.trim(),sourceId:homeModuleSourceId,enabled:true}]);setHomeModuleTitle("");setHomeModuleUrl("");setHomeModuleEditorOpen(false);}}>保存模块</button>
                  </div>}
                </div>}

                <div className="reading-hub-drawer-section">
                  <div className="reading-hub-drawer-title">我的书源</div>
                  {drawerSources.map((source) => (
                    <div key={source.id} className="reading-hub-drawer-source">
                      <button type="button" onClick={() => {
                        setSelectedSourceId(source.id);
                        setSourceDrawerOpen(false);
                        setSourceMessage("");
                        setSourceResults([]); setGenericResults([]);
                        setSelectedSourceBook(null); setGenericBook(null);
                        setSourceDetail(null); setGenericDetail(null);
                        setSourceChapters([]); setGenericChapters([]);
                      }}>
                        <strong>{source.name}</strong>
                        <small>{source.group || "未分组"} · {source.enabled ? "已启用" : "已停用"}</small>
                      </button>
                      <input type="checkbox" checked={source.enabled} onChange={(e) => {
                        setReadingSourceEnabled(source.id, e.target.checked);
                        setBookSources(loadReadingSources());
                      }} />
                      {sourceDrawerMode !== "search" && <button type="button" className="reading-hub-drawer-source-remove" title="从当前页面移除" onClick={() => {
                        const kind = sourceDrawerMode as "home" | "discovery";
                        persistSourceSet(kind, (kind === "home" ? homeSourceIds : discoverySourceIds).filter((id) => id !== source.id));
                      }}>−</button>}
                    </div>
                  ))}
                </div>
                <div className="reading-hub-drawer-section">
                  <div className="reading-hub-drawer-title">当前书源设置</div>
                  {selectedSourceId && <div className="reading-hub-drawer-meta">
                    <label className="reading-hub-field"><span>书源名称</span><input value={sourceEditName || (bookSources.find((x) => x.id === selectedSourceId)?.name || "")} onChange={(e) => setSourceEditName(e.target.value)} /></label>
                    <label className="reading-hub-field"><span>分组</span><input value={sourceEditGroup || (bookSources.find((x) => x.id === selectedSourceId)?.group || "")} onChange={(e) => setSourceEditGroup(e.target.value)} /></label>
                    <div className="reading-hub-inline-actions"><button type="button" className="reading-hub-primary" onClick={() => { const updated=updateReadingSourceMeta(selectedSourceId,{name:sourceEditName,group:sourceEditGroup}); setBookSources(loadReadingSources()); setSourceMessage(updated?"✅ 书源信息已保存":"保存失败"); }}>保存修改</button><button type="button" className="reading-hub-secondary" onClick={() => { clearReadingSourceState(selectedSourceId); clearShushanAccount(); setSourceMessage("已清除当前书源登录状态"); }}>清除登录状态</button></div>
                  </div>}
                  {selectedSourceId && (() => {
                    const selected = bookSources.find((x) => x.id === selectedSourceId);
                    if (!selected) return null;
                    const sourceComment = String((selected.raw as any)?.bookSourceComment || "").trim();
                    const publishUrl = sourceComment.match(/https?:\/\/[^\s]+/)?.[0] || (selected.adapter === "shushan" ? "https://fb.shushan.vip" : "");
                    let controls: Array<{ name: string; action: string }> = [];
                    try {
                      const parsed = JSON.parse(String((selected.raw as any)?.loginUi || "[]"));
                      controls = (Array.isArray(parsed) ? parsed : []).filter((x: any) => x && x.type === "button" && String(x.name || "").trim()).map((x: any) => ({ name: String(x.name), action: String(x.action || "") }));
                    } catch {}
                    const runNative = async (action: string) => {
                      if (selected.adapter !== "shushan") { setSourceMessage("该书源的按钮动作需要对应兼容适配器。"); return; }
                      const account = loadShushanAccount();
                      const state = loadReadingSourceState(selected.id);
                      const vars = { ...(state.variables || {}) };
                      const persist = (patch: Record<string, string>) => {
                        saveReadingSourceState(selected.id, { ...state, variables: { ...vars, ...patch }, updatedAt: new Date().toISOString() });
                      };
                      const host = vars.host || selected.url || SHUSHAN_HOSTS[0];
                      const open = (url: string) => { try { window.open(url, "_blank", "noopener,noreferrer"); } catch { window.location.href = url; } };
                      if (/^login\(/i.test(action)) { setSourceLoginOpen(true); return; }
                      if (/^key\(/i.test(action)) return open(`${host}/user_login`);
                      if (/^user_center\(/i.test(action)) return open(`${host}/user_center`);
                      if (/^version\(/i.test(action)) return open(`${host}/version?id=5.37`);
                      if (/^password\(/i.test(action)) return open(`${host}/forgot_password`);
                      if (/^vip\(/i.test(action)) return open(`${host}/coffee`);
                      if (/^fb\(/i.test(action)) return open("https://fb.shushan.vip");
                      if (/^fq_login\(/i.test(action)) { open("https://fanqienovel.com/main/writer/login"); setSourceMessage("已打开番茄登录页；登录凭据由书源自身管理。"); return; }
                      if (/^user_logout\(/i.test(action)) { clearShushanAccount(); clearReadingSourceState(selected.id); setSourceResults([]); setSourceDetail(null); setSelectedSourceBook(null); setSourceChapters([]); setSourceMessage("已按书源动作退出登录"); return; }
                      if (/^logout\(/i.test(action)) { saveReadingSourceState(selected.id, { ...state, cookies: "", updatedAt: new Date().toISOString() }); setSourceMessage("已清除番茄登录 Cookie；手动 Token 需要在书源设置中移除"); return; }
                      if (/^sou\d+\(/i.test(action)) {
                        const key = action.match(/^(sou\d+)/i)?.[1] || "sou0";
                        const value = SHUSHAN_SOURCE_VALUES[key] ?? "";
                        persist({ source: value });
                        setSourceMessage(value ? `已切换到 ${value}，下一次搜索将优先使用该源` : "已切回聚合搜索");
                        setSourceDrawerOpen(false);
                        return;
                      }
                      if (/^type[1-4]\(/i.test(action)) { const type = action.match(/^type([1-4])/i)?.[1] || "1"; persist({ type }); setSourceMessage(`已切换模式：${["", "小说", "听书", "漫画", "视频"][Number(type)]}`); return; }
                      if (/^boy\(/i.test(action) || /^girl\(/i.test(action)) { const gender = /^boy/i.test(action) ? "boy" : "girl"; persist({ gender }); setSourceMessage(gender === "boy" ? "已切换男频" : "已切换女频"); return; }
                      if (/^toggleParacomment\(/i.test(action)) { const next = vars.yunpara === "on" ? "off" : "on"; persist({ yunpara: next }); setSourceMessage(next === "on" ? "已开启段评兼容" : "已关闭段评兼容"); return; }
                      if (/^toggleBookSync\(/i.test(action)) { const next = vars.book_sync === "on" ? "off" : "on"; persist({ book_sync: next }); setSourceMessage(next === "on" ? "已开启番茄阅读记录同步" : "已关闭番茄阅读记录同步"); return; }
                      if (/^ChapterRefresh\(/i.test(action)) { const next = vars.chapter_refresh_force === "on" ? "off" : "on"; persist({ chapter_refresh_force: next }); setSourceMessage(next === "on" ? "已开启强制刷新" : "已恢复正常阅读"); return; }
                      if (/^imagestyle\(/i.test(action)) { const next = vars.imgstyle === "text" ? "TEXT" : "text"; persist({ imgstyle: next }); setSourceMessage(next === "text" ? "已切换为小号段评样式" : "已切换为大号段评样式"); return; }
                      if (/^sethost\(/i.test(action)) { const index = Math.max(0, SHUSHAN_HOSTS.indexOf(host)); const next = SHUSHAN_HOSTS[(index + 1) % SHUSHAN_HOSTS.length]; persist({ host: next }); setSourceMessage(`已切换服务器：${next}`); return; }
                      if (/^checkCurrentServer\(/i.test(action)) {
                        setSourceLoading(true);
                        try { const started = performance.now(); const response = await fetch("/api/reading/source", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: `${host}/detection`, timeoutMs: 8000 }) }); const elapsed = Math.round(performance.now() - started); if (!response.ok) throw new Error(`HTTP ${response.status}`); const data = await response.json(); const ok = String(data?.text || "").includes("书山聚合"); setSourceMessage(ok ? `服务器检测：${elapsed}ms${elapsed < 1000 ? " · 网络环境优良" : elapsed < 2000 ? " · 网络环境一般" : " · 延迟较高"}` : "服务器检测失败：未识别到书山服务"); } catch (error) { setSourceMessage(`服务器检测失败：${error instanceof Error ? error.message : "网络错误"}`); } finally { setSourceLoading(false); }
                        return;
                      }
                      if (/^get_user\(/i.test(action)) {
                        if (!account.apiKey) { setSourceMessage("请先登录书山聚合"); return; }
                        setSourceLoading(true);
                        try { const response = await fetch("/api/reading/shushan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "user", apiKey: account.apiKey, host }) }); const data = await response.json(); if (!response.ok) throw new Error(data?.error || `HTTP ${response.status}`); const user = data?.data?.user || data?.user || data?.data; setSourceMessage(user?.nickname ? `当前账号：${user.nickname}${user.is_member ? " · 会员" : ""}` : "已获取书源账号信息"); } catch (error) { setSourceMessage(error instanceof Error ? error.message : "信息查询失败"); } finally { setSourceLoading(false); }
                        return;
                      }
                      if (/^cleanCache\(/i.test(action)) {
                        setSourceLoading(true);
                        try { const response = await fetch("/api/reading/source", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: `${host}/cron/cache`, timeoutMs: 8000 }) }); setSourceMessage(response.ok ? "书源缓存清理请求已完成" : `缓存清理失败：HTTP ${response.status}`); } catch { setSourceMessage("缓存清理失败"); } finally { setSourceLoading(false); }
                        return;
                      }
                      if (/^sou0\(/i.test(action)) { setSourceDrawerOpen(false); setTab("sources"); setSourceMessage("已切换到聚合搜索"); return; }
                      if (/^(SortFilter|TTSSelector)\(/i.test(action)) { setSourceMessage("这个原生功能包含书源自定义 HTML/Java UI；已保留入口，但浏览器安全兼容层暂不执行陌生脚本。"); return; }
                      if (/^get_cx\(/i.test(action)) { setSourceMessage(`当前服务器：${host} · 源站：${vars.source || "聚合搜索"} · 频段：${vars.gender === "girl" ? "女频" : "男频"} · 模式：${vars.type || "1"}`); return; }
                      setSourceMessage("已导入该原生按钮，但此按钮依赖 Legado Java/原生 UI，当前不会直接执行陌生脚本。");
                    };
                    return <>{(sourceComment || publishUrl) && <div className="reading-hub-source-info"><div className="reading-hub-drawer-subtitle">书源发布页 / 说明</div>{publishUrl && <button type="button" className="reading-hub-publish-link" onClick={() => { try { window.open(publishUrl, "_blank", "noopener,noreferrer"); } catch { window.location.href = publishUrl; } }}>打开发布页</button>}{sourceComment && <pre>{sourceComment}</pre>}</div>}{controls.length ? <div className="reading-hub-native-functions"><div className="reading-hub-drawer-subtitle">书源原生功能</div>{controls.map((item) => <button type="button" className={!item.action ? "is-separator" : ""} key={`${item.name}-${item.action}`} disabled={!item.action} onClick={() => void runNative(item.action)}><span>{item.name}</span>{item.action && <ChevronRight size={14}/>}</button>)}</div> : null}</>;
                  })()}
                </div>
              </aside>
            </div>
          )}

          {sourceLoginOpen && sourceNeedsLogin(bookSources.find((x) => x.id === selectedSourceId)) && (
            <div className="reading-hub-login-modal" onClick={() => setSourceLoginOpen(false)}>
              <div className="reading-hub-login-card" onClick={(e) => e.stopPropagation()}>
                <div className="reading-hub-drawer-head">
                  <strong>{bookSources.find((x) => x.id === selectedSourceId)?.name || "书源"} · 登录</strong>
                  <button type="button" onClick={() => setSourceLoginOpen(false)}><X size={18} /></button>
                </div>
                {Object.entries(loginFields).map(([name, value]) => (
                  <label key={name} className="reading-hub-field">
                    <span>{name}</span>
                    <input
                      type={/密码|password/i.test(name) ? "password" : "text"}
                      value={value}
                      onChange={(e) => setLoginFields((prev) => ({ ...prev, [name]: e.target.value }))}
                    />
                  </label>
                ))}
                <button type="button" className="reading-hub-primary" onClick={async () => {
                  const source = bookSources.find((x) => x.id === selectedSourceId);
                  if (!source) return;
                  if (source.adapter !== "shushan") {
                    setSourceMessage("这个书源的登录动作包含专用脚本；当前安全兼容层不会在浏览器直接执行未知 Java。");
                    setSourceLoginOpen(false);
                    return;
                  }
                  const email = loginFields["邮箱"] || Object.values(loginFields)[0] || "";
                  const password = loginFields["密码"] || Object.values(loginFields)[1] || "";
                  if (!email || !password) { setSourceMessage("请填写登录信息"); return; }
                  setSourceLoading(true);
                  try {
                    const result = await (await import("@/lib/shushan-client")).loginShushan(email, password);
                    const next = { email, password, apiKey: result.apiKey, saved: true, nickname: result.user?.nickname, isMember: result.user?.is_member === true };
                    saveShushanAccount(next);
                    setSourceMessage("✅ 书源登录成功");
                    setSourceLoginOpen(false);
                  } catch (error) {
                    setSourceMessage(error instanceof Error ? error.message : "登录失败");
                  } finally {
                    setSourceLoading(false);
                  }
                }}>登录并保存</button>
              </div>
            </div>
          )}

          <nav
            className="reading-hub-bottom-nav"
            aria-label="阅读 APP 导航"
          >
            <NavButton
              active={tab === "home"}
              label="首页"
              icon={<BookOpen size={19} />}
              onClick={() => setTab("home")}
            />
            <NavButton
              active={tab === "sources"}
              label="书源"
              icon={<Search size={19} />}
              onClick={() => setTab("sources")}
            />
            <NavButton
              active={tab === "discovery"}
              label="发现"
              icon={<Compass size={19} />}
              onClick={() => setTab("discovery")}
            />
            <NavButton
              active={tab === "shelf"}
              label="书架"
              icon={<Library size={19} />}
              onClick={() => setTab("shelf")}
            />
            <NavButton
              active={tab === "appearance"}
              label="外观"
              icon={<Palette size={19} />}
              onClick={() => setTab("appearance")}
            />
          </nav>
        </>
      )}
    </div>
  );
}

function NavButton({
  active,
  label,
  icon,
  onClick,
}: {
  active: boolean;
  label: string;
  icon: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`reading-hub-nav-item${active ? " is-active" : ""}`}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
