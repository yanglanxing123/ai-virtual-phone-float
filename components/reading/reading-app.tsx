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
import { addBook, saveChapters } from "@/lib/reading-storage";
import { importReadingSources, loadReadingSources, removeReadingSource, setReadingSourceEnabled, updateReadingSourceMeta, saveReadingRemoteBook, clearReadingSourceState, loadReadingSourceState, saveReadingSourceState, type ReadingBookSource } from "@/lib/reading-source";
import { getGenericCatalog, getGenericDetail, searchGenericSource, type GenericSourceBook, type GenericSourceChapter, type GenericSourceDetail } from "@/lib/reading-source-engine";
import "./reading-hub.css";

type Tab = "home" | "shelf" | "sources" | "appearance";

type HomeModule = { id: string; title: string; url: string; sourceId: string; enabled: boolean; };

type LoginField = { name: string; type: string; action?: string };

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
    setSelectedSourceId(installed.find((item) => item.adapter === "shushan" && item.enabled)?.id || installed[0]?.id || "");

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
                  <div className="reading-hub-module-list">{homeModules.filter(x=>x.enabled).map(module=><div key={module.id} className="reading-hub-module"><div className="reading-hub-module-head"><strong>{module.title}</strong><button type="button" onClick={async()=>{setHomeModuleLoading(module.id);try{const res=await fetch("/api/reading/source",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({url:module.url.replace(/\{\{page[^}]*\}\}/g,"0")})});const data=await res.json();const raw=data?.text||"";let parsed:any=null;try{parsed=JSON.parse(raw)}catch{};const list:any[]=[];const visit=(v:any,depth=0)=>{if(depth>4||v==null)return;if(Array.isArray(v)){for(const x of v)visit(x,depth+1);return}if(typeof v!=="object")return;const title=v.title||v.book_name||v.bookName||v.name||v.book_title;if(title){list.push({title:String(title),author:v.author||v.author_name,cover:v.cover||v.cover_url||v.image_url,desc:v.desc||v.abstract||v.description,latestChapterTitle:v.latest_chapter_title,bookUrl:v.book_url||v.bookUrl||String(v.book_id||"") ,raw:v});}for(const x of Object.values(v))if(typeof x==="object")visit(x,depth+1)};visit(parsed);setHomeModuleData(prev=>({...prev,[module.id]:list.slice(0,20)}));}catch{setHomeModuleData(prev=>({...prev,[module.id]:[]}))}finally{setHomeModuleLoading(null)}}}>{homeModuleLoading===module.id?<RefreshCw size={14} className="reading-spin"/>:<RefreshCw size={14}/>}</button></div>{homeModuleLoading===module.id&&!homeModuleData[module.id]&&<div className="reading-hub-module-empty">正在加载…</div>}{homeModuleData[module.id]?.length>0&&<div className="reading-hub-module-grid">{homeModuleData[module.id].map((book,i)=><button key={`${book.title}-${i}`} type="button" onClick={async()=>{setSourceKeyword(book.title);const source=bookSources.find(x=>x.id===module.sourceId);if(!source)return;setSelectedSourceId(source.id);setTab("sources");}}><div className="reading-hub-module-cover">{book.cover?<img src={book.cover} alt=""/>:<BookOpen size={19}/>}</div><strong>{book.title}</strong><small>{book.author||"未知作者"}</small></button>)}</div>}{!homeModuleData[module.id]&&<div className="reading-hub-module-empty">点击右侧刷新加载</div>}</div>)}</div>
                </div>
                <div ref={homeModuleAddRef} className="reading-hub-section"><div className="reading-hub-section-head"><div><h2>添加首页模块</h2><p>从已导入书源的 exploreUrl 自动发现可用模块</p></div></div>{bookSources.length===0?<div className="reading-hub-module-empty">还没有导入书源。</div>:bookSources.map(source=>{const text=String((source.raw as any)?.exploreUrl||"");const items:Array<{title:string;url:string}>=[];for(const m of text.matchAll(/push\(\s*['\"]([^'\"]+)['\"]\s*,\s*['\"]([^'\"]+)['\"]/g)){items.push({title:m[1],url:m[2]})}return <div key={source.id} className="reading-hub-home-source"><strong>{source.name}</strong><div className="reading-hub-home-source-items">{items.slice(0,12).map(item=><button key={`${item.title}-${item.url}`} type="button" onClick={()=>{const id=`${source.id}_${item.title}`;const next=[...homeModules.filter(x=>x.id!==id),{id,title:item.title,url:item.url,sourceId:source.id,enabled:true}];setHomeModules(next);try{window.localStorage.setItem("reading-home-modules-v2",JSON.stringify(next))}catch{} }}><Plus size={13}/>{item.title}</button>)}</div></div>})}</div>
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
                        if (!account.apiKey) throw new Error("请从右上角「书源管理」打开书源自带登录");
                        const result = await searchShushan(account.apiKey, keyword.trim(), inlineSource?.trim() || "", 1);
                        setSourceResults(result.data || []); setSourceMessage(result.data?.length ? `找到 ${result.data.length} 本相关书籍` : "没有找到结果");
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

                {selectedSourceBook && <div className="reading-hub-detail-page"><button type="button" className="reading-hub-backlink" onClick={() => setSelectedSourceBook(null)}>← 返回搜索结果</button>{sourceDetail ? <><div className="reading-hub-detail-card"><div className="reading-hub-detail-cover">{sourceDetail.cover ? <img src={sourceDetail.cover} alt="" /> : <BookOpen size={28} />}</div><div><h3>{sourceDetail.title || selectedSourceBook.title}</h3><p>{sourceDetail.author || "未知作者"} · {sourceDetail.source || "书山"}</p><small>{sourceDetail.desc || "暂无简介"}</small></div></div><button type="button" className="reading-hub-primary" disabled={!sourceChapters.length || sourceLoading} onClick={async () => { const id=`shushan_${Date.now()}`; const book:Book={id,title:sourceDetail.title||selectedSourceBook.title,author:sourceDetail.author||selectedSourceBook.author,format:"txt",totalChapters:sourceChapters.filter(x=>!x.isVolume).length,createdAt:new Date().toISOString(),hasCover:false}; const chapters=sourceChapters.filter(x=>!x.isVolume).map((c,i)=>({id:`${id}_ch${i}`,bookId:id,index:i,title:c.title||`第${i+1}章`,paragraphs:[] as string[]})); await addBook(book); await saveChapters(id,chapters); saveRemoteBook(id,{source:sourceDetail.source,url:sourceDetail.book_url,name:sourceDetail.title||selectedSourceBook.title,apiKey:loadShushanAccount().apiKey,cover:sourceDetail.cover,desc:sourceDetail.desc,chapters:sourceChapters.filter(x=>!x.isVolume)}); setActiveBook(book); }}>加入书架并开始阅读</button><div className="reading-hub-chapter-list">{sourceChapters.slice(0,120).filter(x=>!x.isVolume).map((c,i)=><div key={`${c.title}-${i}`}><span>{c.title}</span>{(c.isPay||c.isVip)&&<em>付费</em>}</div>)}</div></> : <div className="reading-hub-source-loading">详情加载中…</div>}</div>}
                {genericBook && <div className="reading-hub-detail-page"><button type="button" className="reading-hub-backlink" onClick={() => setGenericBook(null)}>← 返回搜索结果</button>{genericDetail ? <><div className="reading-hub-detail-card"><div className="reading-hub-detail-cover">{genericDetail.cover ? <img src={genericDetail.cover} alt="" /> : <BookOpen size={28} />}</div><div><h3>{genericDetail.title}</h3><p>{genericDetail.author||"未知作者"}</p><small>{genericDetail.desc||"暂无简介"}</small></div></div><button type="button" className="reading-hub-primary" disabled={!genericChapters.length} onClick={async()=>{const source=bookSources.find(x=>x.id===selectedSourceId);if(!source)return;const id=`source_${Date.now()}`;const book:Book={id,title:genericDetail.title,author:genericDetail.author,format:"txt",totalChapters:genericChapters.length,createdAt:new Date().toISOString()};await addBook(book);await saveChapters(id,genericChapters.map((c,i)=>({id:`${id}_ch${i}`,bookId:id,index:i,title:c.title,paragraphs:[]})));saveReadingRemoteBook(id,{sourceId:source.id,sourceName:source.name,book:{title:genericDetail.title,author:genericDetail.author,cover:genericDetail.cover,desc:genericDetail.desc,bookUrl:genericDetail.bookUrl},chapters:genericChapters,savedAt:new Date().toISOString()});setActiveBook(book);}}>加入书架并开始阅读</button><div className="reading-hub-chapter-list">{genericChapters.slice(0,120).map((c,i)=><div key={`${c.title}-${i}`}><span>{c.title}</span>{(c.isPay||c.isVip)&&<em>付费</em>}</div>)}</div></> : <div className="reading-hub-source-loading">详情加载中…</div>}</div>}
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
                      const host = selected.url || "https://v1.vossc.com";
                      const open = (url: string) => { try { window.open(url, "_blank", "noopener,noreferrer"); } catch { window.location.href = url; } };
                      if (/^key\(\)/i.test(action)) return open(`${host}/user_login`);
                      if (/^user_center\(\)/i.test(action)) return open(`${host}/user_center`);
                      if (/^version\(\)/i.test(action)) return open(`${host}/version?id=5.37`);
                      if (/^password\(\)/i.test(action)) return open(`${host}/forgot_password`);
                      if (/^fb\(\)/i.test(action)) return open("https://fb.shushan.vip");
                      if (/^user_logout\(\)/i.test(action)) { clearShushanAccount(); setSourceAccount({ email: "", password: "", apiKey: "", saved: false }); setSourceResults([]); setSourceDetail(null); setSelectedSourceBook(null); setSourceChapters([]); setSourceMessage("已按书源动作退出登录"); return; }
                      if (/^boy\(\)/i.test(action) || /^girl\(\)/i.test(action)) {
                        const gender = /^boy/i.test(action) ? "boy" : "girl"; saveReadingSourceState(selected.id, { variables: { ...(loadReadingSourceState(selected.id).variables || {}), gender }, updatedAt: new Date().toISOString() }); setSourceMessage(gender === "boy" ? "已切换男频" : "已切换女频"); return;
                      }
                      if (/^type[1-4]\(\)/i.test(action)) { const type = action.match(/^type([1-4])/i)?.[1] || "1"; saveReadingSourceState(selected.id, { variables: { ...(loadReadingSourceState(selected.id).variables || {}), type }, updatedAt: new Date().toISOString() }); setSourceMessage(`已切换模式：${["", "小说", "听书", "漫画", "视频"][Number(type)]}`); return; }
                      setSourceMessage("这个原生按钮已显示，但当前没有安全的直接执行器；不会运行陌生 JavaScript。");
                    };
                    return controls.length ? <div className="reading-hub-native-functions"><div className="reading-hub-drawer-subtitle">书源原生功能</div>{controls.slice(0, 16).map((item) => <button type="button" key={`${item.name}-${item.action}`} onClick={() => void runNative(item.action)}><span>{item.name}</span><ChevronRight size={14}/></button>)}</div> : null;
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
