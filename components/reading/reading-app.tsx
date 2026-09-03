"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { BookOpen, Library, Search, Palette, X, Upload, Trash2, MoreVertical, LogIn, Plus, ChevronRight, RefreshCw } from "lucide-react";
import { hydrateReadingStorage } from "@/lib/reading-storage";
import { ReadingShelf } from "./reading-shelf";
import { ReadingViewer } from "./reading-viewer";
import {
  DEFAULT_READING_APPEARANCE,
  loadReadingAppearance,
  loadReadingBackground,
  loadReadingCustomFont,
  resolveReadingFontFamily,
  saveReadingAppearance,
  saveReadingBackground,
  saveReadingCustomFont,
  type ReadingAppearance,
} from "@/lib/reading-appearance";
import type { Book } from "@/lib/reading-types";
import {
  clearShushanAccount,
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

type Tab = "home" | "shelf" | "sources" | "appearance";

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


function getTitle(tab: Tab) {
  switch (tab) {
    case "home":
      return "首页";
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

function detailTags(obj: unknown): string {
  const value = detailValue(obj, ["tags", "tag", "book_tags", "labels", "label"]);
  if (Array.isArray((obj as any)?.tags)) return (obj as any).tags.join(" · ");
  return value || "暂无标签";
}

function detailStatus(obj: unknown): string {
  const value = detailValue(obj, ["status", "book_status", "novel_status", "state", "serial_status"]);
  if (/完结|已完本|finished|complete/i.test(value)) return "完结";
  if (/连载|更新|serial/i.test(value)) return "连载";
  return value || "连载";
}

function detailRating(obj: unknown): string {
  const value = detailValue(obj, ["score", "rating", "rate", "book_score", "rating_score"]);
  return value ? `${value}${/分$/.test(value) ? "" : "分"}` : "暂无评分";
}

function detailUpdatedAt(obj: unknown): string {
  return detailValue(obj, [
    "update_time", "updated_at", "updateTime", "updatedAt",
    "last_update_time", "lastUpdateTime", "latest_update", "latestUpdate",
    "latest_update_time", "latestUpdateTime", "latest_chapter_update_time",
    "last_chapter_update_time", "modify_time", "modifyTime", "update_date", "updateDate",
  ]) || "";
}

function detailWordCount(obj: unknown): string {
  const value = detailValue(obj, ["wordCount", "word_count", "words", "wordNum", "word_num", "length"]);
  return value || "暂无";
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
  const [sourceLoginOpen, setSourceLoginOpen] = useState(false);
  const [loginFields, setLoginFields] = useState<Record<string, string>>({});
  const [homeModules, setHomeModules] = useState<HomeModule[]>([]);
  const [homeModuleLoading, setHomeModuleLoading] = useState<string | null>(null);
  const [homeModuleData, setHomeModuleData] = useState<Record<string, GenericSourceBook[]>>({});
  const [homeModuleEditorOpen, setHomeModuleEditorOpen] = useState(false);
  const [homeModuleTitle, setHomeModuleTitle] = useState("");
  const [homeModuleUrl, setHomeModuleUrl] = useState("");
  const [homeModuleSourceId, setHomeModuleSourceId] = useState("");
  const [selectedSourceBook, setSelectedSourceBook] = useState<ShushanSearchBook | null>(null);
  const [sourceDetail, setSourceDetail] = useState<ShushanSearchBook | null>(null);
  const [sourceChapters, setSourceChapters] = useState<ShushanChapter[]>([]);
  const [genericResults, setGenericResults] = useState<GenericSourceBook[]>([]);
  const [genericBook, setGenericBook] = useState<GenericSourceBook | null>(null);
  const [genericDetail, setGenericDetail] = useState<GenericSourceDetail | null>(null);
  const [genericChapters, setGenericChapters] = useState<GenericSourceChapter[]>([]);
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
  const [customFontFamily, setCustomFontFamily] = useState<string | undefined>();

  const backgroundUrlRef = useRef<string | null>(null);
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
    const installed = loadReadingSources();
    try {
      const savedModules = JSON.parse(window.localStorage.getItem("reading-home-modules-v2") || "[]");
      if (Array.isArray(savedModules)) setHomeModules(savedModules);
    } catch {}
    setBookSources(installed);
    const firstSourceId = installed.find((item) => item.adapter === "shushan" && item.enabled)?.id || installed[0]?.id || "";
    setSelectedSourceId(firstSourceId);
    setHomeModuleSourceId(firstSourceId);
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
      if (selected && selected.adapter === "shushan") {
        const discovered = discoverSourceModules(selected);
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
        let finalModules = repaired as HomeModule[];
        if (!hasDiscover) {
          const preferred = discovered.find(item => /女频新书榜\s*·\s*快穿/.test(item.title));
          const defaults = discovered.filter(item => /女频(?:阅读榜|新书榜)\s*·/.test(item.title)).slice(0, 4);
          const initial = [preferred, ...defaults].filter((item, i, arr) => item && arr.findIndex(x => x?.url === item.url) === i).slice(0, 5);
          const additions = initial.map((item, i) => ({ id: `${firstSourceId}_discover_${i}`, title: item!.title, url: item!.url, sourceId: firstSourceId, enabled: true }));
          finalModules = [...additions, ...finalModules];
        }
        // 只有配置发生变化才写回，避免每次打开阅读 APP 都重置用户排序。
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

    void loadReadingCustomFont().then((blob) => {
      if (cancelled) return;
      void loadCustomFontFace(blob);
    });

    return () => {
      cancelled = true;

      if (backgroundUrlRef.current) {
        URL.revokeObjectURL(backgroundUrlRef.current);
      }

      if (customFontUrlRef.current) {
        URL.revokeObjectURL(customFontUrlRef.current);
      }
    };
  }, []);

  const handleSaveAppearance = async (
    nextAppearance: ReadingAppearance,
    options: {
      backgroundFile: File | null;
      clearBackground: boolean;
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

    if (options.clearCustomFont) {
      await saveReadingCustomFont(null);
      await loadCustomFontFace(null);
    } else if (options.customFontFile) {
      await saveReadingCustomFont(options.customFontFile);
      await loadCustomFontFace(options.customFontFile);
    }
  };

  const appearanceStyle = {
    "--reading-font-family": resolveReadingFontFamily(
      appearance.fontFamily,
      customFontFamily,
    ),
    "--reading-font-size": `${appearance.fontSize}px`,
    "--reading-text-color": appearance.textColor,
    "--reading-line-height": String(appearance.lineHeight),
    "--reading-bg-image": backgroundUrl
      ? `url("${backgroundUrl}")`
      : "none",
  } as CSSProperties;

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
      if (!books.length) {
        throw new Error("榜单接口已返回，但没有识别到书籍数据");
      }
    } catch (error) {
      setHomeModuleData((prev) => ({ ...prev, [module.id]: [] }));
      setSourceMessage(error instanceof Error ? error.message : "首页模块加载失败");
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

  useEffect(() => {
    if (!ready || !homeModules.length || !bookSources.length) return;
    const pending = homeModules.filter((module) => module.enabled && homeModuleData[module.id] === undefined);
    if (!pending.length) return;
    void Promise.all(pending.map((module) => refreshHomeModule(module)));
    // 只在模块数据尚未存在时自动首刷；手动刷新仍由右侧按钮触发。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, homeModules, bookSources]);

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
      {activeBook ? (
        <div className="reading-hub-viewer">
          <button
            type="button"
            className="reading-hub-viewer-close"
            aria-label="返回阅读首页"
            onClick={() => setActiveBook(null)}
          >
            <X size={18} />
          </button>
          <ReadingViewer
            book={activeBook}
            onBack={() => setActiveBook(null)}
          />
        </div>
      ) : (
        <>
          <header className="reading-hub-topbar">
            <div>
              <div className="reading-hub-kicker">READING</div>
              <h1>{getTitle(tab)}</h1>
            </div>
            <button
              type="button"
              className="reading-hub-close"
              aria-label="关闭阅读 APP"
              onClick={onClose}
            >
              <X size={18} />
            </button>
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
                        const coverSaved = await downloadCoverForBook(id, cover);
                        const rawBookId = (sourceDetail as any).bookid ?? (sourceDetail as any).book_id ?? (sourceDetail as any).bookId ?? (selectedSourceBook as any).bookid ?? (selectedSourceBook as any).book_id ?? (selectedSourceBook as any).bookId;
                        const bookId = rawBookId == null ? "" : String(rawBookId);
                        const book: Book = { id, title, author, format: "txt", totalChapters: chapters.length, createdAt: new Date().toISOString(), hasCover: coverSaved, coverUrl: cover } as Book & { coverUrl?: string };
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
                <div className="reading-hub-section"><div className="reading-hub-section-head"><div><h2>排行榜</h2><p>直接使用书源发现页：阅读榜、新书榜、分类榜等都可以单独添加。</p></div></div>
                  <div className="reading-hub-module-list">{homeModules.filter(x=>x.enabled).map(module=><div key={module.id} className="reading-hub-module"><div className="reading-hub-module-head"><strong>{module.title}</strong><div className="reading-hub-module-actions"><button type="button" title="上移" onClick={()=>{const i=homeModules.findIndex(x=>x.id===module.id);if(i>0){const next=[...homeModules];[next[i-1],next[i]]=[next[i],next[i-1]];persistHomeModules(next);}}}>↑</button><button type="button" title="下移" onClick={()=>{const i=homeModules.findIndex(x=>x.id===module.id);if(i>=0&&i<homeModules.length-1){const next=[...homeModules];[next[i],next[i+1]]=[next[i+1],next[i]];persistHomeModules(next);}}}>↓</button><button type="button" title="删除" onClick={()=>{persistHomeModules(homeModules.filter(x=>x.id!==module.id));setHomeModuleData(prev=>{const copy={...prev};delete copy[module.id];return copy;});}}>×</button><button type="button" title="刷新" onClick={() => { void refreshHomeModule(module); }}>{homeModuleLoading===module.id?<RefreshCw size={14} className="reading-spin"/>:<RefreshCw size={14}/>}</button></div></div>{homeModuleLoading===module.id&&!homeModuleData[module.id]&&<div className="reading-hub-module-empty">正在加载…</div>}{homeModuleData[module.id]?.length>0&&<div className="reading-hub-module-grid">{homeModuleData[module.id].map((book,i)=><button key={`${book.title}-${i}`} type="button" onClick={async()=>{const source=bookSources.find(x=>x.id===module.sourceId);if(!source)return;setSelectedSourceId(source.id);setSourceLoading(true);setSourceMessage("");setGenericBook(null);setGenericDetail(null);setGenericChapters([]);setSelectedSourceBook(null);setSourceDetail(null);setSourceChapters([]);try{if(source.adapter==="shushan"){const raw=book.raw&&typeof book.raw==="object"?book.raw as Record<string,unknown>:{};const bid=String(book.bookId||raw.book_id_str||raw.book_id||raw.bookId||"").trim();const rawSource=String(book.source||raw.source||raw.source_name||raw.book_source||"").trim();const inferredSource=/^\d{19}$/.test(bid)?"番茄小说":rawSource;const shushanItem:ShushanSearchBook={...raw,title:book.title,author:book.author,cover:book.cover,desc:book.desc,source:inferredSource,book_url:String(book.bookUrl||raw.book_url||raw.bookUrl||raw.detail_url||raw.detailUrl||raw.url||""),latestChapterTitle:book.latestChapterTitle,wordCount:book.wordCount,tags:book.tags,bookid:bid||undefined,book_id:bid||undefined,bookId:bid||undefined};const account=loadShushanAccount();let detail:ShushanSearchBook;if(/^\d{19}$/.test(bid)){const info=await getShushanBookInfo(account.apiKey,bid);const infoData=Array.isArray(info.data)?(info.data[0]||{}):((info.data&&typeof info.data==="object")?info.data:{});const fanqieUrl=`https://api5-normal-sinfonlineb.fqnovel.com/reading/bookapi/multi-detail/v/?aid=1967&iid=1&version_code=999&book_id=${encodeURIComponent(bid)}`;detail=({ ...shushanItem, ...infoData, source:String((infoData as any)?.source||"番茄小说"), book_url:String((infoData as any)?.book_url||(infoData as any)?.url||fanqieUrl), bookid:String((infoData as any)?.bookid||(infoData as any)?.book_id||(infoData as any)?.bookId||bid) } as ShushanSearchBook);}else{const result=await getShushanDetail(account.apiKey,shushanItem);detail=({ ...shushanItem, ...(result.data||{}), source:String((result.data as any)?.source||shushanItem.source), book_url:String((result.data as any)?.book_url||(result.data as any)?.url||shushanItem.book_url), bookid:String((result.data as any)?.bookid||(result.data as any)?.book_id||(result.data as any)?.bookId||shushanItem.bookid||"") } as ShushanSearchBook);}setSelectedSourceBook(shushanItem);setSourceDetail(detail);const cat=await getShushanCatalog(account.apiKey,detail);setSourceChapters(cat.data||[]);}else{setGenericBook(book);const detail=await getGenericDetail(source,book);setGenericDetail(detail);const chapters=await getGenericCatalog(source,detail);setGenericChapters(chapters);}}catch(error){setSourceMessage(error instanceof Error?error.message:"打开书籍失败");}finally{setSourceLoading(false);}}}><div className="reading-hub-module-cover">{book.cover?<img src={book.cover} alt=""/>:<BookOpen size={19}/>}</div><strong>{book.title}</strong><small>{book.author||"未知作者"}</small></button>)}</div>}{!homeModuleData[module.id]&&<div className="reading-hub-module-empty">点击右侧刷新加载</div>}</div>)}</div>
                </div>
                </>
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
                  <button type="button" className="reading-hub-icon-btn" onClick={() => setSourceDrawerOpen(true)} aria-label="书源管理">
                    <MoreVertical size={20} />
                  </button>
                </div>

                <div className="reading-hub-source-pills">
                  {bookSources.filter((item) => item.enabled).map((source) => (
                    <button key={source.id} type="button" className={selectedSourceId === source.id ? "is-active" : ""} onClick={() => {
                      setSelectedSourceId(source.id); setGenericResults([]); setSourceResults([]); setGenericBook(null); setGenericDetail(null); setGenericChapters([]); setSelectedSourceBook(null); setSourceDetail(null); setSourceChapters([]); setSourceMessage("");
                    }}>{source.name}</button>
                  ))}
                </div>

                <div className="reading-hub-big-searchbox">
                  <Search size={21} />
                  <input value={sourceKeyword} onChange={(e) => setSourceKeyword(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") (e.currentTarget.parentElement?.querySelector("button") as HTMLButtonElement | null)?.click(); }} placeholder="输入书名、作者，或 书名@来源" autoFocus />
                  <button type="button" disabled={sourceLoading || !sourceKeyword.trim() || !selectedSourceId} onClick={async () => {
                    const currentSource = bookSources.find((item) => item.id === selectedSourceId);
                    if (!currentSource) return;
                    setSourceLoading(true); setSourceMessage(""); setGenericResults([]); setSourceResults([]);
                    try {
                      const raw = sourceKeyword.trim();
                      if (currentSource.adapter === "shushan") {
                        const [keyword, inlineSource] = raw.split("@");
                        const account = loadShushanAccount();
                        if (!account.apiKey) throw new Error("请先在「书源管理 → 书源登录」完成书山登录");
                        const result = await searchShushan(account.apiKey, keyword.trim(), inlineSource?.trim() || "", 1);
                        const results = Array.isArray(result.data) ? result.data : [];
                        setSourceResults(results);
                        setSourceMessage(results.length ? `找到 ${results.length} 本相关书籍` : "书源返回 0 条结果，可尝试只填书名，或清空指定来源");
                      } else {
                        const result = await searchGenericSource(currentSource, raw.replace(/@.+$/, ""), 1);
                        setGenericResults(result); setSourceMessage(result.length ? `找到 ${result.length} 本相关书籍` : "没有找到结果");
                      }
                    } catch (error) { setSourceMessage(error instanceof Error ? error.message : "搜索失败"); }
                    finally { setSourceLoading(false); }
                  }}>{sourceLoading ? "搜索中…" : "搜索"}</button>
                </div>

                {sourceMessage && <p className="reading-hub-source-status">{sourceMessage}</p>}

                {sourceResults.length > 0 && !selectedSourceBook && <div className="reading-hub-result-list">{sourceResults.map((item, index) => (
                  <button key={`${item.source}-${item.book_url}-${index}`} type="button" className="reading-hub-result-card" onClick={async () => {
                    const source = bookSources.find((x) => x.id === selectedSourceId); if (!source) return;
                    setSelectedSourceBook(item); setSourceDetail(null); setSourceChapters([]); setSourceLoading(true); setSourceMessage("正在打开详情…");
                    try { const result = await getShushanDetail(loadShushanAccount().apiKey, item); const mergedDetail = { ...item, ...result.data } as ShushanSearchBook; setSourceDetail(mergedDetail); const cat = await getShushanCatalog(loadShushanAccount().apiKey, mergedDetail); setSourceChapters(cat.data || []); setSourceMessage(`目录 ${cat.data?.filter((x) => !x.isVolume).length || 0} 章`); }
                    catch (error) { setSourceMessage(error instanceof Error ? error.message : "获取详情失败"); }
                    finally { setSourceLoading(false); }
                  }}><div className="reading-hub-result-cover">{item.cover ? <img src={item.cover} alt="" /> : <BookOpen size={24} />}</div><div className="reading-hub-result-main"><strong>{item.title || "未命名"}</strong><span>{item.author || "未知作者"} · {item.source || "书山"}</span><small>{item.latestChapterTitle || item.desc || ""}</small></div><ChevronRight size={18} /></button>
                ))}</div>}

                {sourceResults.length === 0 && genericResults.length > 0 && !genericBook && <div className="reading-hub-result-list">{genericResults.map((item, index) => (
                  <button key={`${item.bookUrl}-${index}`} type="button" className="reading-hub-result-card" onClick={async () => {
                    const source = bookSources.find((x) => x.id === selectedSourceId); if (!source) return;
                    setGenericBook(item); setGenericDetail(null); setGenericChapters([]); setSourceLoading(true); setSourceMessage("正在打开详情…");
                    try { const detail = await getGenericDetail(source, item); setGenericDetail(detail); const chapters = await getGenericCatalog(source, detail); setGenericChapters(chapters); setSourceMessage(`目录 ${chapters.length} 章`); }
                    catch (error) { setSourceMessage(error instanceof Error ? error.message : "获取详情失败"); }
                    finally { setSourceLoading(false); }
                  }}><div className="reading-hub-result-cover">{item.cover ? <img src={item.cover} alt="" /> : <BookOpen size={24} />}</div><div className="reading-hub-result-main"><strong>{item.title}</strong><span>{item.author || "未知作者"}</span><small>{item.latestChapterTitle || item.desc || ""}</small></div><ChevronRight size={18} /></button>
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
                              const coverSaved = await downloadCoverForBook(id, cover);
                              const book: Book = { id, title, author, format: "txt", totalChapters: chapters.length, createdAt: new Date().toISOString(), hasCover: coverSaved, coverUrl: cover } as Book & { coverUrl?: string };
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
                            const coverSaved = await downloadCoverForBook(id, cover);
                            const book: Book = { id, title, author, format: "txt", totalChapters: chapters.length, createdAt: new Date().toISOString(), hasCover: coverSaved, coverUrl: cover } as Book & { coverUrl?: string };
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
                {genericBook && <div className="reading-hub-detail-page"><button type="button" className="reading-hub-backlink" onClick={() => setGenericBook(null)}>← 返回搜索结果</button>{genericDetail ? <><div className="reading-hub-detail-card"><div className="reading-hub-detail-cover">{genericDetail.cover ? <img src={genericDetail.cover} alt="" /> : <BookOpen size={28} />}</div><div><h3>{genericDetail.title}</h3><p>{genericDetail.author||"未知作者"}</p><small>{genericDetail.desc||"暂无简介"}</small></div></div><button type="button" className="reading-hub-primary" disabled={!genericChapters.length} onClick={async()=>{const source=bookSources.find(x=>x.id===selectedSourceId);if(!source)return;const id=`source_${Date.now()}`;const coverSaved=await downloadCoverForBook(id,genericDetail.cover||genericBook?.cover);const book:Book={id,title:genericDetail.title,author:genericDetail.author,format:"txt",totalChapters:genericChapters.length,createdAt:new Date().toISOString(),hasCover:coverSaved,coverUrl:normalizeRemoteUrl(genericDetail.cover||genericBook?.cover, genericDetail.bookUrl)} as Book & { coverUrl?: string };await addBook(book);await saveChapters(id,genericChapters.map((c,i)=>({id:`${id}_ch${i}`,bookId:id,index:i,title:c.title,paragraphs:[]})));saveReadingRemoteBook(id,{sourceId:source.id,sourceName:source.name,book:{title:genericDetail.title,author:genericDetail.author,cover:normalizeRemoteUrl(genericDetail.cover, genericDetail.bookUrl),desc:genericDetail.desc,bookUrl:genericDetail.bookUrl},chapters:genericChapters,savedAt:new Date().toISOString()});setActiveBook(book);}}>加入书架并开始阅读</button><div className="reading-hub-chapter-list">{genericChapters.slice(0,120).map((c,i)=><div key={`${c.title}-${i}`}><span>{c.title}</span>{(c.isPay||c.isVip)&&<em>付费</em>}</div>)}</div></> : <div className="reading-hub-source-loading">详情加载中…</div>}</div>}
              </section>
            )}

            {tab === "appearance" && (
              <section className="reading-hub-panel">
                <div className="reading-hub-panel-head">
                  <div>
                    <h2>🎨 阅读外观</h2>
                    <p>沿用现有 reading-appearance，不影响聊天 APP。</p>
                  </div>
                </div>

                <div className="reading-hub-appearance-preview">
                  <div className="reading-hub-preview-title">
                    阅读界面预览
                  </div>
                  <div className="reading-hub-preview-text">
                    这是阅读 APP 的独立样式区域。你可以继续使用现有的
                    字体、字号、行距、文本颜色与背景图片设置。
                  </div>
                </div>

                <p className="reading-hub-appearance-help">
                  外观的真正表单仍由现有 ReadingShelf /
                  ReadingAppearanceDialog 管理，这里只做统一入口，避免重新造一套会和原存储冲突的设置。
                </p>

                <button
                  type="button"
                  className="reading-hub-primary"
                  onClick={() => setTab("shelf")}
                >
                  前往书架修改阅读外观
                </button>
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
                const first = next.find((item) => item.enabled)?.id || "";
                if (!selectedSourceId && first) {
                  setSelectedSourceId(first);
                  setHomeModuleSourceId(first);
                }
                setSourceMessage(`已导入 ${result.added} 个书源${result.skipped ? `，跳过 ${result.skipped} 个` : ""}`);
              } catch (error) {
                setSourceMessage(error instanceof Error ? `书源导入失败：${error.message}` : "书源导入失败");
              }
            }}
          />

          {sourceDrawerOpen && (
            <div className="reading-hub-drawer-backdrop" onClick={() => setSourceDrawerOpen(false)}>
              <aside className="reading-hub-drawer" onClick={(e) => e.stopPropagation()}>
                <div className="reading-hub-drawer-head">
                  <strong>书源</strong>
                  <button type="button" onClick={() => setSourceDrawerOpen(false)}><X size={18} /></button>
                </div>
                <div className="reading-hub-drawer-actions">
                  <button type="button" onClick={() => sourceFileInputRef.current?.click()}><Upload size={16} /> 导入书源</button>
                  <button type="button" onClick={() => {
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
                  }}><LogIn size={16} /> 书源登录</button>
                  <button type="button" onClick={() => setTab("appearance")}><Palette size={16} /> 阅读外观</button>
                </div>
                <div className="reading-hub-drawer-section">
                  <div className="reading-hub-drawer-title">首页发现</div>
                  <label className="reading-hub-field reading-hub-drawer-source-select"><span>选择书源</span><select value={homeModuleSourceId} onChange={e=>setHomeModuleSourceId(e.target.value)}>{bookSources.map(source=><option key={source.id} value={source.id}>{source.name}</option>)}</select></label>
                  <div className="reading-hub-drawer-discovered">
                    <div className="reading-hub-drawer-subtitle">发现页榜单</div>
                    <div className="reading-hub-drawer-discovered-list">
                      {(() => {
                        const source = bookSources.find(x => x.id === homeModuleSourceId);
                        const items = source ? discoverSourceModules(source) : [];
                        return items.map(item => {
                          const id = `${source!.id}_${item.title}`;
                          const exists = homeModules.some(x => x.id === id);
                          return <button key={`${item.title}-${item.url}`} type="button" className={exists ? "is-added" : ""} disabled={exists} onClick={() => { persistHomeModules([...homeModules, { id, title:item.title, url:item.url, sourceId:source!.id, enabled:true }]); setHomeModuleData(prev=>{const copy={...prev}; delete copy[id]; return copy;}); }}><Plus size={12}/><span>{item.title}</span>{exists && <em>已添加</em>}</button>;
                        });
                      })()}
                    </div>
                  </div>
                  <button type="button" className="reading-hub-drawer-wide-action" onClick={() => { setTab("home"); setHomeModuleEditorOpen(v => !v); }}>＋ 自定义首页模块</button>
                  <div className="reading-hub-drawer-module-list">
                    {homeModules.map((module, index) => (
                      <div key={module.id} className="reading-hub-drawer-module">
                        <span>{module.title}</span>
                        <div>
                          <button type="button" onClick={() => { if (index <= 0) return; const next=[...homeModules]; [next[index-1],next[index]]=[next[index],next[index-1]]; persistHomeModules(next); }}>↑</button>
                          <button type="button" onClick={() => { if (index >= homeModules.length-1) return; const next=[...homeModules]; [next[index],next[index+1]]=[next[index+1],next[index]]; persistHomeModules(next); }}>↓</button>
                          <button type="button" onClick={() => { persistHomeModules(homeModules.filter(x => x.id !== module.id)); setHomeModuleData(prev => { const copy={...prev}; delete copy[module.id]; return copy; }); }}>×</button>
                        </div>
                      </div>
                    ))}
                  </div>
                  {homeModuleEditorOpen && <div className="reading-hub-module-form">
                    <label className="reading-hub-field"><span>模块名称</span><input value={homeModuleTitle} onChange={e=>setHomeModuleTitle(e.target.value)} placeholder="例如：女频新书榜 · 快穿" /></label>
                    <label className="reading-hub-field"><span>模块地址</span><input value={homeModuleUrl} onChange={e=>setHomeModuleUrl(e.target.value)} placeholder="https://..." /></label>
                    <label className="reading-hub-field"><span>使用书源</span><select value={homeModuleSourceId} onChange={e=>setHomeModuleSourceId(e.target.value)}>{bookSources.map(source=><option key={source.id} value={source.id}>{source.name}</option>)}</select></label>
                    <button type="button" className="reading-hub-primary" disabled={!homeModuleTitle.trim()||!/^https?:\/\//i.test(homeModuleUrl.trim())||!homeModuleSourceId} onClick={()=>{const id=`custom_${Date.now()}`;persistHomeModules([...homeModules,{id,title:homeModuleTitle.trim(),url:homeModuleUrl.trim(),sourceId:homeModuleSourceId,enabled:true}]);setHomeModuleTitle("");setHomeModuleUrl("");setHomeModuleEditorOpen(false);}}>保存模块</button>
                  </div>}
                </div>

                <div className="reading-hub-drawer-section">
                  <div className="reading-hub-drawer-title">我的书源</div>
                  {bookSources.map((source) => (
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

          {sourceLoginOpen && (
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
