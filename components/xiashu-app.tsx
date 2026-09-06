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
} from "@/lib/xiashu-storage";
import type { XiashuMessage, XiashuStatus, XiashuChatSession, TavernRegexScript } from "@/lib/xiashu-types";
import { parseTavernCard, parseTavernCardFromJson, convertToCharacter, getCardSummary } from "@/lib/xiashu-import";
import { generateReply, generateGreeting, parseStatusFromResponse, formatMessageContent, ChatEngineError } from "@/lib/xiashu-engine";

type Page = "characters" | "chat" | "settings";
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

  // 刷新角色列表
  const refreshCharacters = useCallback(() => {
    setCharacters(loadCharacters());
  }, []);

  const currentChar = characters.find((c) => c.id === currentCharId) || null;
  const currentSession = currentCharId ? sessions[currentCharId] : null;

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
      onNotice(`角色卡导入成功：${summary.name}`);
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

  // ── 导入 CSS 美化 ───────────────────────────────────
  const handleImportCss = useCallback(async (file: File) => {
    try {
      const css = await file.text();
      if (!css.trim()) {
        onNotice("CSS 文件为空");
        return;
      }
      const name = file.name.replace(/\.css$/i, "") || "未命名美化";
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
            <TabButton icon={<BookOpen size={22} />} label="对话" active={page === "chat"} onClick={() => currentCharId ? setPage("chat") : setPage("characters")} settings={settings} />
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
                <div key={char.id} onClick={() => onStartChat(char.id)} style={{
                  cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: "6px",
                }}>
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
        <input ref={cssInputRef} type="file" accept=".css,text/css" style={{ display: "none" }}
          onChange={(e) => { if (e.target.files?.[0]) onImportCss(e.target.files[0]); e.target.value = ""; }}
        />
        <div onClick={() => cssInputRef.current?.click()} style={{
          border: "2px dashed #ddd", borderRadius: "12px", padding: "16px", textAlign: "center",
          cursor: "pointer", margin: "8px 14px",
        }}>
          <Palette size={20} style={{ color: "#dc2743", marginBottom: "4px" }} />
          <div style={{ fontSize: "13px", fontWeight: 600 }}>导入 CSS 美化</div>
          <div style={{ fontSize: "11px", color: "#8e8e93", marginTop: "2px" }}>
            支持 .css 格式，酒馆导出的美化主题
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
