"use client";
// components/xiashu-app.tsx — 夏书 App (ins 风酒馆)
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft, Send, Plus, Settings as SettingsIcon,
  MessageCircle, BookOpen, Trash2, Upload, Sun, Moon,
  Loader2, AlertCircle, Heart, Smile, ShieldCheck, Users,
  Palette, FileCode,
} from "lucide-react";
import { PageShell } from "@/components/ui/page-shell";
import type { Character } from "@/lib/character-types";
import { loadCharacters, saveCharacters } from "@/lib/character-storage";
import {
  loadChatSessions, saveChatSession, deleteChatSession,
  createMessage, loadRegexScripts, saveRegexScripts,
  loadSettings, saveSettings, type XiashuSettings,
  loadCssThemes, saveCssThemes, getActiveCss, type XiashuCssTheme,
  loadCharSettings, saveCharSettings, saveCharacterCardData,
} from "@/lib/xiashu-storage";
import { loadWorldBooks, saveWorldBooks, loadBindingConfig, saveBindingConfig, resolveBinding, loadRegexes, saveRegexes, loadPresets } from "@/lib/settings-storage";
import type { WorldBookConfig, BindingConfig, CharacterBinding, RegexConfig } from "@/lib/settings-types";
import type { XiashuMessage, XiashuStatus, XiashuChatSession, TavernRegexScript, XiashuCharSettings } from "@/lib/xiashu-types";
import { XIASHU_APP_ID } from "@/lib/xiashu-types";
import { parseTavernCard, parseTavernCardFromJson, convertToCharacter, getCardSummary, convertWorldBook } from "@/lib/xiashu-import";
import { generateReply, generateGreeting, parseStatusFromResponse, formatMessageContent, ChatEngineError } from "@/lib/xiashu-engine";

type Page = "characters" | "chat" | "worldbooks" | "character-settings" | "settings";
type XiashuAppProps = { onClose: () => void; onNotice: (text: string) => void };

const INS_GRADIENT = "linear-gradient(45deg, #f09433 0%, #e6683c 25%, #dc2743 50%, #cc2366 75%, #bc1888 100%)";

