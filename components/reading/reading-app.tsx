"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { BookOpen, Library, Search, Palette, X, Upload, Trash2 } from "lucide-react";
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
import { importReadingSources, loadReadingSources, removeReadingSource, setReadingSourceEnabled, updateReadingSourceMeta, sourceCapabilities, saveReadingRemoteBook, clearReadingSourceState, type ReadingBookSource } from "@/lib/reading-source";
import { getGenericCatalog, getGenericDetail, searchGenericSource, testGenericSource, type GenericSourceBook, type GenericSourceChapter, type GenericSourceDetail, type GenericSourceTestReport } from "@/lib/reading-source-engine";
import "./reading-hub.css";

type Tab = "home" | "shelf" | "sources" | "appearance";

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
  const [sourceAccount, setSourceAccount] = useState<ShushanAccount>({ email: "", password: "", apiKey: "", saved: false });
  const [sourceKeyword, setSourceKeyword] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [sourceResults, setSourceResults] = useState<ShushanSearchBook[]>([]);
  const [sourceLoading, setSourceLoading] = useState(false);
  const [sourceMessage, setSourceMessage] = useState("");
  const [sourceTestLoading, setSourceTestLoading] = useState(false);
  const [sourceTestReport, setSourceTestReport] = useState<GenericSourceTestReport | null>(null);
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
    setSourceAccount(loadShushanAccount());
    const installed = loadReadingSources();
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
                <div className="reading-hub-hero">
                  <div>
                    <span>WELCOME BACK</span>
                    <strong>想读点什么？</strong>
                    <p>书架、书源和阅读外观统一放在这里管理。</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setTab("sources")}
                  >
                    <Search size={16} />
                    查找书籍
                  </button>
                </div>

                <div className="reading-hub-section">
                  <div className="reading-hub-section-head">
                    <div>
                      <h2>最近阅读</h2>
                      <p>继续使用原有阅读记录</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setTab("shelf")}
                    >
                      查看书架
                    </button>
                  </div>
                  <div className="reading-hub-placeholder">
                    <BookOpen size={22} />
                    <span>
                      最近阅读直接使用现有阅读存储；打开书架后会保留原来的章节和进度。
                    </span>
                  </div>
                </div>

                <div className="reading-hub-grid">
                  <button
                    type="button"
                    className="reading-hub-card"
                    onClick={() => setTab("sources")}
                  >
                    <span className="reading-hub-card-icon">
                      <Search size={18} />
                    </span>
                    <strong>书源搜索</strong>
                    <small>书山聚合 / 登录后搜索</small>
                  </button>

                  <button
                    type="button"
                    className="reading-hub-card"
                    onClick={() => setTab("appearance")}
                  >
                    <span className="reading-hub-card-icon">
                      <Palette size={18} />
                    </span>
                    <strong>阅读外观</strong>
                    <small>字体、背景、字号和行距</small>
                  </button>

                  <button
                    type="button"
                    className="reading-hub-card"
                    onClick={() => setTab("shelf")}
                  >
                    <span className="reading-hub-card-icon">
                      <Library size={18} />
                    </span>
                    <strong>我的书架</strong>
                    <small>使用现有 ReadingShelf</small>
                  </button>

                  <div className="reading-hub-card is-disabled">
                    <span className="reading-hub-card-icon">
                      <BookOpen size={18} />
                    </span>
                    <strong>分类排行榜</strong>
                    <small>等待书源数据接入</small>
                  </div>
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
              <section className="reading-hub-panel">
                <div className="reading-hub-panel-head">
                  <div>
                    <h2>📚 书源</h2>
                    <p>像阅读类 App 一样导入 JSON 书源；已识别的书源会自动绑定对应适配器。</p>
                  </div>
                </div>

                <input
                  ref={sourceFileInputRef}
                  type="file"
                  accept=".json,application/json"
                  multiple
                  hidden
                  onChange={async (e) => {
                    const files = Array.from(e.target.files || []);
                    if (!files.length) return;
                    let added = 0;
                    let skipped = 0;
                    try {
                      for (const file of files) {
                        const parsed = JSON.parse(await file.text());
                        const result = importReadingSources(parsed);
                        added += result.added;
                        skipped += result.skipped;
                      }
                      const next = loadReadingSources();
                      setBookSources(next);
                      setSelectedSourceId((current) => current || next[0]?.id || "");
                      setSourceMessage(`✅ 导入完成：新增 ${added} 个书源${skipped ? `，跳过 ${skipped} 个无效项目` : ""}`);
                    } catch (error) {
                      setSourceMessage(error instanceof Error ? `❌ 导入失败：${error.message}` : "❌ 导入失败");
                    } finally {
                      e.target.value = "";
                    }
                  }}
                />

                <div className="reading-hub-source-toolbar">
                  <button type="button" className="reading-hub-primary" onClick={() => sourceFileInputRef.current?.click()}>
                    <Upload size={15} /> 导入书源 JSON
                  </button>
                  <span className="reading-hub-source-tip">支持阅读/Legado 风格单个对象或数组；JS/Java 规则暂不直接执行。</span>
                </div>

                <div className="reading-hub-source-list">
                  {bookSources.length === 0 ? (
                    <div className="reading-hub-source-empty">还没有书源。先导入你手里的书源 JSON，例如「📚书山聚合」。</div>
                  ) : bookSources.map((source) => (
                    <div key={source.id} className={`reading-hub-source-item${selectedSourceId === source.id ? " is-active" : ""}`}>
                      <button type="button" className="reading-hub-source-main" onClick={() => { setSelectedSourceId(source.id); setEditingSource(false); setSourceEditName(source.name); setSourceEditGroup(source.group || ""); setSourceMessage(""); setSourceTestReport(null); setGenericResults([]); setGenericBook(null); setGenericDetail(null); setGenericChapters([]); setSourceResults([]); setSelectedSourceBook(null); setSourceDetail(null); setSourceChapters([]); }}>
                        <strong>{source.name}</strong>
                        <span>{source.group || "未分组"} · {source.adapter === "shushan" ? "✅ 已适配" : "🧩 通用解析器"}</span>
                      </button>
                      <label className="reading-hub-source-switch">
                        <input type="checkbox" checked={source.enabled} onChange={(e) => { setReadingSourceEnabled(source.id, e.target.checked); setBookSources(loadReadingSources()); }} />
                        <span>启用</span>
                      </label>
                      <button type="button" className="reading-hub-source-delete" aria-label={`删除${source.name}`} onClick={() => { removeReadingSource(source.id); const next = loadReadingSources(); setBookSources(next); if (selectedSourceId === source.id) setSelectedSourceId(next[0]?.id || ""); }}>
                        <Trash2 size={15} />
                      </button>
                    </div>
                  ))}
                </div>

                <div className="reading-hub-source-divider" />

                {bookSources.find((item) => item.id === selectedSourceId) && (() => {
                  const selected = bookSources.find((item) => item.id === selectedSourceId)!;
                  return (
                    <div className="reading-hub-source-settings">
                      <div className="reading-hub-source-settings-head">
                        <div>
                          <strong>⚙️ 书源管理</strong>
                          <small>{selected.url || "本地适配器"}</small>
                        </div>
                        <button type="button" className="reading-hub-secondary" onClick={() => {
                          setEditingSource((value) => {
                            const next = !value;
                            if (next) { setSourceEditName(selected.name); setSourceEditGroup(selected.group || ""); }
                            return next;
                          });
                        }}>{editingSource ? "取消编辑" : "编辑信息"}</button>
                      </div>
                      {editingSource && (
                        <div className="reading-hub-source-edit">
                          <label className="reading-hub-field"><span>书源名称</span><input value={sourceEditName} onChange={(e) => setSourceEditName(e.target.value)} placeholder="例如：番茄小说" /></label>
                          <label className="reading-hub-field"><span>分组</span><input value={sourceEditGroup} onChange={(e) => setSourceEditGroup(e.target.value)} placeholder="例如：小说 / 聚合书源" /></label>
                          <div className="reading-hub-inline-actions">
                            <button type="button" className="reading-hub-primary" onClick={() => {
                              const updated = updateReadingSourceMeta(selected.id, { name: sourceEditName, group: sourceEditGroup });
                              const next = loadReadingSources();
                              setBookSources(next);
                              setEditingSource(false);
                              setSourceMessage(updated ? "✅ 书源信息已保存" : "保存失败");
                            }}>保存修改</button>
                            <button type="button" className="reading-hub-secondary" onClick={() => { clearReadingSourceState(selected.id); setSourceMessage("已清除该书源的 Cookie / 会话状态"); }}>清除登录状态</button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}

                {bookSources.find((item) => item.id === selectedSourceId)?.adapter === "shushan" ? (
                  <>
                    <div className="reading-hub-source-selected">当前书源：<strong>{bookSources.find((item) => item.id === selectedSourceId)?.name}</strong></div>
                    <div className="reading-hub-source-note">
                      这是从你导入的书山 JSON 自动识别出来的适配器。账号、搜索、详情、目录和正文仍走现有书山接口层；书源 JSON 本身只负责描述来源，不在浏览器里执行整套 Legado Java 脚本。
                    </div>

                    <label className="reading-hub-field">
                      <span>邮箱 / 账号</span>
                      <input value={sourceAccount.email} onChange={(e) => setSourceAccount((prev) => ({ ...prev, email: e.target.value, saved: false }))} autoComplete="username" inputMode="email" placeholder="请输入书山账号" />
                    </label>
                    <label className="reading-hub-field">
                      <span>密码</span>
                      <input type="password" value={sourceAccount.password} onChange={(e) => setSourceAccount((prev) => ({ ...prev, password: e.target.value, saved: false }))} autoComplete="current-password" placeholder="请输入密码" />
                    </label>
                    <div className="reading-hub-inline-actions">
                      <button type="button" className="reading-hub-primary" disabled={sourceLoading} onClick={async () => {
                        const email = sourceAccount.email.trim();
                        const password = sourceAccount.password;
                        if (!email || !password) { setSourceMessage("请先填写邮箱和密码"); return; }
                        setSourceLoading(true); setSourceMessage("正在登录书山…");
                        try {
                          const result = await (await import("@/lib/shushan-client")).loginShushan(email, password);
                          const next: ShushanAccount = { email, password, apiKey: result.apiKey, saved: true, nickname: result.user?.nickname, isMember: result.user?.is_member === true };
                          setSourceAccount(next); saveShushanAccount(next);
                          setSourceMessage(`${result.user?.is_member ? "👑 会员" : "✅"} 登录成功${result.user?.nickname ? ` · ${result.user.nickname}` : ""}`);
                        } catch (error) { setSourceMessage(error instanceof Error ? error.message : "登录失败"); } finally { setSourceLoading(false); }
                      }}>{sourceLoading ? "处理中…" : sourceAccount.saved ? "✓ 已登录 · 重新登录" : "✓ 登录并保存"}</button>
                      <button type="button" className="reading-hub-secondary" onClick={() => { clearShushanAccount(); setSourceAccount({ email: "", password: "", apiKey: "", saved: false }); setSourceResults([]); setSelectedSourceBook(null); setSourceDetail(null); setSourceChapters([]); setSourceMessage("已退出书山"); }}>退出登录</button>
                    </div>
                    {sourceMessage && <p className="reading-hub-source-status">{sourceMessage}</p>}

                    <div className="reading-hub-source-divider" />
                    <div className="reading-hub-searchbox">
                      <Search size={17} />
                      <input disabled={!sourceAccount.saved || sourceLoading} value={sourceKeyword} onChange={(e) => setSourceKeyword(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { const button = e.currentTarget.parentElement?.querySelector("button"); (button as HTMLButtonElement | null)?.click(); } }} placeholder={sourceAccount.saved ? "输入书名；也支持 书名@番茄小说" : "请先登录书山"} />
                      <button type="button" disabled={!sourceAccount.saved || sourceLoading || !sourceKeyword.trim()} onClick={async () => {
                        if (!sourceAccount.apiKey || !sourceKeyword.trim()) return;
                        const raw = sourceKeyword.trim(); const [keyword, inlineSource] = raw.split("@");
                        setSourceLoading(true); setSourceMessage("");
                        try { const result = await searchShushan(sourceAccount.apiKey, keyword.trim(), inlineSource?.trim() || sourceFilter, 1); setSourceResults(result.data || []); setSourceMessage(result.data?.length ? `找到 ${result.data.length} 本相关书籍` : "没有找到结果"); }
                        catch (error) { setSourceResults([]); setSourceMessage(error instanceof Error ? error.message : "搜索失败"); }
                        finally { setSourceLoading(false); }
                      }}>搜索</button>
                    </div>
                    <label className="reading-hub-field reading-hub-source-filter"><span>指定来源（可留空）</span><input value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)} placeholder="例如：番茄小说，七猫" /></label>
                    {sourceResults.length > 0 && <div className="reading-hub-book-results">{sourceResults.map((item, index) => <button key={`${item.source}-${item.book_url}-${index}`} type="button" className="reading-hub-book-result" onClick={() => { setSelectedSourceBook(item); setSourceDetail(null); setSourceChapters([]); }}><div className="reading-hub-book-cover">{item.cover ? <img src={item.cover} alt="" /> : <BookOpen size={20} />}</div><div className="reading-hub-book-result-copy"><strong>{item.title || "未命名"}</strong><span>{item.author || "未知作者"} · {item.source || "书山"}</span><small>{item.latestChapterTitle || item.desc || "点击查看详情"}</small></div></button>)}</div>}
                    {selectedSourceBook && <div className="reading-hub-source-detail">
                      <div className="reading-hub-detail-head"><button type="button" onClick={() => setSelectedSourceBook(null)}>← 返回搜索结果</button><strong>{selectedSourceBook.title}</strong></div>
                      {!sourceDetail ? <button type="button" className="reading-hub-primary" disabled={sourceLoading} onClick={async () => {
                        if (!sourceAccount.apiKey) return; setSourceLoading(true); setSourceMessage("正在读取书籍详情…");
                        try { const result = await getShushanDetail(sourceAccount.apiKey, selectedSourceBook); setSourceDetail(result.data); const cat = await getShushanCatalog(sourceAccount.apiKey, result.data); setSourceChapters(cat.data || []); setSourceMessage(`目录 ${cat.data?.length || 0} 章`); }
                        catch (error) { setSourceMessage(error instanceof Error ? error.message : "获取详情失败"); } finally { setSourceLoading(false); }
                      }}>查看详情与目录</button> : <>
                        <div className="reading-hub-detail-card"><div className="reading-hub-detail-cover">{sourceDetail.cover ? <img src={sourceDetail.cover} alt="" /> : <BookOpen size={28} />}</div><div><h3>{sourceDetail.title || selectedSourceBook.title}</h3><p>{sourceDetail.author || "未知作者"} · {sourceDetail.source || "书山"}</p><small>{sourceDetail.desc || "暂无简介"}</small></div></div>
                        <button type="button" className="reading-hub-primary" disabled={sourceChapters.length === 0 || sourceLoading} onClick={async () => {
                          if (!sourceDetail || !sourceAccount.apiKey) return; const id = `shushan_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`; const book: Book = { id, title: sourceDetail.title || selectedSourceBook.title, author: sourceDetail.author || selectedSourceBook.author, format: "txt", totalChapters: sourceChapters.filter(ch => !ch.isVolume).length, createdAt: new Date().toISOString(), hasCover: false }; const chapters = sourceChapters.filter(ch => !ch.isVolume).map((chapter, index) => ({ id: `${id}_ch${index}`, bookId: id, index, title: chapter.title || `第${index + 1}章`, paragraphs: [] as string[] }));
                          setSourceLoading(true); try { await addBook(book); await saveChapters(id, chapters); saveRemoteBook(id, { source: sourceDetail.source, url: sourceDetail.book_url, name: sourceDetail.title || selectedSourceBook.title, apiKey: sourceAccount.apiKey, cover: sourceDetail.cover, desc: sourceDetail.desc, chapters: sourceChapters.filter(ch => !ch.isVolume) }); setSourceMessage("✅ 已加入书架，正在打开阅读器"); setActiveBook(book); } catch (error) { setSourceMessage(error instanceof Error ? error.message : "加入书架失败"); } finally { setSourceLoading(false); }
                        }}>➕ 加入书架并开始阅读</button>
                        <div className="reading-hub-chapter-list">{sourceChapters.slice(0, 120).map((chapter, index) => <div key={`${chapter.title}-${index}`} className={chapter.isPay || chapter.isVip ? "is-pay" : ""}><span>{chapter.title || `第${index + 1}章`}</span>{(chapter.isPay || chapter.isVip) && <em>付费</em>}</div>)}{sourceChapters.length > 120 && <small>已显示前 120 章，阅读时按需加载正文。</small>}</div>
                      </>}
                    </div>}
                  </>
                ) : selectedSourceId ? (() => {
                  const currentSource = bookSources.find((item) => item.id === selectedSourceId);
                  if (!currentSource) return null;
                  const caps = sourceCapabilities(currentSource);
                  return (
                    <div>
                      <div className="reading-hub-source-selected">当前书源：<strong>{currentSource.name}</strong></div>
                      <div className="reading-hub-source-note">{caps.mode === "通用规则" ? "这个书源可以直接使用通用 HTTP/CSS/JSON/XPath 规则。" : caps.safeJs ? "这个书源含有少量可安全转换的 JS 规则；能识别的会自动兼容，其余脚本不会直接执行。" : "这个书源含有 JS/Java 规则；通用引擎不会直接执行陌生脚本，测试器会标出需要兼容适配的步骤。"}</div>
                      <div className="reading-hub-source-testbar">
                        <button type="button" className="reading-hub-secondary" disabled={sourceTestLoading || !sourceKeyword.trim()} onClick={async () => {
                          setSourceTestLoading(true); setSourceTestReport(null); setSourceMessage("");
                          try { const report = await testGenericSource(currentSource, sourceKeyword.trim()); setSourceTestReport(report); setSourceMessage("书源测试完成"); }
                          catch (error) { setSourceMessage(error instanceof Error ? error.message : "书源测试失败"); }
                          finally { setSourceTestLoading(false); }
                        }}>{sourceTestLoading ? "测试中…" : "🧪 测试书源"}</button>
                      </div>
                      {sourceTestReport && <div className="reading-hub-source-testreport">
                        <div className="reading-hub-source-testhead"><strong>自动检测：{sourceTestReport.mode}</strong><span>{sourceTestReport.hasJs ? (sourceCapabilities(currentSource).safeJs ? "含可安全转换 JS" : "含 JS/Java") : "纯规则"}</span></div>
                        {sourceTestReport.steps.map((step) => <div key={`${step.key}-${step.message}`} className={`reading-hub-source-teststep is-${step.status}`}><span>{step.status === "ok" ? "✅" : step.status === "warn" ? "⚠️" : "❌"}</span><strong>{step.key === "search" ? "搜索" : step.key === "detail" ? "详情" : step.key === "catalog" ? "目录" : "正文"}</strong><small>{step.message}</small></div>)}
                      </div>}
                      <div className="reading-hub-searchbox">
                        <Search size={17} />
                        <input value={sourceKeyword} onChange={(e) => setSourceKeyword(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") (e.currentTarget.parentElement?.querySelector("button") as HTMLButtonElement | null)?.click(); }} placeholder="输入书名搜索" />
                        <button type="button" disabled={sourceLoading || !sourceKeyword.trim()} onClick={async () => {
                          setSourceLoading(true); setSourceMessage("");
                          try { const result = await searchGenericSource(currentSource, sourceKeyword.trim(), 1); setGenericResults(result); setGenericBook(null); setGenericDetail(null); setGenericChapters([]); setSourceMessage(result.length ? `找到 ${result.length} 本相关书籍` : "没有找到结果"); }
                          catch (error) { setGenericResults([]); setSourceMessage(error instanceof Error ? error.message : "通用搜索失败"); }
                          finally { setSourceLoading(false); }
                        }}>搜索</button>
                      </div>
                      {sourceMessage && <p className="reading-hub-source-status">{sourceMessage}</p>}
                      {genericResults.length > 0 && !genericBook && <div className="reading-hub-book-results">{genericResults.map((item, index) => (
                        <button key={`${item.bookUrl}-${index}`} type="button" className="reading-hub-book-result" onClick={() => setGenericBook(item)}>
                          <div className="reading-hub-book-cover">{item.cover ? <img src={item.cover} alt="" /> : <BookOpen size={20} />}</div>
                          <div className="reading-hub-book-result-copy"><strong>{item.title}</strong><span>{item.author || "未知作者"}</span><small>{item.latestChapterTitle || item.desc || "点击查看详情"}</small></div>
                        </button>
                      ))}</div>}
                      {genericBook && <div className="reading-hub-source-detail">
                        <div className="reading-hub-detail-head"><button type="button" onClick={() => { setGenericBook(null); setGenericDetail(null); setGenericChapters([]); }}>← 返回搜索结果</button><strong>{genericBook.title}</strong></div>
                        {!genericDetail ? <button type="button" className="reading-hub-primary" disabled={sourceLoading} onClick={async () => {
                          setSourceLoading(true); setSourceMessage("正在读取详情与目录…");
                          try { const detail = await getGenericDetail(currentSource, genericBook); setGenericDetail(detail); const chapters = await getGenericCatalog(currentSource, detail); setGenericChapters(chapters); setSourceMessage(`目录 ${chapters.length} 章`); }
                          catch (error) { setSourceMessage(error instanceof Error ? error.message : "获取详情失败"); } finally { setSourceLoading(false); }
                        }}>查看详情与目录</button> : <>
                          <div className="reading-hub-detail-card"><div className="reading-hub-detail-cover">{genericDetail.cover ? <img src={genericDetail.cover} alt="" /> : <BookOpen size={28} />}</div><div><h3>{genericDetail.title}</h3><p>{genericDetail.author || "未知作者"}</p><small>{genericDetail.desc || "暂无简介"}</small></div></div>
                          <button type="button" className="reading-hub-primary" disabled={!genericChapters.length} onClick={async () => {
                            const id = `source_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
                            const book: Book = { id, title: genericDetail.title, author: genericDetail.author, format: "txt", totalChapters: genericChapters.length, createdAt: new Date().toISOString(), hasCover: false };
                            const chapters = genericChapters.map((chapter, index) => ({ id: `${id}_ch${index}`, bookId: id, index, title: chapter.title || `第${index + 1}章`, paragraphs: [] as string[] }));
                            try { await addBook(book); await saveChapters(id, chapters); saveReadingRemoteBook(id, { sourceId: currentSource.id, sourceName: currentSource.name, book: { title: genericDetail.title, author: genericDetail.author, cover: genericDetail.cover, desc: genericDetail.desc, bookUrl: genericDetail.bookUrl }, chapters, savedAt: new Date().toISOString() }); setActiveBook(book); setSourceMessage("✅ 已加入书架，正在打开阅读器"); }
                            catch (error) { setSourceMessage(error instanceof Error ? error.message : "加入书架失败"); }
                          }}>➕ 加入书架并开始阅读</button>
                          <div className="reading-hub-chapter-list">{genericChapters.slice(0, 120).map((chapter, index) => <div key={`${chapter.title}-${index}`} className={chapter.isPay || chapter.isVip ? "is-pay" : ""}><span>{chapter.title}</span>{(chapter.isPay || chapter.isVip) && <em>付费</em>}</div>)}</div>
                        </>}
                      </div>}
                    </div>
                  );
                })() : null}
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
