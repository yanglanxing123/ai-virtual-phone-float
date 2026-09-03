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
  const homeModuleAddRef = useRef<HTMLDivElement>(null);

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
        body: JSON.stringify({ url, asset: true, timeoutMs: 12000 }),
      });
      if (!response.ok) return false;
      const blob = await response.blob();
      if (!blob.size || blob.size > 8 * 1024 * 1024) return false;
      await saveCover(bookId, blob);
      return true;
    } catch {
      return false;
    }
  };

  const extractHomeBooks = (value: unknown): GenericSourceBook[] => {
    const list: GenericSourceBook[] = [];
    const seen = new Set<string>();
    const visit = (v: any, depth = 0) => {
      if (depth > 6 || v == null) return;
      if (Array.isArray(v)) { for (const item of v) visit(item, depth + 1); return; }
      if (typeof v !== "object") return;
      const title = v.title ?? v.book_name ?? v.bookName ?? v.name ?? v.book_title ?? v.novel_name;
      const bookUrl = v.book_url ?? v.bookUrl ?? v.url ?? v.detail_url ?? (v.book_id ? String(v.book_id) : "");
      if (title && (bookUrl || v.author || v.cover || v.cover_url || v.image_url)) {
        const key = `${String(title)}|${String(bookUrl)}`;
        if (!seen.has(key)) {
          seen.add(key);
          list.push({
            title: String(title),
            author: v.author ?? v.author_name,
            cover: v.cover ?? v.cover_url ?? v.image_url ?? v.book_cover,
            desc: v.desc ?? v.abstract ?? v.description,
            latestChapterTitle: v.latest_chapter_title ?? v.latestChapterTitle ?? v.last_chapter_title,
            bookUrl: String(bookUrl),
            raw: v,
          });
        }
      }
      for (const item of Object.values(v)) if (item && typeof item === "object") visit(item, depth + 1);
    };
    visit(value);
    return list.slice(0, 20);
  };

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
                <div className="reading-hub-hero"><div><span>DISCOVER</span><strong>首页</strong><p>书源数据可以直接组成首页模块，模块可自由添加和隐藏。</p></div><button type="button" onClick={()=>setTab("sources")}><Search size={16}/> 搜索</button></div>
                <div className="reading-hub-section"><div className="reading-hub-section-head"><div><h2>首页模块</h2><p>例如书山的巅峰榜单、热搜榜单、爆更榜单</p></div><button type="button" onClick={()=>homeModuleAddRef.current?.scrollIntoView({behavior:"smooth",block:"center"})}><Plus size={14}/> 添加模块</button></div>
                  <div className="reading-hub-module-list">{homeModules.filter(x=>x.enabled).map(module=><div key={module.id} className="reading-hub-module"><div className="reading-hub-module-head"><strong>{module.title}</strong><div className="reading-hub-module-actions"><button type="button" title="上移" onClick={()=>{const i=homeModules.findIndex(x=>x.id===module.id);if(i>0){const next=[...homeModules];[next[i-1],next[i]]=[next[i],next[i-1]];persistHomeModules(next);}}}>↑</button><button type="button" title="下移" onClick={()=>{const i=homeModules.findIndex(x=>x.id===module.id);if(i>=0&&i<homeModules.length-1){const next=[...homeModules];[next[i],next[i+1]]=[next[i+1],next[i]];persistHomeModules(next);}}}>↓</button><button type="button" title="删除" onClick={()=>{persistHomeModules(homeModules.filter(x=>x.id!==module.id));setHomeModuleData(prev=>{const copy={...prev};delete copy[module.id];return copy;});}}>×</button><button type="button" title="刷新" onClick={async()=>{setHomeModuleLoading(module.id);try{const source=bookSources.find(x=>x.id===module.sourceId);if(!source)throw new Error("书源不存在");const parsed=await fetchReadingSourceModule(source,module.url,1);setHomeModuleData(prev=>({...prev,[module.id]:extractHomeBooks(parsed)}));}catch(error){setHomeModuleData(prev=>({...prev,[module.id]:[]}));setSourceMessage(error instanceof Error?error.message:"首页模块加载失败");}finally{setHomeModuleLoading(null)}}}>{homeModuleLoading===module.id?<RefreshCw size={14} className="reading-spin"/>:<RefreshCw size={14}/>}</button></div></div>{homeModuleLoading===module.id&&!homeModuleData[module.id]&&<div className="reading-hub-module-empty">正在加载…</div>}{homeModuleData[module.id]?.length>0&&<div className="reading-hub-module-grid">{homeModuleData[module.id].map((book,i)=><button key={`${book.title}-${i}`} type="button" onClick={async()=>{setSourceKeyword(book.title);const source=bookSources.find(x=>x.id===module.sourceId);if(!source)return;setSelectedSourceId(source.id);setTab("sources");}}><div className="reading-hub-module-cover">{book.cover?<img src={book.cover} alt=""/>:<BookOpen size={19}/>}</div><strong>{book.title}</strong><small>{book.author||"未知作者"}</small></button>)}</div>}{!homeModuleData[module.id]&&<div className="reading-hub-module-empty">点击右侧刷新加载</div>}</div>)}</div>
                </div>
                <div ref={homeModuleAddRef} className="reading-hub-section"><div className="reading-hub-section-head"><div><h2>添加首页模块</h2><p>从已导入书源的 exploreUrl 自动发现可用模块</p></div></div>{bookSources.length===0?<div className="reading-hub-module-empty">还没有导入书源。</div>:bookSources.map(source=>{const text=String((source.raw as any)?.exploreUrl||"");const items:Array<{title:string;url:string}>=[];for(const m of text.matchAll(/push\(\s*['\"]([^'\"]+)['\"]\s*,\s*['\"]([^'\"]+)['\"]/g)){items.push({title:m[1],url:m[2]})}return <div key={source.id} className="reading-hub-home-source"><strong>{source.name}</strong><div className="reading-hub-home-source-items">{items.slice(0,12).map(item=><button key={`${item.title}-${item.url}`} type="button" onClick={()=>{const id=`${source.id}_${item.title}`;const next=[...homeModules.filter(x=>x.id!==id),{id,title:item.title,url:item.url,sourceId:source.id,enabled:true}];persistHomeModules(next);setHomeModuleData(prev=>{const copy={...prev};delete copy[id];return copy;}); }}><Plus size={13}/>{item.title}</button>)}</div></div>})}</div>
                <div className="reading-hub-section reading-hub-home-custom-editor">
                  <div className="reading-hub-section-head"><div><h2>自定义首页模块</h2><p>不依赖 exploreUrl，也可以直接添加任意 HTTP/HTTPS JSON 页面。</p></div><button type="button" onClick={()=>setHomeModuleEditorOpen(v=>!v)}><Plus size={14}/> {homeModuleEditorOpen?"收起":"添加"}</button></div>
                  {homeModuleEditorOpen && <div className="reading-hub-module-form">
                    <label className="reading-hub-field"><span>模块名称</span><input value={homeModuleTitle} onChange={e=>setHomeModuleTitle(e.target.value)} placeholder="例如：我的推荐" /></label>
                    <label className="reading-hub-field"><span>模块地址</span><input value={homeModuleUrl} onChange={e=>setHomeModuleUrl(e.target.value)} placeholder="https://example.com/api/list?page={{page}}" /></label>
                    <label className="reading-hub-field"><span>使用书源</span><select value={homeModuleSourceId} onChange={e=>setHomeModuleSourceId(e.target.value)}>{bookSources.map(source=><option key={source.id} value={source.id}>{source.name}</option>)}</select></label>
                    <button type="button" className="reading-hub-primary" disabled={!homeModuleTitle.trim()||!/^https?:\/\//i.test(homeModuleUrl.trim())||!homeModuleSourceId} onClick={()=>{const id=`custom_${Date.now()}`;persistHomeModules([...homeModules,{id,title:homeModuleTitle.trim(),url:homeModuleUrl.trim(),sourceId:homeModuleSourceId,enabled:true}]);setHomeModuleTitle("");setHomeModuleUrl("");setHomeModuleEditorOpen(false);}}>保存模块</button>
                  </div>}
                </div>
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
                    try { const result = await getShushanDetail(loadShushanAccount().apiKey, item); setSourceDetail(result.data); const cat = await getShushanCatalog(loadShushanAccount().apiKey, result.data); setSourceChapters(cat.data || []); setSourceMessage(`目录 ${cat.data?.filter((x) => !x.isVolume).length || 0} 章`); }
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

                {selectedSourceBook && <div className="reading-hub-detail-page"><button type="button" className="reading-hub-backlink" onClick={() => setSelectedSourceBook(null)}>← 返回搜索结果</button>{sourceDetail ? <><div className="reading-hub-detail-card"><div className="reading-hub-detail-cover">{sourceDetail.cover ? <img src={sourceDetail.cover} alt="" /> : <BookOpen size={28} />}</div><div><h3>{sourceDetail.title || selectedSourceBook.title}</h3><p>{sourceDetail.author || "未知作者"} · {sourceDetail.source || "书山"}</p><small>{sourceDetail.desc || "暂无简介"}</small></div></div><button type="button" className="reading-hub-primary" disabled={!sourceChapters.length || sourceLoading} onClick={async () => { const id=`shushan_${Date.now()}`; const coverSaved=await downloadCoverForBook(id,sourceDetail.cover||selectedSourceBook.cover); const book:Book={id,title:sourceDetail.title||selectedSourceBook.title,author:sourceDetail.author||selectedSourceBook.author,format:"txt",totalChapters:sourceChapters.filter(x=>!x.isVolume).length,createdAt:new Date().toISOString(),hasCover:coverSaved}; const chapters=sourceChapters.filter(x=>!x.isVolume).map((c,i)=>({id:`${id}_ch${i}`,bookId:id,index:i,title:c.title||`第${i+1}章`,paragraphs:[] as string[]})); await addBook(book); await saveChapters(id,chapters); saveRemoteBook(id,{source:sourceDetail.source,url:sourceDetail.book_url,name:sourceDetail.title||selectedSourceBook.title,apiKey:loadShushanAccount().apiKey,cover:sourceDetail.cover,desc:sourceDetail.desc,chapters:sourceChapters.filter(x=>!x.isVolume)}); setActiveBook(book); }}>加入书架并开始阅读</button><div className="reading-hub-chapter-list">{sourceChapters.slice(0,120).filter(x=>!x.isVolume).map((c,i)=><div key={`${c.title}-${i}`}><span>{c.title}</span>{(c.isPay||c.isVip)&&<em>付费</em>}</div>)}</div></> : <div className="reading-hub-source-loading">详情加载中…</div>}</div>}
                {genericBook && <div className="reading-hub-detail-page"><button type="button" className="reading-hub-backlink" onClick={() => setGenericBook(null)}>← 返回搜索结果</button>{genericDetail ? <><div className="reading-hub-detail-card"><div className="reading-hub-detail-cover">{genericDetail.cover ? <img src={genericDetail.cover} alt="" /> : <BookOpen size={28} />}</div><div><h3>{genericDetail.title}</h3><p>{genericDetail.author||"未知作者"}</p><small>{genericDetail.desc||"暂无简介"}</small></div></div><button type="button" className="reading-hub-primary" disabled={!genericChapters.length} onClick={async()=>{const source=bookSources.find(x=>x.id===selectedSourceId);if(!source)return;const id=`source_${Date.now()}`;const coverSaved=await downloadCoverForBook(id,genericDetail.cover||genericBook?.cover);const book:Book={id,title:genericDetail.title,author:genericDetail.author,format:"txt",totalChapters:genericChapters.length,createdAt:new Date().toISOString(),hasCover:coverSaved};await addBook(book);await saveChapters(id,genericChapters.map((c,i)=>({id:`${id}_ch${i}`,bookId:id,index:i,title:c.title,paragraphs:[]})));saveReadingRemoteBook(id,{sourceId:source.id,sourceName:source.name,book:{title:genericDetail.title,author:genericDetail.author,cover:normalizeRemoteUrl(genericDetail.cover, genericDetail.bookUrl),desc:genericDetail.desc,bookUrl:genericDetail.bookUrl},chapters:genericChapters,savedAt:new Date().toISOString()});setActiveBook(book);}}>加入书架并开始阅读</button><div className="reading-hub-chapter-list">{genericChapters.slice(0,120).map((c,i)=><div key={`${c.title}-${i}`}><span>{c.title}</span>{(c.isPay||c.isVip)&&<em>付费</em>}</div>)}</div></> : <div className="reading-hub-source-loading">详情加载中…</div>}</div>}
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
                    return controls.length ? <div className="reading-hub-native-functions"><div className="reading-hub-drawer-subtitle">书源原生功能</div>{controls.map((item) => <button type="button" className={!item.action ? "is-separator" : ""} key={`${item.name}-${item.action}`} disabled={!item.action} onClick={() => void runNative(item.action)}><span>{item.name}</span>{item.action && <ChevronRight size={14}/>}</button>)}</div> : null;
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
              active={tab === "home"}
              label="首页"
              icon={<BookOpen size={19} />}
              onClick={() => setTab("home")}
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
