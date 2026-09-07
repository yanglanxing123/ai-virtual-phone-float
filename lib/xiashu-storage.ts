// lib/xiashu-storage.ts — 夏书 App 存储模块
import { kvGet, kvSet, registerKvMigration } from "./kv-db";
import type { XiashuChatSession, XiashuMessage, XiashuStatus, TavernRegexScript, XiashuCharSettings } from "./xiashu-types";

const CHAT_SESSIONS_KEY = "xiashu_chat_sessions_v1";
const REGEX_SCRIPTS_KEY = "xiashu_regex_scripts_v1";
const APP_SETTINGS_KEY = "xiashu_settings_v1";
const CHAR_SETTINGS_KEY = "xiashu_char_settings_v1";
const CSS_THEMES_KEY = "xiashu_css_themes_v1";

registerKvMigration(CHAT_SESSIONS_KEY);
registerKvMigration(REGEX_SCRIPTS_KEY);
registerKvMigration(APP_SETTINGS_KEY);
registerKvMigration(CHAR_SETTINGS_KEY);
registerKvMigration(CSS_THEMES_KEY);

// ── 聊天会话 ────────────────────────────────────────
export function loadChatSessions(): Record<string, XiashuChatSession> {
  if (typeof window === "undefined") return {};
  try {
    const raw = kvGet(CHAT_SESSIONS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function saveChatSessions(sessions: Record<string, XiashuChatSession>): void {
  if (typeof window === "undefined") return;
  kvSet(CHAT_SESSIONS_KEY, JSON.stringify(sessions));
}

export function getChatSession(characterId: string): XiashuChatSession | null {
  const sessions = loadChatSessions();
  return sessions[characterId] || null;
}

export function saveChatSession(session: XiashuChatSession): void {
  const sessions = loadChatSessions();
  sessions[session.characterId] = session;
  saveChatSessions(sessions);
}

export function deleteChatSession(characterId: string): void {
  const sessions = loadChatSessions();
  delete sessions[characterId];
  saveChatSessions(sessions);
}

export function createMessage(role: XiashuMessage["role"], content: string): XiashuMessage {
  return {
    id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    role,
    content,
    timestamp: new Date().toISOString(),
  };
}

// ── 正则脚本 ────────────────────────────────────────
export function loadRegexScripts(): TavernRegexScript[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = kvGet(REGEX_SCRIPTS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveRegexScripts(scripts: TavernRegexScript[]): void {
  if (typeof window === "undefined") return;
  kvSet(REGEX_SCRIPTS_KEY, JSON.stringify(scripts));
}

// ── App 设置 ────────────────────────────────────────
export type XiashuSettings = {
  theme: "light" | "dark";
  showStatusBar: boolean;
};

export function loadSettings(): XiashuSettings {
  if (typeof window === "undefined") return { theme: "light", showStatusBar: true };
  try {
    const raw = kvGet(APP_SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        theme: parsed.theme || "light",
        showStatusBar: parsed.showStatusBar !== false,
      };
    }
  } catch { /* ignore */ }
  return { theme: "light", showStatusBar: true };
}

export function saveSettings(settings: XiashuSettings): void {
  if (typeof window === "undefined") return;
  kvSet(APP_SETTINGS_KEY, JSON.stringify(settings));
}

// ── CSS 美化主题 ────────────────────────────────────
export type XiashuCssTheme = {
  id: string;
  name: string;
  css: string;           // CSS 源码
  enabled: boolean;
  importedAt: number;
};

export function loadCssThemes(): XiashuCssTheme[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = kvGet(CSS_THEMES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveCssThemes(themes: XiashuCssTheme[]): void {
  if (typeof window === "undefined") return;
  kvSet(CSS_THEMES_KEY, JSON.stringify(themes));
}

export function getActiveCss(): string {
  // 合并所有启用的 CSS 主题
  const themes = loadCssThemes().filter(t => t.enabled);
  if (themes.length === 0) return "";
  return themes.map(t => `/* ${t.name} */\n${t.css}`).join("\n\n");
}

// ── 按角色配置 ──────────────────────────────────────
export function loadCharSettings(characterId: string): XiashuCharSettings | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = kvGet(CHAR_SETTINGS_KEY);
    if (!raw) return null;
    const all: Record<string, XiashuCharSettings> = JSON.parse(raw);
    return all[characterId] || null;
  } catch {
    return null;
  }
}

export function saveCharSettings(settings: XiashuCharSettings): void {
  if (typeof window === "undefined") return;
  try {
    const raw = kvGet(CHAR_SETTINGS_KEY);
    const all: Record<string, XiashuCharSettings> = raw ? JSON.parse(raw) : {};
    all[settings.characterId] = settings;
    kvSet(CHAR_SETTINGS_KEY, JSON.stringify(all));
  } catch { /* ignore */ }
}

// ── 角色卡完整原始数据（每角色独立） ──────────────────
const CARD_DATA_KEY = "xiashu_character_cards_v2";
registerKvMigration(CARD_DATA_KEY);

export function loadCharacterCardData(characterId: string): XiashuCharSettings | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = kvGet(CARD_DATA_KEY);
    if (!raw) return null;
    const all: Record<string, XiashuCharSettings> = JSON.parse(raw);
    return all[characterId] || null;
  } catch { return null; }
}

export function saveCharacterCardData(data: XiashuCharSettings): void {
  if (typeof window === "undefined") return;
  try {
    const raw = kvGet(CARD_DATA_KEY);
    const all: Record<string, XiashuCharSettings> = raw ? JSON.parse(raw) : {};
    all[data.characterId] = data;
    kvSet(CARD_DATA_KEY, JSON.stringify(all));
  } catch { /* ignore */ }
}

export function loadAllCharacterCardData(): Record<string, XiashuCharSettings> {
  if (typeof window === "undefined") return {};
  try {
    const raw = kvGet(CARD_DATA_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}