export function XiashuApp({ onClose, onNotice }: XiashuAppProps) {
  const [page, setPage] = useState<Page>("characters");
  const [characters, setCharacters] = useState<Character[]>(() => loadCharacters());
  const [currentCharId, setCurrentCharId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<Record<string, XiashuChatSession>>(() => loadChatSessions());
  const [settings, setSettings] = useState<XiashuSettings>(() => loadSettings());
  const [regexScripts, setRegexScripts] = useState<TavernRegexScript[]>(() => loadRegexScripts());
  const [cssThemes, setCssThemes] = useState<XiashuCssTheme[]>(() => loadCssThemes());
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedWorldBookId, setSelectedWorldBookId] = useState<string | null>(null);

  // 刷新角色列表
  const refreshCharacters = useCallback(() => {
    setCharacters(loadCharacters());
  }, []);

  const currentChar = characters.find((c) => c.id === currentCharId) || null;
  const currentSession = currentCharId ? sessions[currentCharId] : null;

  useEffect(() => {
    const handler = (event: Event) => {
      const id = (event as CustomEvent<string>).detail;
      if (id) { setCurrentCharId(id); setPage("character-settings"); }
    };
    window.addEventListener("xiashu-open-character-settings", handler);
    return () => window.removeEventListener("xiashu-open-character-settings", handler);
  }, []);

  // ── 导入酒馆角色卡 ────────────────────────────────
  const handleImport = useCallback(async (file: File) => {
    try {
      setError(null);
      let result;

      if (file.name.endsWith(".png")) {
        const buffer = await file.arrayBuffer();
        result = parseTavernCard(buffer);
      } else if (file.name.endsWith(".json")) {
        const text = await file.text();
        result = parseTavernCardFromJson(text);
      } else {
        onNotice("请选择 PNG 或 JSON 格式的角色卡文件");
        return;
      }

      if (!result) {
        onNotice("角色卡解析失败，请检查文件格式");
        return;
      }

      const summary = getCardSummary(result);
      const newChar = convertToCharacter(result, characters);
      const updated = [...characters, newChar];
      setCharacters(updated);
      saveCharacters(updated);

      // 每张角色卡保存一份完整的酒馆运行数据；未知 extensions 原样保留。
      const charSettings: XiashuCharSettings = {
        characterId: newChar.id,
        scenario: result.character.scenario,
        firstMes: result.character.firstMes,
        alternateGreetings: result.character.alternateGreetings,
        systemPrompt: result.character.systemPrompt,
        postHistoryInstructions: result.character.postHistoryInstructions,
        cardExtensions: result.character.extensions,
        rawCardData: result.rawCardData,
        rawSpec: result.rawSpec,
        rawSpecVersion: result.rawSpecVersion,
        statusBar: result.statusBar || { enabled: true, showInChat: true },
      };
      saveCharSettings(charSettings);
      saveCharacterCardData(charSettings);

      // 角色卡自带正则：独立生成一个正则组并只绑定当前角色。
      if (result.regexScripts?.length) {
        const allRegexes = loadRegexes();
        const regexGroup: RegexConfig = {
          id: `regex_card_${newChar.id}`,
          name: `${newChar.name} · 角色卡正则`,
          description: "从酒馆角色卡 extensions 自动导入，仅绑定当前角色",
          createdAt: Date.now(), updatedAt: Date.now(),
          rules: result.regexScripts.map((r, i) => ({
            id: r.id || `card_rule_${i}`, scriptName: r.scriptName, findRegex: r.findRegex,
            replaceString: r.replaceString || "", trimStrings: r.trimStrings || [],
            disabled: r.disabled === true, markdownOnly: r.markdownOnly, promptOnly: r.promptOnly,
            runOnEdit: r.runOnEdit !== false, placement: r.placement || [2], tags: r.tags,
            substituteRegex: r.substituteRegex, minDepth: r.minDepth, maxDepth: r.maxDepth,
          })),
        };
        saveRegexes([...allRegexes.filter(r => r.id !== regexGroup.id), regexGroup]);
        charSettings.regexScriptIds = [regexGroup.id];
        saveCharSettings(charSettings);
        saveCharacterCardData(charSettings);
      }

      // 导入角色卡内嵌的世界书
      let wbNotice = "";
      if (result.worldBook && result.worldBook.entries) {
        try {
          const wbConfig = convertWorldBook(result.worldBook, `${summary.name}的世界书`);
          const allBooks = loadWorldBooks();
          allBooks.push(wbConfig);
          saveWorldBooks(allBooks);

          // 将世界书绑定到角色
          const bindings = loadBindingConfig();
          let charBinding = bindings.characterBindings.find(b => b.characterId === newChar.id);
          if (!charBinding) {
            charBinding = { characterId: newChar.id, defaults: {}, appOverrides: {} };
            bindings.characterBindings.push(charBinding);
          }
          // 绑定到夏书 app
          const xiashuOverride = charBinding.appOverrides[XIASHU_APP_ID] || {};
          xiashuOverride.worldBookIds = [...(xiashuOverride.worldBookIds || []), wbConfig.id];
          charBinding.appOverrides[XIASHU_APP_ID] = xiashuOverride;
          saveBindingConfig(bindings);
          const current = loadCharSettings(newChar.id) || charSettings;
          current.worldBookIds = [...(current.worldBookIds || []), wbConfig.id];
          saveCharSettings(current);
          saveCharacterCardData(current);

          wbNotice = `，世界书 ${wbConfig.entries.length} 条已导入并绑定`;
        } catch (e) {
          console.warn("[夏书] 世界书导入失败:", e);
          wbNotice = "（世界书导入失败）";
        }
      }

      onNotice(`角色卡导入成功：${summary.name}${wbNotice}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError("导入失败：" + msg);
      onNotice("导入失败：" + msg);
    }
  }, [characters, onNotice]);

  // ── 导入正则脚本 ───────────────────────────────────
  const handleImportRegex = useCallback(async (file: File) => {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const scripts: TavernRegexScript[] = Array.isArray(parsed) ? parsed : [parsed];
      const valid = scripts.filter((s) => s.findRegex);
      if (valid.length === 0) {
        onNotice("未找到有效的正则脚本");
        return;
      }
      // 规范化
      const normalized = valid.map((s) => ({
        scriptName: s.scriptName || s.id || "未命名脚本",
        findRegex: s.findRegex,
        replaceString: s.replaceString || "",
        trimStrings: s.trimStrings || [],
        disabled: s.disabled || false,
        markdownOnly: s.markdownOnly || false,
        promptOnly: s.promptOnly || false,
        runOnEdit: s.runOnEdit !== false,
        placement: s.placement || [2],
        tags: s.tags,
        id: s.id || `regex_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      }));
      const merged = [...regexScripts, ...normalized];
      setRegexScripts(merged);
      saveRegexScripts(merged);
      onNotice(`导入 ${normalized.length} 个正则脚本`);
    } catch (e) {
      onNotice("正则导入失败：" + (e instanceof Error ? e.message : String(e)));
    }
  }, [regexScripts, onNotice]);

  // ── 导入 CSS 美化（支持 JSON 和 CSS 两种格式）─────────
  const handleImportCss = useCallback(async (file: File) => {
    try {
      const raw = await file.text();
      if (!raw.trim()) {
        onNotice("文件为空");
        return;
      }

      let css = "";
      let name = file.name.replace(/\.(css|json)$/i, "") || "未命名美化";

      // 尝试 JSON 解析（酒馆导出的美化通常是 JSON）
      const isJson = file.name.endsWith(".json") || raw.trim().startsWith("{");
      if (isJson) {
        try {
          const obj = JSON.parse(raw);
          // 常见字段名：css, embed.css, style, stylesheet, theme_css
          css = obj.css || obj.CSS || "";
          if (!css && obj.embed) css = obj.embed.css || obj.embed.CSS || "";
          if (!css) css = obj.style || obj.stylesheet || obj.theme_css || "";
          if (obj.name) name = obj.name;
          if (!css) {
            // 可能整个 JSON 就是 { "body": "..." } 这种结构，把所有 string 值拼起来当 CSS
            const strValues = Object.values(obj).filter(v => typeof v === "string" && v.length > 20);
            if (strValues.length > 0) css = strValues.join("\n\n");
          }
        } catch {
          // JSON 解析失败，当作纯 CSS 处理
          css = raw;
        }
      } else {
        css = raw;
      }

      if (!css.trim()) {
        onNotice("未从文件中提取到 CSS 内容");
        return;
      }

      const theme: XiashuCssTheme = {
        id: `css_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        name,
        css,
        enabled: true,
        importedAt: Date.now(),
      };
      const merged = [...cssThemes, theme];
      setCssThemes(merged);
      saveCssThemes(merged);
      onNotice(`CSS 美化导入成功：${name}`);
    } catch (e) {
      onNotice("CSS 导入失败：" + (e instanceof Error ? e.message : String(e)));
    }
  }, [cssThemes, onNotice]);

  // ── 切换 CSS 美化开关 ───────────────────────────────
  const toggleCssTheme = useCallback((id: string) => {
    const updated = cssThemes.map(t =>
      t.id === id ? { ...t, enabled: !t.enabled } : t
    );
    setCssThemes(updated);
    saveCssThemes(updated);
  }, [cssThemes]);

  // ── 删除 CSS 美化 ───────────────────────────────────
  const deleteCssTheme = useCallback((id: string) => {
    const updated = cssThemes.filter(t => t.id !== id);
    setCssThemes(updated);
    saveCssThemes(updated);
    onNotice("已删除 CSS 美化");
  }, [cssThemes, onNotice]);

  // ── 获取当前生效的 CSS ─────────────────────────────
  const activeCss = cssThemes.filter(t => t.enabled).map(t => `/* ${t.name} */\n${t.css}`).join("\n\n");

  // ── 发送消息 ───────────────────────────────────────
  const handleSend = useCallback(async (text: string) => {
    if (!currentCharId || !text.trim() || isGenerating) return;

    const char = characters.find((c) => c.id === currentCharId);
    if (!char) return;

    setIsGenerating(true);
    setError(null);

    // 获取或创建会话
    let session = sessions[currentCharId];
    if (!session) {
      session = {
        characterId: currentCharId,
        characterName: char.name,
        messages: [],
        status: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }

    // 添加用户消息
    const userMsg = createMessage("user", text.trim());
    session.messages.push(userMsg);
    const updatedSessions = { ...sessions, [currentCharId]: { ...session, updatedAt: new Date().toISOString() } };
    setSessions(updatedSessions);
    saveChatSession(updatedSessions[currentCharId]);

    try {
      const { text: replyText, status } = await generateReply(
        currentCharId,
        session.messages,
        text.trim(),
        "用户",
      );

      const aiMsg = createMessage("assistant", replyText);
      if (status) {
        session.status = status;
      }
      session.messages.push(aiMsg);

      const finalSessions = { ...sessions, [currentCharId]: { ...session, updatedAt: new Date().toISOString() } };
      setSessions(finalSessions);
      saveChatSession(finalSessions[currentCharId]);
    } catch (e) {
      const msg = e instanceof ChatEngineError ? e.message : (e instanceof Error ? e.message : String(e));
      setError(msg);
      const errMsg = createMessage("system", `错误：${msg}`);
      session.messages.push(errMsg);
      setSessions({ ...sessions, [currentCharId]: { ...session } });
      saveChatSession(session);
    } finally {
      setIsGenerating(false);
    }
  }, [currentCharId, characters, sessions, isGenerating]);

  // ── 生成开场白 ──────────────────────────────────────
  const handleStartChat = useCallback(async (charId: string) => {
    setCurrentCharId(charId);
    setPage("chat");

    // 如果没有历史消息，生成开场白
    if (!sessions[charId] || sessions[charId].messages.length === 0) {
      setIsGenerating(true);
      setError(null);
      try {
        const greeting = await generateGreeting(charId, "用户");
        const session: XiashuChatSession = {
          characterId: charId,
          characterName: characters.find((c) => c.id === charId)?.name || "",
          messages: [createMessage("assistant", greeting)],
          status: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        const updated = { ...sessions, [charId]: session };
        setSessions(updated);
        saveChatSession(session);
      } catch (e) {
        const msg = e instanceof ChatEngineError ? e.message : (e instanceof Error ? e.message : String(e));
        setError(msg);
      } finally {
        setIsGenerating(false);
      }
    }
  }, [sessions, characters]);

  // ── 清空对话 ───────────────────────────────────────
  const handleClearChat = useCallback(() => {
    if (!currentCharId) return;
    deleteChatSession(currentCharId);
    const updated = { ...sessions };
    delete updated[currentCharId];
    setSessions(updated);
    onNotice("已清空对话");
  }, [currentCharId, sessions, onNotice]);

  // ── 切换主题 ───────────────────────────────────────
  const toggleTheme = useCallback(() => {
    const next: XiashuSettings = { ...settings, theme: settings.theme === "light" ? "dark" : "light" };
    setSettings(next);
    saveSettings(next);
  }, [settings]);

  // ── 切换正则开关 ───────────────────────────────────
  const toggleRegex = useCallback((idx: number) => {
    const updated = [...regexScripts];
    if (updated[idx]) {
      updated[idx] = { ...updated[idx], disabled: !updated[idx].disabled };
      setRegexScripts(updated);
      saveRegexScripts(updated);
    }
  }, [regexScripts]);

  // ── 拖拽导入 ────────────────────────────────────────
  const fileInputRef = useRef<HTMLInputElement>(null);
  const regexInputRef = useRef<HTMLInputElement>(null);
  const cssInputRef = useRef<HTMLInputElement>(null);

  return (
    <>
      <PageShell onClose={onClose}>
        <div className={`xiashu-root ${settings.theme === "dark" ? "dark" : ""}`} style={{
          display: "flex", flexDirection: "column", height: "100%",
          background: settings.theme === "dark" ? "#0a0a0f" : "#fafafa",
          color: settings.theme === "dark" ? "#e8e8e8" : "#1a1a1a",
          fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', sans-serif",
        }}>
          {/* ── 角色页 ── */}
          {page === "characters" && (
            <CharactersPage
              characters={characters}
              sessions={sessions}
              onImport={handleImport}
              onStartChat={handleStartChat}
              onClose={onClose}
              fileInputRef={fileInputRef}
              onFileSelect={(f) => handleImport(f)}
            />
          )}

          {/* ── 聊天页 ── */}
          {page === "chat" && currentChar && (
            <ChatPage
              character={currentChar}
              session={currentSession}
              isGenerating={isGenerating}
              error={error}
              settings={settings}
              regexScripts={regexScripts}
              onSend={handleSend}
              onBack={() => { setPage("characters"); setCurrentCharId(null); }}
              onClear={handleClearChat}
            />
          )}

          {/* ── 设置页 ── */}
          {page === "worldbooks" && (
            <WorldBooksPage
              books={loadWorldBooks()}
              selectedId={selectedWorldBookId}
              onSelect={setSelectedWorldBookId}
              onSave={(books) => { saveWorldBooks(books); setSelectedWorldBookId(null); onNotice("世界书已保存"); }}
              onBack={() => setPage("characters")}
              theme={settings.theme}
            />
          )}

          {page === "character-settings" && currentChar && (
            <CharacterSettingsPage
              character={currentChar}
              settings={loadCharSettings(currentChar.id)}
              onSave={(next) => { saveCharSettings(next); saveCharacterCardData(next); onNotice("角色独立配置已保存"); }}
              onBack={() => setPage("characters")}
              theme={settings.theme}
            />
          )}

          {page === "settings" && (
            <SettingsPage
              settings={settings}
              regexScripts={regexScripts}
              cssThemes={cssThemes}
              activeCss={activeCss}
              onToggleTheme={toggleTheme}
              onToggleRegex={toggleRegex}
              onImportRegex={handleImportRegex}
              regexInputRef={regexInputRef}
              onImportCss={handleImportCss}
              onToggleCss={toggleCssTheme}
              onDeleteCss={deleteCssTheme}
              cssInputRef={cssInputRef}
              onBack={() => setPage("characters")}
            />
          )}

          {/* ── 底部 Tab 栏 ── */}
          <div style={{
            display: "flex", justifyContent: "space-around", alignItems: "center",
            padding: "8px 0 12px",
            background: settings.theme === "dark" ? "rgba(20,20,28,0.85)" : "rgba(255,255,255,0.85)",
            backdropFilter: "blur(20px)",
            borderTop: `1px solid ${settings.theme === "dark" ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)"}`,
          }}>
            <TabButton icon={<MessageCircle size={22} />} label="角色" active={page === "characters"} onClick={() => setPage("characters")} settings={settings} />
            <TabButton icon={<BookOpen size={22} />} label="世界书" active={page === "worldbooks"} onClick={() => setPage("worldbooks")} settings={settings} />
            <TabButton icon={<Send size={22} />} label="对话" active={page === "chat"} onClick={() => currentCharId ? setPage("chat") : setPage("characters")} settings={settings} />
            <TabButton icon={<SettingsIcon size={22} />} label="设置" active={page === "settings"} onClick={() => setPage("settings")} settings={settings} />
          </div>
        </div>
      </PageShell>

      {/* ins 风样式 */}
      <style>{`
        .xiashu-action { color: #8e8e93; font-style: italic; }
        .xiashu-grad-text {
          background: ${INS_GRADIENT};
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }
        .xiashu-grad-ring {
          background: ${INS_GRADIENT};
          padding: 2px;
          border-radius: 50%;
        }
        .xiashu-msg-bubble-char {
          background: ${INS_GRADIENT};
          color: white;
          border-radius: 18px 18px 4px 18px;
        }
        .xiashu-msg-bubble-user {
          background: rgba(0,0,0,0.05);
          border-radius: 18px 18px 18px 4px;
        }
        .dark .xiashu-msg-bubble-user {
          background: rgba(255,255,255,0.08);
        }
        @keyframes xiashu-pulse {
          0%, 100% { opacity: 0.4; }
          50% { opacity: 1; }
        }
        .xiashu-typing-dot {
          animation: xiashu-pulse 1.4s infinite;
        }
        .xiashu-typing-dot:nth-child(2) { animation-delay: 0.2s; }
        .xiashu-typing-dot:nth-child(3) { animation-delay: 0.4s; }
      `}</style>

      {/* 用户导入的 CSS 美化（酒馆导出） */}
      {activeCss && <style>{activeCss}</style>}
    </>
  );
}

