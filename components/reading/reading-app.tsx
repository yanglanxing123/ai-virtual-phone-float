"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { BookOpen, Palette, Plus, Search, Sparkles, Trophy, Library, X, LogIn } from "lucide-react";
import { ReadingViewer } from "./reading-viewer";
import type { Book } from "@/lib/reading-types";
import "./reading-hub.css";

type HomeModule = {
  id: string;
  title: string;
  subtitle: string;
  icon: "trophy" | "sparkles" | "book" | "library";
  enabled: boolean;
};

type SourceAccount = { email: string; password: string; saved: boolean };

const BOOKS_KEY = "reading-hub-books-v1";
const MODULES_KEY = "reading-hub-modules-v1";
const SHUSHAN_KEY = "reading-shushan-account-v1";

const defaultModules: HomeModule[] = [
  { id: "ranking", title: "分类排行榜", subtitle: "按分类看看近期热门作品", icon: "trophy", enabled: true },
  { id: "popular", title: "热门小说", subtitle: "为你整理值得关注的作品", icon: "sparkles", enabled: true },
  { id: "recent", title: "最近阅读", subtitle: "从上次停下的地方继续", icon: "book", enabled: true },
  { id: "shelf", title: "我的书架", subtitle: "收藏的书都在这里", icon: "library", enabled: true },
];

function loadJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function saveJson<T>(key: string, value: T) {
  try { window.localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

function moduleIcon(icon: HomeModule["icon"]) {
  if (icon === "trophy") return <Trophy size={18} />;
  if (icon === "sparkles") return <Sparkles size={18} />;
  if (icon === "library") return <Library size={18} />;
  return <BookOpen size={18} />;
}

export default function ReadingApp({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<"home" | "shelf" | "sources" | "appearance">("home");
  const [books, setBooks] = useState<Book[]>(() => loadJson<Book[]>(BOOKS_KEY, []));
  const [modules, setModules] = useState<HomeModule[]>(() => loadJson<HomeModule[]>(MODULES_KEY, defaultModules));
  const [sourceAccount, setSourceAccount] = useState<SourceAccount>(() => loadJson<SourceAccount>(SHUSHAN_KEY, { email: "", password: "", saved: false }));
  const [sourceSearch, setSourceSearch] = useState("");
  const [readingBook, setReadingBook] = useState<Book | null>(null);
  const [customCss, setCustomCss] = useState(() => {
    if (typeof window === "undefined") return "";
    return window.localStorage.getItem("reading-custom-css-v1") || "";
  });
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => saveJson(BOOKS_KEY, books), [books]);
  useEffect(() => saveJson(MODULES_KEY, modules), [modules]);

  const filteredModules = useMemo(() => modules.filter(m => m.enabled), [modules]);
  const recentBooks = useMemo(() => [...books].sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || "")).slice(0, 4), [books]);

  const importBook = async (file: File) => {
    const ext = file.name.toLowerCase().split(".").pop() || "";
    if (!(["txt", "epub", "pdf"].includes(ext))) return;
    const id = `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const next: Book = {
      id,
      title: file.name.replace(/\.[^.]+$/, ""),
      author: "",
      format: ext,
      updatedAt: new Date().toISOString(),
    };
    setBooks(prev => [next, ...prev.filter(b => b.id !== id)]);
  };

  const saveShushan = () => {
    const next = { ...sourceAccount, saved: Boolean(sourceAccount.email.trim() && sourceAccount.password) };
    setSourceAccount(next);
    saveJson(SHUSHAN_KEY, next);
  };

  const toggleModule = (id: string) => setModules(prev => prev.map(m => m.id === id ? { ...m, enabled: !m.enabled } : m));

  if (readingBook) {
    return <ReadingViewer book={readingBook} onBack={() => setReadingBook(null)} />;
  }

  return (
    <div className="reading-hub reading-app-surface">
      <header className="reading-hub-header">
        <div>
          <div className="reading-hub-kicker">READING</div>
          <h1>{tab === "home" ? "首页" : tab === "shelf" ? "书架" : tab === "sources" ? "书源" : "外观"}</h1>
        </div>
        <div className="reading-hub-actions">
          <button type="button" className="reading-hub-icon-btn" onClick={() => fileInputRef.current?.click()} aria-label="导入书籍"><Plus size={19} /></button>
          <button type="button" className="reading-hub-icon-btn" onClick={onClose} aria-label="关闭"><X size={19} /></button>
        </div>
        <input ref={fileInputRef} hidden type="file" accept=".txt,.epub,.pdf" onChange={e => { const f = e.target.files?.[0]; if (f) void importBook(f); e.currentTarget.value = ""; }} />
      </header>

      <main className="reading-hub-body">
        {tab === "home" && (
          <>
            <section className="reading-hub-welcome">
              <div>
                <span className="reading-hub-welcome-label">WELCOME BACK</span>
                <strong>想读点什么？</strong>
                <p>书源、书架和阅读样式都可以在这里管理。</p>
              </div>
              <button type="button" onClick={() => setTab("sources")}><Search size={16} /> 查找书籍</button>
            </section>
            {filteredModules.map(mod => (
              <section className="reading-hub-module" key={mod.id}>
                <div className="reading-hub-module-title">
                  <div className="reading-hub-module-icon">{moduleIcon(mod.icon)}</div>
                  <div><h2>{mod.title}</h2><p>{mod.subtitle}</p></div>
                </div>
                {mod.id === "recent" || mod.id === "shelf" ? (
                  books.length ? <div className="reading-hub-book-row">{(mod.id === "recent" ? recentBooks : books.slice(0, 4)).map(book => <BookCard key={book.id} book={book} onOpen={() => setReadingBook(book)} />)}</div> : <EmptyHint text="还没有书，点右上角 + 导入一本" />
                ) : <EmptyHint text="这一版先预留模块位置，后续接入书源数据后会自动显示" />}
              </section>
            ))}
          </>
        )}

        {tab === "shelf" && (
          <section className="reading-hub-panel">
            <div className="reading-hub-panel-head"><div><h2>我的书架</h2><p>{books.length} 本书</p></div><button type="button" className="reading-hub-outline" onClick={() => fileInputRef.current?.click()}><Plus size={16} /> 导入</button></div>
            {books.length ? <div className="reading-hub-shelf-grid">{books.map(book => <BookCard key={book.id} book={book} onOpen={() => setReadingBook(book)} detailed />)}</div> : <EmptyHint text="书架还是空的，先导入 TXT / EPUB / PDF" />}
          </section>
        )}

        {tab === "sources" && (
          <section className="reading-hub-panel">
            <div className="reading-hub-source-card">
              <div className="reading-hub-source-brand"><span className="reading-hub-source-dot" /><div><strong>书山聚合</strong><small>登录后使用书源</small></div></div>
              <div className="reading-hub-source-note">账号密码只保存到本机。填写后要点击“保存生效”，否则不会使用输入的账号密码。</div>
              <label>邮箱 / 账号<input value={sourceAccount.email} onChange={e => setSourceAccount(v => ({ ...v, email: e.target.value, saved: false }))} autoComplete="username" /></label>
              <label>密码<input type="password" value={sourceAccount.password} onChange={e => setSourceAccount(v => ({ ...v, password: e.target.value, saved: false }))} autoComplete="current-password" /></label>
              <button type="button" className="reading-hub-primary" onClick={saveShushan}><LogIn size={16} /> {sourceAccount.saved ? "已保存生效" : "保存生效"}</button>
              <div className="reading-hub-source-divider" />
              <div className="reading-hub-search"><Search size={17} /><input value={sourceSearch} onChange={e => setSourceSearch(e.target.value)} placeholder="输入书名搜索" /><button type="button" disabled={!sourceAccount.saved || !sourceSearch.trim()}>搜索</button></div>
              {!sourceAccount.saved && <p className="reading-hub-warning">请先登录并保存账号密码，再使用书源搜索。</p>}
            </div>
          </section>
        )}

        {tab === "appearance" && (
          <section className="reading-hub-panel">
            <div className="reading-hub-panel-head"><div><h2>外观 CSS</h2><p>只作用于阅读 APP，不影响聊天 APP</p></div></div>
            <textarea className="reading-hub-css" value={customCss} onChange={e => { setCustomCss(e.target.value); try { window.localStorage.setItem("reading-custom-css-v1", e.target.value); } catch {} }} placeholder={":root {\n  --reading-warm-accent: #fae389;\n}"} />
            <div className="reading-hub-module-settings"><h3>首页模块</h3>{modules.map(mod => <label key={mod.id}><span>{mod.title}</span><input type="checkbox" checked={mod.enabled} onChange={() => toggleModule(mod.id)} /></label>)}</div>
          </section>
        )}
      </main>

      <nav className="reading-hub-nav" aria-label="阅读 APP 导航">
        <NavButton active={tab === "home"} label="首页" onClick={() => setTab("home")} icon={<BookOpen size={19} />} />
        <NavButton active={tab === "shelf"} label="书架" onClick={() => setTab("shelf")} icon={<Library size={19} />} />
        <NavButton active={tab === "sources"} label="书源" onClick={() => setTab("sources")} icon={<Search size={19} />} />
        <NavButton active={tab === "appearance"} label="外观" onClick={() => setTab("appearance")} icon={<Palette size={19} />} />
      </nav>
      <style>{customCss}</style>
    </div>
  );
}

function NavButton({ active, label, icon, onClick }: { active: boolean; label: string; icon: ReactNode; onClick: () => void }) {
  return <button type="button" className={`reading-hub-nav-item${active ? " is-active" : ""}`} onClick={onClick}>{icon}<span>{label}</span></button>;
}

function EmptyHint({ text }: { text: string }) {
  return <div className="reading-hub-empty">{text}</div>;
}

function BookCard({ book, onOpen, detailed = false }: { book: Book; onOpen: () => void; detailed?: boolean }) {
  const progress = Math.max(0, Math.min(1, book.progressFraction || 0));
  return <button type="button" className={`reading-hub-book-card${detailed ? " reading-hub-book-card--detailed" : ""}`} onClick={onOpen}>
    <div className="reading-hub-book-cover">{book.cover ? <img src={book.cover} alt="" /> : <BookOpen size={22} />}</div>
    <div className="reading-hub-book-meta"><strong>{book.title}</strong><span>{book.author || "本地书籍"}</span><div className="reading-hub-progress"><i style={{ width: `${progress * 100}%` }} /></div></div>
  </button>;
}
