// lib/xiashu-types.ts — 夏书 App 类型定义

export const XIASHU_APP_ID = "xiashu";

// ── 聊天消息 ──────────────────────────────────────
export type XiashuMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: string;
  // 正则脚本渲染后的 HTML（可选，仅用于显示）
  renderedHtml?: string;
};

// ── 状态栏 ──────────────────────────────────────────
export type XiashuStatus = {
  affection: number;     // 好感度 0-100
  mood: string;          // 心情
  trust: string;         // 信任
  stage: string;         // 关系阶段
};

// ── 聊天会话 ────────────────────────────────────────
export type XiashuChatSession = {
  characterId: string;
  characterName: string;
  messages: XiashuMessage[];
  status: XiashuStatus | null;
  createdAt: string;
  updatedAt: string;
};

// ── 按角色配置（正则/预设/状态栏/CSS 美化）────────────
export type XiashuCharSettings = {
  characterId: string;
  // 按角色绑定的正则脚本 ID 列表（引用全局正则列表中的 id）
  regexScriptIds?: string[];
  // 按角色自定义预设：覆盖默认系统提示词
  customSystemPrompt?: string;
  // 按角色自定义状态栏输出格式模板
  // 使用占位符：{affection} {mood} {trust} {stage}
  // 默认：[状态:好感度={affection};心情={mood};信任={trust};关系阶段={stage}]
  statusFormat?: string;
  // 按角色自定义 CSS 美化（注入到消息渲染的 <style> 中）
  customCss?: string;
  // 是否禁用全局正则（仅使用角色绑定的正则）
  disableGlobalRegex?: boolean;
};

// ── 酒馆角色卡格式（SillyTavern V2/V3）──────────────
export type TavernCardV2 = {
  spec?: string;
  spec_version?: string;
  data: {
    name: string;
    description?: string;
    personality?: string;
    scenario?: string;
    first_mes?: string;
    mes_example?: string;
    alternate_greetings?: string[];
    tags?: string[];
    creator?: string;
    creator_notes?: string;
    character_version?: string;
    system_prompt?: string;
    post_history_instructions?: string;
    character_book?: TavernWorldBook;
    extensions?: Record<string, unknown>;
    // V3 额外字段
    nickname?: string;
    creator_notes_multilingual?: Record<string, string>;
    source?: string[];
    assets?: { type: string; uri: string; name?: string }[];
    group_only_greetings?: string[];
    creation_date?: number;
    modification_date?: number;
  };
};

// ── 酒馆世界书 ──────────────────────────────────────
export type TavernWorldBookEntry = {
  keys: string[];
  secondary_keys?: string[];
  content: string;
  comment?: string;
  enabled?: boolean;
  selective?: boolean;
  constant?: boolean;
  position?: string | number;
  insertion_order?: number;
  use_regex?: boolean;
};

export type TavernWorldBook = {
  name?: string;
  description?: string;
  scan_depth?: number;
  token_budget?: number;
  recursive_scanning?: boolean;
  extensions?: Record<string, unknown>;
  entries: Record<string, TavernWorldBookEntry> | TavernWorldBookEntry[];
};

// ── 酒馆正则脚本 ────────────────────────────────────
export type TavernRegexScript = {
  id?: string;
  scriptName: string;
  findRegex: string;
  replaceString: string;
  trimStrings?: string[];
  disabled?: boolean;
  markdownOnly?: boolean;
  promptOnly?: boolean;
  runOnEdit?: boolean;
  placement?: number[];
  tags?: string[];
};

// ── 导入结果 ────────────────────────────────────────
export type XiashuImportResult = {
  character: {
    name: string;
    persona: string;
    personality?: string;
    avatar: string | null;
    tags: string[];
    firstMes?: string;
    scenario?: string;
    mesExample?: string;
    systemPrompt?: string;
    postHistoryInstructions?: string;
    alternateGreetings?: string[];
    creator?: string;
  };
  worldBook?: TavernWorldBook | null;
  image: string | null;  // data URL
};