// ── Tab 按钮 ────────────────────────────────────────
function TabButton({ icon, label, active, onClick, settings }: {
  icon: React.ReactNode; label: string; active: boolean;
  onClick: () => void; settings: XiashuSettings;
}) {
  return (
    <button onClick={onClick} style={{
      display: "flex", flexDirection: "column", alignItems: "center", gap: "2px",
      border: "none", background: "none", cursor: "pointer",
      color: active ? "#dc2743" : (settings.theme === "dark" ? "#666" : "#999"),
      fontSize: "10px", fontWeight: 500, transition: "color 0.2s",
    }}>
      {icon}
      <span>{label}</span>
    </button>
  );
}

// ── 角色页 ──────────────────────────────────────────
function CharactersPage({ characters, sessions, onImport, onStartChat, onClose, fileInputRef, onFileSelect }: {
  characters: Character[];
  sessions: Record<string, XiashuChatSession>;
  onImport: (file: File) => void;
  onStartChat: (charId: string) => void;
  onClose: () => void;
  fileInputRef: React.RefObject<HTMLInputElement>;
  onFileSelect: (file: File) => void;
}) {
  const [dragOver, setDragOver] = useState(false);

  return (
    <div style={{ flex: 1, overflow: "auto", padding: "16px" }}>
      {/* 标题 */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "20px" }}>
        <h1 className="xiashu-grad-text" style={{ fontSize: "24px", fontWeight: 700, margin: 0 }}>夏书</h1>
        <button onClick={onClose} style={{ border: "none", background: "none", cursor: "pointer", color: "#999", fontSize: "13px" }}>关闭</button>
      </div>

      <p style={{ color: "#8e8e93", fontSize: "13px", margin: "0 0 16px" }}>
        导入酒馆角色卡，开始你的 AI 角色扮演旅程
      </p>

      {/* 导入区域 */}
      <input ref={fileInputRef} type="file" accept=".png,.json" style={{ display: "none" }}
        onChange={(e) => { if (e.target.files?.[0]) onFileSelect(e.target.files[0]); e.target.value = ""; }}
      />
      <div
        onClick={() => fileInputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault(); setDragOver(false);
          if (e.dataTransfer.files[0]) onFileSelect(e.dataTransfer.files[0]);
        }}
        style={{
          border: `2px dashed ${dragOver ? "#dc2743" : "#ddd"}`,
          borderRadius: "16px",
          padding: "24px 16px",
          textAlign: "center",
          cursor: "pointer",
          transition: "all 0.2s",
          background: dragOver ? "rgba(220,39,67,0.05)" : "transparent",
        }}
      >
        <Upload size={28} style={{ color: "#dc2743", marginBottom: "8px" }} />
        <div style={{ fontSize: "14px", fontWeight: 600 }}>导入角色卡</div>
        <div style={{ fontSize: "12px", color: "#8e8e93", marginTop: "4px" }}>
          支持 SillyTavern PNG/JSON 格式
        </div>
      </div>

      {/* 角色列表 */}
      {characters.length > 0 && (
        <div style={{ marginTop: "20px" }}>
          <div style={{ fontSize: "13px", fontWeight: 600, marginBottom: "12px", color: "#8e8e93" }}>
            角色列表
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px" }}>
            {characters.map((char) => {
              const session = sessions[char.id];
              const hasChat = session && session.messages.length > 0;
              return (
                <div key={char.id} style={{ position: "relative", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: "6px" }}>
                  <button onClick={(e) => { e.stopPropagation(); window.dispatchEvent(new CustomEvent("xiashu-open-character-settings", { detail: char.id })); }} style={{ position: "absolute", right: "-2px", top: "-4px", zIndex: 2, border: "none", background: "rgba(0,0,0,.45)", color: "white", width: 20, height: 20, borderRadius: 10, cursor: "pointer", fontSize: 11 }}>⚙</button>
                  <div className="xiashu-grad-ring" style={{ width: "56px", height: "56px" }}>
                    <div style={{
                      width: "100%", height: "100%", borderRadius: "50%", overflow: "hidden",
                      border: "2px solid white", background: "#ccc",
                    }}>
                      {char.avatar ? (
                        <img src={char.avatar} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      ) : (
                        <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "white", fontWeight: 700, background: INS_GRADIENT }}>
                          {char.name.charAt(0)}
                        </div>
                      )}
                    </div>
                  </div>
                  <span style={{ fontSize: "11px", textAlign: "center", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", width: "100%" }}>
                    {char.name}
                  </span>
                  {hasChat && (
                    <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#34c759", position: "absolute", marginTop: "-52px", marginLeft: "44px" }} />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── 聊天页 ──────────────────────────────────────────
function ChatPage({ character, session, isGenerating, error, settings, regexScripts, onSend, onBack, onClear }: {
  character: Character;
  session: XiashuChatSession | null;
  isGenerating: boolean;
  error: string | null;
  settings: XiashuSettings;
  regexScripts: TavernRegexScript[];
  onSend: (text: string) => void;
  onBack: () => void;
  onClear: () => void;
}) {
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const messages = session?.messages || [];
  const status = session?.status;

  // 自动滚动
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isGenerating]);

  const handleSend = () => {
    if (!input.trim() || isGenerating) return;
    onSend(input);
    setInput("");
  };

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* 聊天头部 */}
      <div style={{
        display: "flex", alignItems: "center", gap: "8px", padding: "8px 12px",
        borderBottom: `1px solid ${settings.theme === "dark" ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)"}`,
      }}>
        <button onClick={onBack} style={{ border: "none", background: "none", cursor: "pointer", color: "#dc2743", padding: "4px" }}>
          <ArrowLeft size={20} />
        </button>
        <div className="xiashu-grad-ring" style={{ width: "32px", height: "32px" }}>
          <div style={{
            width: "100%", height: "100%", borderRadius: "50%", overflow: "hidden",
            border: "2px solid white", background: "#ccc",
          }}>
            {character.avatar ? (
              <img src={character.avatar} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            ) : (
              <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "white", fontWeight: 700, fontSize: "14px", background: INS_GRADIENT }}>
                {character.name.charAt(0)}
              </div>
            )}
          </div>
        </div>
        <span style={{ flex: 1, fontWeight: 600, fontSize: "14px" }}>{character.name}</span>
        <button onClick={onClear} style={{ border: "none", background: "none", cursor: "pointer", color: "#8e8e93", padding: "4px" }} title="清空对话">
          <Trash2 size={16} />
        </button>
      </div>

      {/* 状态栏 */}
      {settings.showStatusBar && status && (
        <StatusBar status={status} settings={settings} />
      )}

      {/* 错误提示 */}
      {error && (
        <div style={{
          margin: "8px 12px", padding: "8px 12px", borderRadius: "10px",
          background: "rgba(255,59,48,0.1)", color: "#ff3b30", fontSize: "12px",
          display: "flex", alignItems: "center", gap: "6px",
        }}>
          <AlertCircle size={14} />
          {error}
        </div>
      )}

      {/* 消息列表 */}
      <div ref={scrollRef} style={{ flex: 1, overflow: "auto", padding: "12px" }}>
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} settings={settings} regexScripts={regexScripts} characterName={character.name} />
        ))}
        {/* 打字指示器 */}
        {isGenerating && (
          <div style={{ display: "flex", justifyContent: "flex-start", marginBottom: "8px" }}>
            <div className="xiashu-msg-bubble-char" style={{ padding: "10px 16px", display: "flex", gap: "4px" }}>
              <span className="xiashu-typing-dot" style={{ width: "6px", height: "6px", borderRadius: "50%", background: "white" }} />
              <span className="xiashu-typing-dot" style={{ width: "6px", height: "6px", borderRadius: "50%", background: "white" }} />
              <span className="xiashu-typing-dot" style={{ width: "6px", height: "6px", borderRadius: "50%", background: "white" }} />
            </div>
          </div>
        )}
      </div>

      {/* 输入栏 */}
      <div style={{
        display: "flex", gap: "8px", padding: "8px 12px 4px",
        borderTop: `1px solid ${settings.theme === "dark" ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)"}`,
      }}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
          placeholder="输入消息..."
          disabled={isGenerating}
          style={{
            flex: 1, border: "none", outline: "none",
            background: settings.theme === "dark" ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)",
            borderRadius: "20px", padding: "8px 16px", fontSize: "14px",
            color: settings.theme === "dark" ? "#e8e8e8" : "#1a1a1a",
          }}
        />
        <button
          onClick={handleSend}
          disabled={isGenerating || !input.trim()}
          style={{
            border: "none", borderRadius: "50%", width: "36px", height: "36px",
            display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
            background: input.trim() ? INS_GRADIENT : "rgba(0,0,0,0.1)",
            color: "white", transition: "all 0.2s",
          }}
        >
          {isGenerating ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
        </button>
      </div>
    </div>
  );
}

