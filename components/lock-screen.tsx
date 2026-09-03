"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { Camera, Delete, Flashlight, LockKeyhole, ChevronUp, Settings2 } from "lucide-react";
import { getThemeAssetMap, saveThemeAssetFromBlob, deleteThemeAsset, describeAssetSaveError } from "@/lib/theme-storage";

const LOCK_SCREEN_SETTINGS_KEY = "ai_phone_lock_screen_settings_v1";

export type LockScreenSettings = {
  wallpaperAssetId: string | null;
  wallpaperLibrary: string[];
  password: string;
  passwordConfigured: boolean;
  passwordEnabled: boolean;
};

const DEFAULT_SETTINGS: LockScreenSettings = {
  wallpaperAssetId: null,
  wallpaperLibrary: [],
  password: "",
  passwordConfigured: false,
  passwordEnabled: true,
};

function normalizeSettings(raw: unknown): LockScreenSettings {
  const source = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const library = Array.isArray(source.wallpaperLibrary)
    ? Array.from(new Set(source.wallpaperLibrary.filter((v): v is string => typeof v === "string" && v.trim()).map(v => v.trim())))
    : [];
  const id = typeof source.wallpaperAssetId === "string" && source.wallpaperAssetId.trim() ? source.wallpaperAssetId.trim() : null;
  if (id && !library.includes(id)) library.unshift(id);
  const rawPassword = typeof source.password === "string" ? source.password.replace(/\D/g, "").slice(0, 8) : "";
  const configured = typeof source.passwordConfigured === "boolean" ? source.passwordConfigured : false;
  return {
    wallpaperAssetId: id,
    wallpaperLibrary: library,
    password: rawPassword.length >= 4 ? rawPassword : "",
    passwordConfigured: configured && rawPassword.length >= 4,
    passwordEnabled: typeof source.passwordEnabled === "boolean" ? source.passwordEnabled : true,
  };
}

export function readLockScreenSettings(): LockScreenSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(LOCK_SCREEN_SETTINGS_KEY);
    return raw ? normalizeSettings(JSON.parse(raw)) : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function writeLockScreenSettings(next: LockScreenSettings): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LOCK_SCREEN_SETTINGS_KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent("lock-screen-settings-updated"));
  } catch {
    // Best effort. The asset itself is already persisted in IndexedDB.
  }
}

function formatChineseDate(date: Date): string {
  const weekdays = ["日", "一", "二", "三", "四", "五", "六"];
  const formatter = new Intl.DateTimeFormat("zh-CN-u-ca-chinese", { year: "numeric", month: "long", day: "numeric" });
  const parts = formatter.formatToParts(date);
  const month = parts.find(p => p.type === "month")?.value ?? "";
  const day = parts.find(p => p.type === "day")?.value ?? "";
  const year = parts.find(p => p.type === "year")?.value ?? "";
  return `${date.getMonth() + 1}月${date.getDate()}日 周${weekdays[date.getDay()]} · ${year}年${month}${day}`;
}

function formatTime(date: Date): string {
  return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
}

function ownImageStyle(url: string | null): CSSProperties {
  if (!url) {
    return {
      background:
        "radial-gradient(circle at 50% 18%, rgba(255,255,255,.28), transparent 28%), linear-gradient(160deg, #1a1a1e 0%, #0a0a0c 48%, #030305 100%)",
    };
  }
  return { backgroundImage: `url("${url}")` };
}

function GlassButton({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      style={{
        width: 54,
        height: 54,
        borderRadius: 27,
        border: "0",
        background: "rgba(18,18,20,.52)",
        color: "white",
        display: "grid",
        placeItems: "center",
        backdropFilter: "blur(14px)",
        WebkitBackdropFilter: "blur(14px)",
        boxShadow: "0 8px 24px rgba(0,0,0,.24)",
      }}
    >
      {children}
    </button>
  );
}

