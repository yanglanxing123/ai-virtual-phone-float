// lib/xiashu-engine.ts — 夏书 App AI 对话引擎
import { loadCharacters } from "./character-storage";
import type { Character } from "./character-types";
import { sendLLMRequest, ChatEngineError } from "./chat-engine";
import { MacroEngine } from "./macro-engine";
import {
  loadApiConfigs,
  loadBindingConfig,
  loadPresets,
  loadWorldBooks,
  loadRegexes,
  resolveBinding,
} from "./settings-storage";
import type { ApiConfig, PresetConfig, RegexConfig, WorldBookConfig, BindingSlot } from "./settings-types";
import type { XiashuMessage, XiashuStatus, TavernRegexScript } from "./xiashu-types";
import { XIASHU_APP_ID } from "./xiashu-types";
import { loadRegexScripts } from "./xiashu-storage";

export const STATUS_REGEX = /\[状态:好感度=(\d+);心情=([^;]+);信任=([^;]+);关系阶段=([^\]]+)\]/;

// 酒馆状态栏兼容格式
const TAVERN_STATUS_PATTERNS = [
  /<Bar>([\s\S]*?)<\/Bar>/i,
  /<状态栏>([\s\S]*?)<\/状态栏>/i,
  /<StatusBar>([\s\S]*?)<\/StatusBar>/i,
  /<status>([\s\S]*?)<\/status>/i,
];

// ── 状态栏解析 ───────────────────────────────────────
export function parseStatusFromResponse(text: string): {
  cleanText: string;
  status: XiashuStatus | null;
} {
  // 夏书原生格式
  const match = text.match(STATUS_REGEX);
  if (match) {
    return {
      cleanText: text.replace(STATUS_REGEX, "").trim(),
      status: {
        affection: parseInt(match[1]) || 0,
        mood: match[2] || "未知",
        trust: match[3] || "未知",
        stage: match[4] || "初识",
      },
    };
  }

  // 酒馆风格状态栏
  for (const pattern of TAVERN_STATUS_PATTERNS) {
    const m = text.match(pattern);
    if (m) {
      const statusText = m[1];
      const affection = extractValue(statusText, /好感度[:\s]*(\d+)/i) || extractValue(statusText, /favor[:\s]*(\d+)/i) || "0";
      const mood = extractValue(statusText, /心情[:\s]*([^\n\[\]]+)/i) || extractValue(statusText, /mood[:\s]*([^\n\[\]]+)/i) || "未知";
      const trust = extractValue(statusText, /信任[:\s]*([^\n\[\]]+)/i) || extractValue(statusText, /trust[:\s]*([^\n\[\]]+)/i) || "未知";
      const stage = extractValue(statusText, /关系[:\s]*([^\n\[\]]+)/i) || extractValue(statusText, /stage[:\s]*([^\n\[\]]+)/i) || "初识";
      return {
        cleanText: text.replace(pattern, "").trim(),
        status: {
          affection: parseInt(affection) || 0,
          mood: mood.trim(),
          trust: trust.trim(),
          stage: stage.trim(),
        },
      };
    }
  }

  return { cleanText: text, status: null };
}

function extractValue(text: string, regex: RegExp): string | null {
  const m = text.match(regex);
  return m ? m[1] : null;
}

// ── 正则脚本应用 ─────────────────────────────────────
export function applyRegexScripts(text: string, scripts?: TavernRegexScript[]): string {
  const allScripts = scripts || loadRegexScripts();
  let result = text;
  for (const script of allScripts) {
    if (script.disabled) continue;
    try {
      const regex = new RegExp(script.findRegex, "gi");
      if (script.replaceString) {
        result = result.replace(regex, script.replaceString);
      }
    } catch (e) {
      console.warn("[夏书] 正则脚本应用失败:", script.scriptName, e);
    }
  }
  return result;
}