// ── 消息气泡 ────────────────────────────────────────
function MessageBubble({ message, settings, regexScripts, characterName }: {
  message: XiashuMessage;
  settings: XiashuSettings;
  regexScripts: TavernRegexScript[];
  characterName: string;
}) {
  if (message.role === "system") {
    return (
      <div style={{
        textAlign: "center", margin: "8px 0", fontSize: "12px", color: "#8e8e93",
        padding: "4px 12px", background: settings.theme === "dark" ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.03)",
        borderRadius: "8px",
      }}>
        {message.content}
      </div>
    );
  }

  const isUser = message.role === "user";
  const html = formatMessageContent(message.content, regexScripts);

  return (
    <div style={{
      display: "flex", justifyContent: isUser ? "flex-end" : "flex-start", marginBottom: "8px",
    }}>
      <div
        className={isUser ? "xiashu-msg-bubble-user" : "xiashu-msg-bubble-char"}
        style={{ maxWidth: "75%", padding: "8px 14px", fontSize: "14px", lineHeight: 1.5, wordBreak: "break-word" }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}

// ── 状态栏 ──────────────────────────────────────────
function StatusBar({ status, settings }: { status: XiashuStatus; settings: XiashuSettings }) {
  return (
    <div style={{
      display: "flex", gap: "12px", padding: "6px 12px",
      background: settings.theme === "dark" ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.03)",
      borderBottom: `1px solid ${settings.theme === "dark" ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)"}`,
      fontSize: "11px",
    }}>
      <StatusItem icon={<Heart size={12} />} label="好感" value={`${status.affection}`} progress={status.affection} color="#ff375f" />
      <StatusItem icon={<Smile size={12} />} label="心情" value={status.mood} color="#ff9f0a" />
      <StatusItem icon={<ShieldCheck size={12} />} label="信任" value={status.trust} color="#34c759" />
      <StatusItem icon={<Users size={12} />} label="关系" value={status.stage} color="#5856d6" />
      {status.dynamic && Object.entries(status.dynamic).filter(([k]) => !["好感度","心情","信任","关系","关系阶段","favor","affection","mood","trust","stage"].includes(k)).slice(0, 8).map(([key, value]) => (
        <StatusItem key={key} icon={<BookOpen size={12} />} label={key} value={String(value ?? "")} color="#8e8e93" />
      ))}
    </div>
  );
}

