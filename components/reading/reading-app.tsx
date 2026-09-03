"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { BookOpen, Library, Search, Palette, X } from "lucide-react";
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
import "./reading-hub.css";

type Tab = "home" | "shelf" | "sources" | "appearance";

type Props = {
  onClose: () => void;
};

type SourceAccount = {
  email: string;
  password: string;
  saved: boolean;
};

const SHUSHAN_ACCOUNT_KEY = "reading-shushan-account-v1";

const DEFAULT_SOURCE_ACCOUNT: SourceAccount = {
  email: "",
  password: "",
  saved: false,
};

function loadSourceAccount(): SourceAccount {
  if (typeof window === "undefined") return DEFAULT_SOURCE_ACCOUNT;
  try {
    const raw = window.localStorage.getItem(SHUSHAN_ACCOUNT_KEY);
    if (!raw) return DEFAULT_SOURCE_ACCOUNT;
    const value = JSON.parse(raw) as Partial<SourceAccount>;
    return {
      email: typeof value.email === "string" ? value.email : "",
      password: typeof value.password === "string" ? value.password : "",
      saved: value.saved === true,
    };
  } catch {
    return DEFAULT_SOURCE_ACCOUNT;
  }
}

function saveSourceAccount(value: SourceAccount) {
  try {
    window.localStorage.setItem(SHUSHAN_ACCOUNT_KEY, JSON.stringify(value));
  } catch {
    // Local persistence can fail in private/restricted WebViews.
  }
}

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
  const [sourceAccount, setSourceAccount] = useState<SourceAccount>(DEFAULT_SOURCE_ACCOUNT);

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
    setSourceAccount(loadSourceAccount());

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
                    <h2>📚 书山聚合</h2>
                    <p>先登录并保存账号，再接入搜索。</p>
                  </div>
                </div>

                <div className="reading-hub-source-note">
                  书山官方书源说明要求输入邮箱/账号和密码后点击 ✓
                  保存生效；账号密码这里只保存在本机。
                </div>

                <label className="reading-hub-field">
                  <span>邮箱 / 账号</span>
                  <input
                    value={sourceAccount.email}
                    onChange={(e) =>
                      setSourceAccount((prev) => ({
                        ...prev,
                        email: e.target.value,
                        saved: false,
                      }))
                    }
                    autoComplete="username"
                    inputMode="email"
                    placeholder="请输入书山账号"
                  />
                </label>

                <label className="reading-hub-field">
                  <span>密码</span>
                  <input
                    type="password"
                    value={sourceAccount.password}
                    onChange={(e) =>
                      setSourceAccount((prev) => ({
                        ...prev,
                        password: e.target.value,
                        saved: false,
                      }))
                    }
                    autoComplete="current-password"
                    placeholder="请输入密码"
                  />
                </label>

                <button
                  type="button"
                  className="reading-hub-primary"
                  onClick={() => {
                    const next = {
                      ...sourceAccount,
                      saved: Boolean(
                        sourceAccount.email.trim() &&
                          sourceAccount.password,
                      ),
                    };
                    setSourceAccount(next);
                    saveSourceAccount(next);
                  }}
                >
                  {sourceAccount.saved ? "✓ 已保存生效" : "✓ 保存生效"}
                </button>

                <div className="reading-hub-source-divider" />

                <div className="reading-hub-searchbox">
                  <Search size={17} />
                  <input
                    disabled={!sourceAccount.saved}
                    placeholder={
                      sourceAccount.saved
                        ? "输入书名（搜索接口下一步接入）"
                        : "请先保存账号密码"
                    }
                  />
                  <button
                    type="button"
                    disabled
                    title="书山搜索适配器尚未接入"
                  >
                    搜索
                  </button>
                </div>

                <p className="reading-hub-source-help">
                  当前这一层已经把登录状态和本地保存做好了；书山本身是
                  阅读/Legado 书源聚合包，不是一个简单的公开 REST
                  搜索接口，因此不要把“保存账号”和“搜索功能”混在一起。
                </p>
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
  icon: React.ReactNode;
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