// ── 构建系统提示词 ───────────────────────────────────
function buildSystemPrompt(
  character: Character,
  history: XiashuMessage[],
  userName: string,
  worldBookEntries?: { key: string; content: string }[],
): string {
  const persona = character.persona || "";
  const personality = character.personality || "";

  let prompt = `你是角色「${character.name}」。请完全代入以下人设与用户进行角色扮演对话。

【角色人设】
${persona}`;

  if (personality) {
    prompt += `\n\n【角色性格】\n${personality}`;
  }

  // 注入世界书条目
  if (worldBookEntries && worldBookEntries.length > 0) {
    prompt += `\n\n【世界书 / 背景设定】`;
    for (const entry of worldBookEntries) {
      prompt += `\n[${entry.key}]\n${entry.content}`;
    }
  }

  prompt += `\n\n【对话规则】
1. 用第一人称回复，保持角色人设不崩。
2. 对话自然流畅，不要机械地复述人设。
3. 可以使用 *星号包裹动作描写*。
4. 在回复末尾，用以下格式标注角色当前状态（用户不可见）：
   [状态:好感度=数字;心情=词语;信任=词语;关系阶段=词语]
   例如：[状态:好感度=65;心情=期待;信任=中等;关系阶段=朋友]
5. 好感度范围 0-100，根据对话内容动态变化。
6. 心情用简短词语，如：开心、害羞、生气、期待、紧张、平静等。
7. 信任用：低、较低、中等、较高、高等。
8. 关系阶段用：初识、认识、朋友、好友、亲密、恋人等。`;

  return prompt;
}

// ── 加载并过滤世界书条目 ─────────────────────────────
function loadActiveWorldBookEntries(
  characterId: string,
  history: XiashuMessage[],
  slot: BindingSlot,
): { key: string; content: string }[] {
  if (!slot.worldBookIds || slot.worldBookIds.length === 0) return [];

  const allBooks = loadWorldBooks();
  const boundBooks = allBooks.filter(b => slot.worldBookIds!.includes(b.id));
  if (boundBooks.length === 0) return [];

  // 取最近几条对话文本作为关键词匹配源
  const recentText = history.slice(-5).map(m => m.content).join(" ");

  const result: { key: string; content: string }[] = [];
  for (const book of boundBooks) {
    for (const entry of book.entries) {
      if (entry.disable) continue;
      // constant 条目始终注入
      if (entry.constant) {
        result.push({ key: entry.comment || entry.key, content: entry.content });
        continue;
      }
      // 关键词匹配
      if (entry.key) {
        const keys = entry.use_regex
          ? [entry.key]
          : entry.key.split(",").map(k => k.trim()).filter(Boolean);
        for (const k of keys) {
          try {
            if (entry.use_regex) {
              const regex = new RegExp(k, "i");
              if (regex.test(recentText)) {
                result.push({ key: entry.comment || entry.key, content: entry.content });
                break;
              }
            } else if (recentText.includes(k)) {
              result.push({ key: entry.comment || entry.key, content: entry.content });
              break;
            }
          } catch { /* regex error, skip */ }
        }
      }
    }
  }
  return result;
}

// ── 构建聊天消息列表 ─────────────────────────────────
function buildChatMessages(
  character: Character,
  history: XiashuMessage[],
  userMessage: string,
  userName: string,
  worldBookEntries?: { key: string; content: string }[],
): { role: string; content: string }[] {
  const messages: { role: string; content: string }[] = [];

  // 系统提示词
  messages.push({
    role: "system",
    content: buildSystemPrompt(character, history, userName, worldBookEntries),
  });

  // 历史对话（最多取最近 20 条）
  const recentHistory = history.slice(-20);
  for (const msg of recentHistory) {
    if (msg.role === "system") continue;
    messages.push({
      role: msg.role === "user" ? "user" : "assistant",
      content: msg.content,
    });
  }

  // 当前用户消息
  messages.push({
    role: "user",
    content: userMessage,
  });

  return messages;
}