function StatusItem({ icon, label, value, progress, color }: {
  icon: React.ReactNode; label: string; value: string;
  progress?: number; color: string;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "3px", color: "#8e8e93" }}>
      <span style={{ color }}>{icon}</span>
      <span>{label}:</span>
      <span style={{ fontWeight: 600, color }}>{value}</span>
      {progress !== undefined && (
        <div style={{ width: "30px", height: "3px", borderRadius: "2px", background: "rgba(0,0,0,0.1)", marginLeft: "2px", overflow: "hidden" }}>
          <div style={{ width: `${progress}%`, height: "100%", background: color, borderRadius: "2px" }} />
        </div>
      )}
    </div>
  );
}


// ── 世界书页：独立于角色卡，可创建/编辑/删除/导入 ─────────────
function WorldBooksPage({ books, selectedId, onSelect, onSave, onBack, theme }: {
  books: WorldBookConfig[]; selectedId: string | null; onSelect: (id: string | null) => void;
  onSave: (books: WorldBookConfig[]) => void; onBack: () => void; theme: "light" | "dark";
}) {
  const selected = books.find(b => b.id === selectedId) || null;
  const [draft, setDraft] = useState<WorldBookConfig | null>(selected);
  const [newName, setNewName] = useState("");
  useEffect(() => setDraft(selected), [selectedId]);
  const makeBook = () => {
    const now = Date.now();
    const book: WorldBookConfig = { id: `wb_${now}`, name: newName.trim() || "新世界书", description: "", createdAt: now, updatedAt: now, entries: [] };
    onSave([...books, book]); onSelect(book.id); setNewName("");
  };
  const saveDraft = () => { if (!draft) return; onSave(books.map(b => b.id === draft.id ? { ...draft, updatedAt: Date.now() } : b)); };
  return <div style={{ flex: 1, overflow: "auto", padding: 16 }}>
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}><button onClick={onBack} style={{ border: 0, background: "none", color: "#dc2743" }}><ArrowLeft size={20}/></button><h2 style={{ margin: 0, fontSize: 18 }}>世界书</h2></div>
    <div style={{ display: "flex", gap: 8, marginBottom: 12 }}><input value={newName} onChange={e => setNewName(e.target.value)} placeholder="新世界书名称" style={{ flex: 1, padding: 9, borderRadius: 10, border: "1px solid #ddd" }}/><button onClick={makeBook} style={{ border: 0, borderRadius: 10, padding: "0 12px", background: "#dc2743", color: "white" }}>新建</button></div>
    <input id="xiashu-wb-import" type="file" accept=".json" style={{ display:"none" }} onChange={async e => { const file=e.target.files?.[0]; if(!file) return; try { const obj=JSON.parse(await file.text()); const wb=(obj.data?.entries ? obj.data : obj); const imported=convertWorldBook(wb, file.name.replace(/\.json$/i, "")); onSave([...books, imported]); onSelect(imported.id); } catch { window.alert("世界书 JSON 导入失败"); } e.target.value=""; }} />
    <button onClick={() => document.getElementById("xiashu-wb-import")?.click()} style={{ width:"100%", padding:9, marginBottom:12, borderRadius:10, border:"1px dashed #bbb", background:"none" }}>导入酒馆世界书 JSON</button>
    {!draft ? <div style={{ display: "grid", gap: 8 }}>{books.map(b => <button key={b.id} onClick={() => onSelect(b.id)} style={{ textAlign: "left", border: 0, borderRadius: 12, padding: 12, background: "rgba(0,0,0,.04)" }}><b>{b.name}</b><div style={{ color: "#8e8e93", fontSize: 11, marginTop: 3 }}>{b.entries.length} 个条目</div></button>)}</div> : <>
      <input value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} style={{ width: "100%", boxSizing: "border-box", padding: 10, borderRadius: 10, border: "1px solid #ddd", marginBottom: 8 }}/>
      <textarea value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })} placeholder="描述" style={{ width: "100%", boxSizing: "border-box", minHeight: 60, borderRadius: 10, border: "1px solid #ddd", padding: 10, marginBottom: 10 }}/>
      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}><button onClick={() => { const now=Date.now(); setDraft({ ...draft, entries: [...draft.entries, { uid:`wbe_${now}`, key:"", content:"", comment:"新条目", use_regex:false, disable:false, constant:false, position:"before_char", insertion_order:50 }] }); }} style={{ flex: 1, padding: 9, borderRadius: 10, border: "1px solid #ddd", background: "none" }}>+ 条目</button><button onClick={saveDraft} style={{ flex: 1, padding: 9, borderRadius: 10, border: 0, background: "#dc2743", color: "white" }}>保存</button><button onClick={() => { onSave(books.filter(b => b.id !== draft.id)); onSelect(null); }} style={{ padding: 9, borderRadius: 10, border: 0, color: "#ff3b30", background: "rgba(255,59,48,.08)" }}>删除</button></div>
      {draft.entries.map((entry, i) => <div key={entry.uid} style={{ padding: 10, marginBottom: 8, borderRadius: 12, background: "rgba(0,0,0,.035)" }}>
        <input value={entry.comment} onChange={e => { const entries=[...draft.entries]; entries[i]={...entries[i], comment:e.target.value}; setDraft({...draft,entries}); }} placeholder="条目名称" style={{ width:"100%", boxSizing:"border-box", padding:8, marginBottom:6, borderRadius:8, border:"1px solid #ddd" }}/>
        <input value={entry.key} onChange={e => { const entries=[...draft.entries]; entries[i]={...entries[i], key:e.target.value}; setDraft({...draft,entries}); }} placeholder="关键词，逗号分隔" style={{ width:"100%", boxSizing:"border-box", padding:8, marginBottom:6, borderRadius:8, border:"1px solid #ddd" }}/>
        <textarea value={entry.content} onChange={e => { const entries=[...draft.entries]; entries[i]={...entries[i], content:e.target.value}; setDraft({...draft,entries}); }} placeholder="内容" style={{ width:"100%", minHeight:80, boxSizing:"border-box", padding:8, borderRadius:8, border:"1px solid #ddd" }}/>
        <div style={{ display:"flex", gap:12, marginTop:6, fontSize:11 }}><label><input type="checkbox" checked={entry.constant} onChange={e => { const entries=[...draft.entries]; entries[i]={...entries[i], constant:e.target.checked}; setDraft({...draft,entries}); }}/> 常驻</label><label><input type="checkbox" checked={entry.use_regex} onChange={e => { const entries=[...draft.entries]; entries[i]={...entries[i], use_regex:e.target.checked}; setDraft({...draft,entries}); }}/> 正则关键词</label><label><input type="checkbox" checked={!entry.disable} onChange={e => { const entries=[...draft.entries]; entries[i]={...entries[i], disable:!e.target.checked}; setDraft({...draft,entries}); }}/> 启用</label></div>
      </div>)}
    </>}
  </div>;
}