export function LockScreen({
  ready = true,
  initialWallpaper = null,
  onUnlock,
}: {
  ready?: boolean;
  initialWallpaper?: string | null;
  onUnlock: () => void;
}) {
  const [settings, setSettings] = useState<LockScreenSettings>(() => readLockScreenSettings());
  const [wallpaper, setWallpaper] = useState<string | null>(initialWallpaper);
  const [mode, setMode] = useState<"lock" | "passcode">("lock");
  const [now, setNow] = useState(() => new Date());
  const [entered, setEntered] = useState("");
  const [setupConfirm, setSetupConfirm] = useState("");
  const [error, setError] = useState(false);
  const gestureRef = useRef<{ startY: number; active: boolean }>({ startY: 0, active: false });

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const sync = () => {
      const next = readLockScreenSettings();
      setSettings(next);
      if (!next.wallpaperAssetId) {
        setWallpaper(null);
        return;
      }
      void getThemeAssetMap([next.wallpaperAssetId]).then(map => {
        setWallpaper(map[next.wallpaperAssetId] ?? null);
      });
    };
    window.addEventListener("lock-screen-settings-updated", sync);
    sync();
    return () => window.removeEventListener("lock-screen-settings-updated", sync);
  }, []);

  useEffect(() => {
    if (!ready) return;
    if (!settings.passwordEnabled) setMode("lock");
  }, [ready, settings.passwordEnabled]);

  const displayTime = formatTime(now);
  const displayDate = useMemo(() => formatChineseDate(now), [now]);

  const unlock = () => {
    if (!settings.passwordEnabled || (settings.passwordConfigured && entered === settings.password)) {
      setEntered("");
      setError(false);
      onUnlock();
      return;
    }
    setError(true);
    setEntered("");
    window.setTimeout(() => setError(false), 520);
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    gestureRef.current = { startY: event.clientY, active: true };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!gestureRef.current.active) return;
    const delta = event.clientY - gestureRef.current.startY;
    gestureRef.current.active = false;
    if (delta < -56 && mode === "lock") {
      if (settings.passwordEnabled) setMode("passcode");
      else onUnlock();
    }
  };

  const finishPasswordSetup = (value: string) => {
    if (value.length < 4) return;
    if (!setupConfirm) {
      setSetupConfirm(value);
      setEntered("");
      setError(false);
      return;
    }
    if (value !== setupConfirm) {
      setError(true);
      setEntered("");
      setSetupConfirm("");
      window.setTimeout(() => setError(false), 520);
      return;
    }
    const next = { ...settings, password: value, passwordConfigured: true, passwordEnabled: true };
    writeLockScreenSettings(next);
    setSettings(next);
    setEntered("");
    setSetupConfirm("");
    setError(false);
    onUnlock();
  };

  const pressKey = (digit: string) => {
    if (entered.length >= 8) return;
    setError(false);
    const next = `${entered}${digit}`;
    setEntered(next);
    if (next.length >= 4 && next.length <= 8) {
      if (!settings.passwordConfigured) {
        // 首次设置密码：只有点击“继续”才进入确认，避免误触直接提交。
        return;
      }
      if (next.length === settings.password.length) {
        window.setTimeout(() => {
          if (next === settings.password) {
            onUnlock();
          } else {
            setError(true);
            setEntered("");
            window.setTimeout(() => setError(false), 520);
          }
        }, 80);
      }
    }
  };

  const submitSetup = () => {
    if (entered.length < 4 || entered.length > 8) {
      setError(true);
      window.setTimeout(() => setError(false), 520);
      return;
    }
    finishPasswordSetup(entered);
  };

  return (
    <main className="app-root splash-root">
      <section className="phone-shell-wrap splash-shell-wrap" aria-label="锁屏">
        <div className="phone-case">
          <div className="phone-frame">
            <div
              className="phone-shell"
              onPointerDown={onPointerDown}
              onPointerUp={onPointerUp}
              style={{ position: "relative", overflow: "hidden", touchAction: "none", userSelect: "none", background: "#000" }}
            >
              <div
                aria-hidden="true"
                style={{
                  position: "absolute",
                  inset: 0,
                  ...ownImageStyle(wallpaper),
                  backgroundPosition: "center",
                  backgroundSize: "cover",
                  backgroundRepeat: "no-repeat",
                  transform: "translateZ(0)",
                }}
              />
              <div aria-hidden="true" style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(0,0,0,.26), transparent 26%, rgba(0,0,0,.16) 54%, rgba(0,0,0,.48) 100%)" }} />

              {mode === "lock" ? (
                <div style={{ position: "relative", zIndex: 2, height: "100%", color: "white", fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'PingFang SC', sans-serif" }}>
                  <div style={{ position: "absolute", top: 12, left: 18, right: 18, display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12, fontWeight: 700, letterSpacing: ".02em", opacity: .96 }}>
                    <span>{displayTime}</span>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                      <span style={{ letterSpacing: "3px", fontSize: 9 }}>▮▮▮</span>
                      <span>⌁</span>
                      <span>69</span>
                    </span>
                  </div>

                  <div style={{ position: "absolute", top: "14%", left: 0, right: 0, textAlign: "center", textShadow: "0 3px 18px rgba(0,0,0,.28)" }}>
                    <div style={{ fontSize: 22, fontWeight: 650, letterSpacing: ".03em" }}>{displayDate}</div>
                    <div style={{ marginTop: 12, fontSize: "clamp(70px, 16vw, 110px)", lineHeight: .96, fontWeight: 300, letterSpacing: "-.055em" }}>{displayTime}</div>
                  </div>

                  <div style={{ position: "absolute", left: 0, right: 0, bottom: 108, textAlign: "center", color: "rgba(255,255,255,.94)", textShadow: "0 2px 10px rgba(0,0,0,.35)" }}>
                    <div style={{ fontSize: 13, fontWeight: 600, opacity: .88 }}>{settings.passwordEnabled ? "上滑解锁" : "上滑进入桌面"}</div>
                    <ChevronUp size={18} strokeWidth={2} style={{ margin: "5px auto 0" }} />
                  </div>

                  <div style={{ position: "absolute", left: 18, right: 18, bottom: 24, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <GlassButton label="手电筒"><Flashlight size={24} strokeWidth={2.2} /></GlassButton>
                    <GlassButton label="相机"><Camera size={24} strokeWidth={2.2} /></GlassButton>
                  </div>
                  <div style={{ position: "absolute", bottom: 7, left: "50%", transform: "translateX(-50%)", width: 34, height: 4, borderRadius: 4, background: "rgba(255,255,255,.9)" }} />
                </div>
              ) : (
                <div
                  style={{
                    position: "relative",
                    zIndex: 2,
                    minHeight: "100%",
                    color: "white",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    padding: "18% 18px 22px",
                    background: "rgba(0,0,0,.18)",
                    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'PingFang SC', sans-serif",
                  }}
                >
                  <LockKeyhole size={20} strokeWidth={2} style={{ opacity: .9 }} />
                  <div style={{ marginTop: 12, fontSize: 16, fontWeight: 600 }}>{settings.passwordConfigured ? "请输入密码" : (setupConfirm ? "再次输入密码" : "设置锁屏密码")}</div>
                  <div style={{ marginTop: 15, display: "flex", gap: 10, minHeight: 10, animation: error ? "lockscreen-shake .42s ease" : undefined }}>
                    {Array.from({ length: settings.password.length }).map((_, index) => (
                      <span key={index} style={{ width: 9, height: 9, borderRadius: 50, background: index < entered.length ? "white" : "rgba(255,255,255,.34)", boxShadow: "0 0 8px rgba(255,255,255,.2)" }} />
                    ))}
                  </div>
                  <div style={{ marginTop: 12, minHeight: 18, fontSize: 12, color: error ? "#ffb7b7" : "rgba(255,255,255,0)" }}>{error ? (settings.passwordConfigured ? "密码错误" : "两次密码不一致") : ""}</div>

                  <div style={{ marginTop: "auto", width: "min(330px, 100%)", display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
                    {["1","2","3","4","5","6","7","8","9","","0","⌫"].map((digit, index) => (
                      digit ? (
                        <button
                          key={`${digit}-${index}`}
                          type="button"
                          onClick={() => digit === "⌫" ? setEntered(v => v.slice(0, -1)) : pressKey(digit)}
                          style={{ height: 67, borderRadius: 34, border: "0", background: "rgba(255,255,255,.18)", color: "white", fontSize: digit === "⌫" ? 21 : 26, fontWeight: 400, backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)", boxShadow: "inset 0 1px 0 rgba(255,255,255,.12)" }}
                        >{digit === "⌫" ? <Delete size={21} strokeWidth={1.8} /> : digit}</button>
                      ) : <div key="empty" />
                    ))}
                  </div>

                  <div style={{ width: "100%", display: "flex", justifyContent: "space-between", marginTop: 15, fontSize: 12, opacity: .84 }}>
                    <button type="button" onClick={() => { setMode("lock"); setEntered(""); setSetupConfirm(""); setError(false); }} style={{ background: "transparent", border: 0, color: "white", padding: 8 }}>返回锁屏</button>
                    {!settings.passwordConfigured ? <button type="button" onClick={submitSetup} style={{ background: "transparent", border: 0, color: "white", padding: 8, fontWeight: 700 }}>继续</button> : <span>密码 {settings.password.length} 位</span>}
                  </div>
                  <div style={{ position: "absolute", bottom: 7, left: "50%", transform: "translateX(-50%)", width: 34, height: 4, borderRadius: 4, background: "rgba(255,255,255,.9)" }} />
                </div>
              )}

              {!ready && (
                <div style={{ position: "absolute", inset: 0, zIndex: 20, display: "grid", placeItems: "center", background: "rgba(0,0,0,.32)", color: "rgba(255,255,255,.86)", fontSize: 13 }}>加载中…</div>
              )}
            </div>
          </div>
        </div>
      </section>
      <style jsx global>{`@keyframes lockscreen-shake { 0%,100%{transform:translateX(0)} 25%{transform:translateX(-7px)} 50%{transform:translateX(7px)} 75%{transform:translateX(-4px)} }`}</style>
    </main>
  );
}

export function LockScreenSettingsPage({ onNotice }: { onNotice: (text: string) => void }) {
  const [settings, setSettings] = useState<LockScreenSettings>(() => readLockScreenSettings());
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const fileRef = useRef<HTMLInputElement>(null);
  const [draftPassword, setDraftPassword] = useState(settings.password);

  const sync = () => {
    const next = readLockScreenSettings();
    setSettings(next);
    setDraftPassword(next.password);
  };

  useEffect(() => {
    if (!settings.wallpaperLibrary.length) {
      setThumbs({});
      return;
    }
    let cancelled = false;
    void getThemeAssetMap(settings.wallpaperLibrary).then(map => { if (!cancelled) setThumbs(map); });
    return () => { cancelled = true; };
  }, [settings.wallpaperLibrary.join(",")]);

  const applySettings = (next: LockScreenSettings) => {
    const normalized = normalizeSettings(next);
    setSettings(normalized);
    writeLockScreenSettings(normalized);
  };

  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const id = await saveThemeAssetFromBlob(file, "wallpaper");
      const next = normalizeSettings({ ...settings, wallpaperAssetId: id, wallpaperLibrary: [...settings.wallpaperLibrary, id] });
      applySettings(next);
      const map = await getThemeAssetMap(next.wallpaperLibrary);
      setThumbs(map);
    } catch (error) {
      onNotice(describeAssetSaveError(error));
    }
  };

  const chooseWallpaper = (id: string) => {
    applySettings({ ...settings, wallpaperAssetId: id });
  };

  const removeWallpaper = async (id: string) => {
    try {
      await deleteThemeAsset(id);
    } catch {
      // Even when the asset is already gone, remove the reference.
    }
    const nextLibrary = settings.wallpaperLibrary.filter(item => item !== id);
    applySettings({ ...settings, wallpaperLibrary: nextLibrary, wallpaperAssetId: settings.wallpaperAssetId === id ? null : settings.wallpaperAssetId });
  };

  const savePassword = () => {
    const clean = draftPassword.replace(/\D/g, "").slice(0, 8);
    if (clean.length < 4) {
      onNotice("密码至少需要 4 位数字");
      return;
    }
    applySettings({ ...settings, password: clean, passwordConfigured: true, passwordEnabled: true });
    onNotice("锁屏密码已更新");
  };

  return (
    <div className="theme-section-page" style={{ padding: "16px 20px", gap: 16 }}>
      <div className="g-card" style={{ padding: 16 }}>
        <div style={{ fontWeight: 800, fontSize: 15 }}>锁屏设置</div>
        <div style={{ marginTop: 5, fontSize: 12, color: "var(--c-icon)" }}>锁屏壁纸与桌面壁纸完全独立。</div>
        <div className="menu-item" style={{ marginTop: 12, padding: "10px 0", background: "transparent" }}>
          <span className="card-icon"><LockKeyhole size={20} /></span>
          <span className="menu-label appearance-menu-item-label">密码锁</span>
          <label className="block w-10 h-[22px] cursor-pointer relative shrink-0 ml-auto">
            <input
              type="checkbox"
              checked={settings.passwordEnabled}
              onChange={(e) => applySettings({ ...settings, passwordEnabled: e.target.checked })}
              className="w-full h-full rounded-[11px] m-0 outline-none"
              style={{ appearance: "none", backgroundColor: settings.passwordEnabled ? "var(--c-success)" : "var(--c-page-body-bg)", transition: "0.2s" }}
            />
            <div className="absolute w-[18px] h-[18px] bg-white rounded-full top-[2px] pointer-events-none" style={{ left: settings.passwordEnabled ? 20 : 2, transition: "0.2s", boxShadow: "0 2px 4px rgba(0,0,0,0.15)" }} />
          </label>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <input value={draftPassword} onChange={e => setDraftPassword(e.target.value.replace(/\D/g, "").slice(0, 8))} inputMode="numeric" type="password" maxLength={8} style={{ flex: 1, height: 40, border: "1px solid var(--c-card-border)", borderRadius: 12, background: "var(--c-input)", padding: "0 12px", color: "var(--c-text-title)" }} />
          <button type="button" onClick={savePassword} style={{ border: 0, borderRadius: 12, padding: "0 14px", background: "var(--c-text-title)", color: "white", fontWeight: 700 }}>修改</button>
        </div>
        <div style={{ marginTop: 7, fontSize: 11, color: "var(--c-icon)" }}>首次使用请先设置 4～8 位数字密码；设置后可在这里修改。</div>
      </div>

      <div className="flex flex-col items-center justify-center pt-2 pb-4 border-b border-black/5">
        <button type="button" className="inline-flex items-center justify-center gap-1.5 rounded-[20px] bg-black px-6 py-2.5 text-sm font-bold text-white shadow-sm transition-all hover:bg-gray-800 hover:shadow-md active:scale-95 focus:outline-none" onClick={() => fileRef.current?.click()}>
          + 添加锁屏壁纸
        </button>
        <p className="mt-3 text-[calc(11px*var(--app-text-scale,1))] font-medium text-gray-400">这里只管理锁屏，不会修改桌面壁纸。</p>
      </div>
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleUpload} />

      {settings.wallpaperLibrary.length ? (
        <div className="wp-grid">
          {settings.wallpaperLibrary.map(id => {
            const active = settings.wallpaperAssetId === id;
            return (
              <div key={id} className={`wp-card${active ? " wp-card-active" : ""}`} onClick={() => chooseWallpaper(id)} role="button" tabIndex={0}>
                {thumbs[id] ? <img className="wp-card-img" src={thumbs[id]} alt="" /> : <div className="wp-card-img bg-[var(--c-page-body-bg)]" />}
                {active && <span className="wp-card-badge">使用中</span>}
                <button type="button" className="ui-card-delete" onClick={(event) => { event.stopPropagation(); void removeWallpaper(id); }} aria-label="删除">×</button>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="wp-empty">还没有锁屏壁纸，添加一张就可以独立设置。</div>
      )}

      <div className="g-card" style={{ padding: 14, fontSize: 12, color: "var(--c-icon)" }}>
        <Settings2 size={17} style={{ verticalAlign: "-4px", marginRight: 6 }} />锁屏每次重新进入虚拟手机时显示；上滑后进入密码界面，再进入桌面。
      </div>
    </div>
  );
}