// ── 生成 AI 回复 ─────────────────────────────────────
export async function generateReply(
  characterId: string,
  history: XiashuMessage[],
  userMessage: string,
  userName: string,
): Promise<{ text: string; status: XiashuStatus | null }> {
  // 加载角色
  const allChars = loadCharacters();
  const character = allChars.find((c) => c.id === characterId);
  if (!character) throw new ChatEngineError(`找不到角色：${characterId}`);

  // 加载绑定配置
  const bindings = loadBindingConfig();
  const slot = resolveBinding(bindings, characterId, XIASHU_APP_ID);

  // 加载世界书条目（常驻 + 关键词匹配）
  const worldBookEntries = loadActiveWorldBookEntries(characterId, history, slot);

  // 加载 API 配置
  const apiConfigs = loadApiConfigs();
  let apiConfig: ApiConfig | undefined;
  if (slot.apiConfigId) {
    apiConfig = apiConfigs.find((c) => c.id === slot.apiConfigId);
  }
  // 降级到角色默认绑定
  if (!apiConfig) {
    const charBinding = bindings.characterBindings.find((b) => b.characterId === characterId);
    if (charBinding?.defaults.apiConfigId) {
      apiConfig = apiConfigs.find((c) => c.id === charBinding.defaults.apiConfigId);
    }
  }
  // 降级到全局默认
  if (!apiConfig && bindings.globalDefaults.apiConfigId) {
    apiConfig = apiConfigs.find((c) => c.id === bindings.globalDefaults.apiConfigId);
  }
  // 降级到第一个可用配置
  if (!apiConfig) {
    apiConfig = apiConfigs[0];
  }
  if (!apiConfig) {
    throw new ChatEngineError(
      "未配置 API。请先在设置中添加 API 配置，并在角色绑定中为夏书绑定 API。"
    );
  }

  // 构建聊天消息
  const messages = buildChatMessages(character, history, userMessage, userName, worldBookEntries);

  // 调用 LLM
  const rawText = await sendLLMRequest(
    apiConfig,
    null, // 不使用预设（夏书自带系统提示词）
    messages.map((m) => ({ role: m.role, content: m.content })),
    [], // 不应用输出正则（在渲染时处理）
    { characterName: character.name, userName },
    { appId: XIASHU_APP_ID },
  );

  // 解析状态栏
  const { cleanText, status } = parseStatusFromResponse(rawText);

  return { text: cleanText || rawText, status };
}

// ── 生成开场白 ───────────────────────────────────────
export async function generateGreeting(
  characterId: string,
  userName: string,
): Promise<string> {
  const allChars = loadCharacters();
  const character = allChars.find((c) => c.id === characterId);
  if (!character) throw new ChatEngineError(`找不到角色：${characterId}`);

  // 检查角色卡中是否有内嵌的开场白
  // 如果 persona 中包含【场景】标记，则角色卡中有 first_mes
  const personaMatch = character.persona?.match(/【场景】\n([\s\S]*?)(?=\n\n【|$)/);
  if (personaMatch) {
    return personaMatch[1].trim();
  }

  // 加载 API 配置
  const bindings = loadBindingConfig();
  const slot = resolveBinding(bindings, characterId, XIASHU_APP_ID);
  const apiConfigs = loadApiConfigs();
  let apiConfig: ApiConfig | undefined;
  if (slot.apiConfigId) {
    apiConfig = apiConfigs.find((c) => c.id === slot.apiConfigId);
  }
  if (!apiConfig && bindings.globalDefaults.apiConfigId) {
    apiConfig = apiConfigs.find((c) => c.id === bindings.globalDefaults.apiConfigId);
  }
  if (!apiConfig) apiConfig = apiConfigs[0];
  if (!apiConfig) {
    throw new ChatEngineError("未配置 API。请先在设置中添加 API 配置。");
  }

  const systemPrompt = `你是角色「${character.name}」。请完全代入以下人设，生成一段开场白。

${character.persona || ""}

${character.personality ? `【角色性格】\n${character.personality}` : ""}

请以角色第一人称写一段开场白（50-150字），自然地引入与「${userName}」的对话场景。可以包含动作描写（用*星号包裹*）。不需要状态栏标记。`;

  const rawText = await sendLLMRequest(
    apiConfig,
    null,
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: `请开始。` },
    ],
    [],
    { characterName: character.name, userName },
    { appId: XIASHU_APP_ID },
  );

  return rawText.trim();
}

// ── 转义 HTML ────────────────────────────────────────
export function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// ── 格式化消息内容 ───────────────────────────────────
export function formatMessageContent(
  text: string,
  regexScripts?: TavernRegexScript[],
): string {
  const scripts = regexScripts || loadRegexScripts();
  // 先应用酒馆正则脚本
  if (scripts.length > 0) {
    const regexResult = applyRegexScripts(text, scripts);
    if (regexResult !== text) {
      return regexResult; // 正则替换后的 HTML 直接返回
    }
  }
  // 普通格式化：转义 + 动作描写
  let formatted = escapeHtml(text);
  formatted = formatted.replace(/\*([^*]+)\*/g, '<span class="xiashu-action">$1</span>');
  return formatted;
}