// ── 角色独立配置：每张角色卡拥有自己的 Preset / 世界书 / 正则 / 状态栏 / 采样参数 ──
function CharacterSettingsPage({ character, settings, onSave, onBack, theme }: {
  character: Character; settings: XiashuCharSettings | null; onSave: (settings: XiashuCharSettings) => void; onBack: () => void; theme: "light" | "dark";
}) {
  const [draft, setDraft] = useState<XiashuCharSettings>(() => settings || { characterId: character.id, statusBar: { enabled: true, showInChat: true } });
  const presets = loadPresets(); const books = loadWorldBooks(); const regexes = loadRegexes();
  const update = (patch: Partial<XiashuCharSettings>) => setDraft(d => ({ ...d, ...patch }));
  return <div style={{ flex:1, overflow:"auto", padding:16 }}>
    <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:16 }}><button onClick={onBack} style={{ border:0, background:"none", color:"#dc2743" }}><ArrowLeft size={20}/></button><h2 style={{ margin:0, fontSize:18 }}>{character.name} · 独立配置</h2></div>
    <SettingGroup title="角色卡字段">
      <textarea value={draft.scenario || ""} onChange={e => update({ scenario:e.target.value })} placeholder="Scenario / 场景" style={{ width:"calc(100% - 28px)", margin:8, minHeight:70, padding:8, borderRadius:8, border:"1px solid #ddd" }}/>
      <textarea value={draft.systemPrompt || ""} onChange={e => update({ systemPrompt:e.target.value })} placeholder="System Prompt" style={{ width:"calc(100% - 28px)", margin:8, minHeight:90, padding:8, borderRadius:8, border:"1px solid #ddd" }}/>
      <textarea value={draft.postHistoryInstructions || ""} onChange={e => update({ postHistoryInstructions:e.target.value })} placeholder="Post History Instructions" style={{ width:"calc(100% - 28px)", margin:8, minHeight:70, padding:8, borderRadius:8, border:"1px solid #ddd" }}/>
      <textarea value={draft.authorNote || ""} onChange={e => update({ authorNote:e.target.value })} placeholder="Author's Note" style={{ width:"calc(100% - 28px)", margin:8, minHeight:70, padding:8, borderRadius:8, border:"1px solid #ddd" }}/>
    </SettingGroup>
    <SettingGroup title="酒馆绑定（仅当前角色）">
      <SettingRow label="Preset"><select value={draft.presetId || ""} onChange={e => update({ presetId:e.target.value || undefined })} style={{ maxWidth:"55%" }}><option value="">跟随默认</option>{presets.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></SettingRow>
      <SettingRow label="世界书"><select multiple value={draft.worldBookIds || []} onChange={e => update({ worldBookIds:Array.from(e.target.selectedOptions).map(o=>o.value) })} style={{ maxWidth:"55%", minHeight:80 }}>{books.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></SettingRow>
      <SettingRow label="正则组"><select multiple value={draft.regexScriptIds || []} onChange={e => update({ regexScriptIds:Array.from(e.target.selectedOptions).map(o=>o.value) })} style={{ maxWidth:"55%", minHeight:80 }}>{regexes.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></SettingRow>
    </SettingGroup>
    <SettingGroup title="状态栏 / 变量">
      <SettingRow label="启用状态栏"><Toggle on={draft.statusBar?.enabled !== false} onClick={() => update({ statusBar:{ ...(draft.statusBar||{}), enabled: draft.statusBar?.enabled === false } })}/></SettingRow>
      <textarea value={draft.statusBar?.format || ""} onChange={e => update({ statusBar:{ ...(draft.statusBar||{}), format:e.target.value } })} placeholder="自定义状态栏格式；留空则自动解析酒馆状态标签" style={{ width:"calc(100% - 28px)", margin:8, minHeight:70, padding:8, borderRadius:8, border:"1px solid #ddd" }}/>
    </SettingGroup>
    <SettingGroup title="生成参数（仅当前角色）">
      {(["temperature","top_p","top_k","max_tokens","max_context","frequency_penalty","presence_penalty","repetition_penalty","min_p","top_a"] as const).map(key => <SettingRow key={key} label={key}><input type="number" step="0.01" value={draft.generation?.[key] ?? ""} onChange={e => update({ generation:{ ...(draft.generation||{}), [key]: e.target.value === "" ? undefined : Number(e.target.value) } })} style={{ width:100 }}/></SettingRow>)}
    </SettingGroup>
    <button onClick={() => onSave(draft)} style={{ width:"100%", padding:12, border:0, borderRadius:12, background:"#dc2743", color:"white", fontWeight:600 }}>保存当前角色全部配置</button>
  </div>;
}

// ── 设置页 ──────────────────────────────────────────
function SettingsPage({ settings, regexScripts, cssThemes, activeCss, onToggleTheme, onToggleRegex, onImportRegex, regexInputRef, onImportCss, onToggleCss, onDeleteCss, cssInputRef, onBack }: {
  settings: XiashuSettings;
  regexScripts: TavernRegexScript[];
  cssThemes: XiashuCssTheme[];
  activeCss: string;
  onToggleTheme: () => void;
  onToggleRegex: (idx: number) => void;
  onImportRegex: (file: File) => void;
  regexInputRef: React.RefObject<HTMLInputElement>;
  onImportCss: (file: File) => void;
  onToggleCss: (id: string) => void;
  onDeleteCss: (id: string) => void;
  cssInputRef: React.RefObject<HTMLInputElement>;
  onBack: () => void;
}) {
  const [showCssPreview, setShowCssPreview] = useState(false);

  return (
    <div style={{ flex: 1, overflow: "auto", padding: "16px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "20px" }}>
        <button onClick={onBack} style={{ border: "none", background: "none", cursor: "pointer", color: "#dc2743", padding: "4px" }}>
          <ArrowLeft size={20} />
        </button>
        <h2 style={{ fontSize: "18px", fontWeight: 700, margin: 0 }}>设置</h2>
      </div>

      {/* 外观 */}
      <SettingGroup title="外观">
        <SettingRow label="深色模式" icon={settings.theme === "dark" ? <Moon size={16} /> : <Sun size={16} />}>
          <Toggle on={settings.theme === "dark"} onClick={onToggleTheme} />
        </SettingRow>
        <SettingRow label="状态栏" icon={<Heart size={16} />}>
          <Toggle on={settings.showStatusBar} onClick={() => {}} />
        </SettingRow>
      </SettingGroup>

      {/* CSS 美化 */}
      <SettingGroup title="CSS 美化（酒馆导出）">
        <input ref={cssInputRef} type="file" accept=".json,.css,application/json,text/css" style={{ display: "none" }}
          onChange={(e) => { if (e.target.files?.[0]) onImportCss(e.target.files[0]); e.target.value = ""; }}
        />
        <div onClick={() => cssInputRef.current?.click()} style={{
          border: "2px dashed #ddd", borderRadius: "12px", padding: "16px", textAlign: "center",
          cursor: "pointer", margin: "8px 14px",
        }}>
          <Palette size={20} style={{ color: "#dc2743", marginBottom: "4px" }} />
          <div style={{ fontSize: "13px", fontWeight: 600 }}>导入 CSS 美化</div>
          <div style={{ fontSize: "11px", color: "#8e8e93", marginTop: "2px" }}>
            支持 .json / .css 格式，酒馆导出的美化主题
          </div>
        </div>

        {cssThemes.length > 0 && (
          <div style={{ padding: "0 14px" }}>
            {cssThemes.map((theme) => (
              <div key={theme.id} style={{
                display: "flex", alignItems: "center", gap: "8px", padding: "10px 0",
                borderBottom: "1px solid rgba(0,0,0,0.04)",
              }}>
                <span style={{ color: "#8e8e93" }}><FileCode size={14} /></span>
                <span style={{ flex: 1, fontSize: "13px", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {theme.name}
                </span>
                <button onClick={() => onDeleteCss(theme.id)} style={{
                  border: "none", background: "none", cursor: "pointer", color: "#ff3b30", padding: "2px",
                }}>
                  <Trash2 size={14} />
                </button>
                <Toggle on={theme.enabled} onClick={() => onToggleCss(theme.id)} />
              </div>
            ))}

            {/* 预览按钮 */}
            <button onClick={() => setShowCssPreview(!showCssPreview)} style={{
              border: "1px solid #ddd", borderRadius: "8px", padding: "6px 12px",
              background: "none", cursor: "pointer", fontSize: "12px", color: "#8e8e93",
              marginTop: "8px", width: "100%",
            }}>
              {showCssPreview ? "收起 CSS 预览" : "查看当前生效 CSS"}
            </button>
            {showCssPreview && activeCss && (
              <pre style={{
                margin: "8px 0", padding: "10px", fontSize: "10px", lineHeight: 1.4,
                background: "rgba(0,0,0,0.04)", borderRadius: "8px",
                overflow: "auto", maxHeight: "200px", whiteSpace: "pre-wrap", wordBreak: "break-all",
              }}>
                {activeCss.slice(0, 500)}{activeCss.length > 500 ? "\n..." : ""}
              </pre>
            )}
          </div>
        )}
        {cssThemes.length === 0 && (
          <div style={{ padding: "8px 14px", fontSize: "12px", color: "#8e8e93" }}>
            暂无 CSS 美化，导入酒馆导出的 .css 文件即可应用自定义样式。
          </div>
        )}
      </SettingGroup>

      {/* 正则脚本 */}
      <SettingGroup title="酒馆正则脚本">
        <input ref={regexInputRef} type="file" accept=".json" style={{ display: "none" }}
          onChange={(e) => { if (e.target.files?.[0]) onImportRegex(e.target.files[0]); e.target.value = ""; }}
        />
        <div onClick={() => regexInputRef.current?.click()} style={{
          border: "2px dashed #ddd", borderRadius: "12px", padding: "16px", textAlign: "center",
          cursor: "pointer", margin: "8px 14px",
        }}>
          <Upload size={20} style={{ color: "#dc2743", marginBottom: "4px" }} />
          <div style={{ fontSize: "13px", fontWeight: 600 }}>导入正则脚本</div>
          <div style={{ fontSize: "11px", color: "#8e8e93", marginTop: "2px" }}>JSON 格式，用于状态栏美化渲染</div>
        </div>

        {regexScripts.length > 0 && (
          <div style={{ padding: "0 14px" }}>
            {regexScripts.map((script, idx) => (
              <SettingRow key={idx} label={script.scriptName} icon={<BookOpen size={14} />}>
                <Toggle on={!script.disabled} onClick={() => onToggleRegex(idx)} />
              </SettingRow>
            ))}
          </div>
        )}
        {regexScripts.length === 0 && (
          <div style={{ padding: "8px 14px", fontSize: "12px", color: "#8e8e93" }}>
            暂无正则脚本，导入酒馆正则 JSON 即可启用状态栏美化。
          </div>
        )}
      </SettingGroup>

      {/* 关于 */}
      <SettingGroup title="关于">
        <SettingRow label="夏书" icon={<BookOpen size={16} />}>
          <span style={{ fontSize: "12px", color: "#8e8e93" }}>v1.1</span>
        </SettingRow>
        <div style={{ padding: "8px 14px", fontSize: "12px", color: "#8e8e93", lineHeight: 1.6 }}>
          夏书是一个兼容 SillyTavern 角色卡的小型酒馆应用。
          支持导入 PNG/JSON 角色卡、CSS 美化、正则脚本，
          通过宿主角色库进行 AI 对话。
        </div>
      </SettingGroup>
    </div>
  );
}

function SettingGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: "20px" }}>
      <div style={{ fontSize: "12px", fontWeight: 600, color: "#8e8e93", padding: "0 14px 4px", textTransform: "uppercase", letterSpacing: "0.5px" }}>
        {title}
      </div>
      <div style={{
        borderRadius: "12px", overflow: "hidden",
        background: "rgba(0,0,0,0.02)",
      }}>
        {children}
      </div>
    </div>
  );
}

function SettingRow({ label, icon, children }: { label: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: "8px", padding: "10px 14px",
      borderBottom: "1px solid rgba(0,0,0,0.04)",
    }}>
      {icon && <span style={{ color: "#8e8e93" }}>{icon}</span>}
      <span style={{ flex: 1, fontSize: "14px", fontWeight: 500 }}>{label}</span>
      {children}
    </div>
  );
}

function Toggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{
      width: "40px", height: "24px", borderRadius: "12px", border: "none", cursor: "pointer",
      background: on ? INS_GRADIENT : "rgba(0,0,0,0.15)",
      position: "relative", transition: "background 0.2s",
    }}>
      <div style={{
        position: "absolute", top: "2px", left: on ? "18px" : "2px",
        width: "20px", height: "20px", borderRadius: "50%", background: "white",
        transition: "left 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
      }} />
    </button>
  );
}
