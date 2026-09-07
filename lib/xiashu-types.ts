// lib/xiashu-types.ts — 夏书 App 类型定义

export const XIASHU_APP_ID = "xiashu";

export type XiashuMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: string;
  renderedHtml?: string;
};

/**
 * 状态栏不再限定为固定四项。保留旧字段只是为了兼容已有夏书会话，
 * dynamic 保存酒馆角色卡/状态脚本产生的任意字段。
 */
export type XiashuStatus = {
  affection: number;
  mood: string;
  trust: string;
  stage: string;
  dynamic?: Record<string, string | number | boolean | null>;
  raw?: string;
};

export type XiashuChatSession = {
  characterId: string;
  characterName: string;
  messages: XiashuMessage[];
  status: XiashuStatus | null;
  createdAt: string;
  updatedAt: string;
};

/** 每张角色卡自己的运行配置。不会和其他角色共享。 */
export type XiashuCharSettings = {
  characterId: string;
  presetId?: string;
  worldBookIds?: string[];
  regexScriptIds?: string[];
  apiConfigId?: string;

  /** 角色卡原始 system / post-history，可被用户单独覆盖。 */
  systemPrompt?: string;
  postHistoryInstructions?: string;
  authorNote?: string;
  scenario?: string;
  firstMes?: string;
  alternateGreetings?: string[];

  /** 角色级生成参数；undefined 时回退到 Preset/API。 */
  generation?: {
    temperature?: number;
    top_p?: number;
    top_k?: number;
    max_tokens?: number;
    max_context?: number;
    frequency_penalty?: number;
    presence_penalty?: number;
    repetition_penalty?: number;
    min_p?: number;
    top_a?: number;
  };

  /** 状态栏/变量配置。 */
  statusBar?: {
    enabled?: boolean;
    format?: string;
    parseTags?: string[];
    showInChat?: boolean;
    customFields?: string[];
  };

  customCss?: string;
  disableGlobalRegex?: boolean;

  /** 完整保留酒馆卡中未知 extensions，避免导入时丢参数。 */
  cardExtensions?: Record<string, unknown>;
  /** 完整原始 data，用于再次导出/未来兼容未知字段。 */
  rawCardData?: Record<string, unknown>;
  rawSpec?: string;
  rawSpecVersion?: string;
};

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
    nickname?: string;
    creator_notes_multilingual?: Record<string, string>;
    source?: string[];
    assets?: { type: string; uri: string; name?: string }[];
    group_only_greetings?: string[];
    creation_date?: number;
    modification_date?: number;
    [key: string]: unknown;
  };
};

export type TavernWorldBookEntry = {
  keys?: string[];
  secondary_keys?: string[];
  content?: string;
  comment?: string;
  enabled?: boolean;
  selective?: boolean;
  constant?: boolean;
  position?: string | number;
  insertion_order?: number;
  use_regex?: boolean;
  case_sensitive?: boolean;
  priority?: number;
  depth?: number;
  probability?: number;
  useProbability?: boolean;
  role?: number;
  [key: string]: unknown;
};

export type TavernWorldBook = {
  name?: string;
  description?: string;
  scan_depth?: number;
  token_budget?: number;
  recursive_scanning?: boolean;
  extensions?: Record<string, unknown>;
  entries: Record<string, TavernWorldBookEntry> | TavernWorldBookEntry[];
  [key: string]: unknown;
};

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
  substituteRegex?: number;
  minDepth?: number;
  maxDepth?: number;
  [key: string]: unknown;
};

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
    groupOnlyGreetings?: string[];
    creator?: string;
    creatorNotes?: string;
    characterVersion?: string;
    nickname?: string;
    creatorNotesMultilingual?: Record<string, string>;
    source?: string[];
    assets?: { type: string; uri: string; name?: string }[];
    creationDate?: number;
    modificationDate?: number;
    extensions: Record<string, unknown>;
  };
  worldBook?: TavernWorldBook | null;
  regexScripts?: TavernRegexScript[];
  statusBar?: { enabled?: boolean; format?: string; raw?: unknown };
  image: string | null;
  rawCardData: Record<string, unknown>;
  rawSpec?: string;
  rawSpecVersion?: string;
};
