// ── 攻略副本 APP 类型定义 ──────────────────────────────────

/** 画风 */
export type RaidTheme = "ancient" | "modern" | "mono" | "cyber" | "horror" | "cozy";

/** 番茄小说热门类型 */
export type NovelType =
    | "rebirth"        // 重生复仇
    | "system"         // 系统流
    | "transmigration" // 穿越攻略
    | "sweet"          // 甜宠追妻
    | "abuse"          // 虐恋情深
    | "harem"          // 后宫争斗
    | "undercover"     // 潜伏谍战
    | "apocalypse"     // 末世求生
    | "campus"         // 校园青春
    | "business"       // 商战豪门
    | "immortal"       // 仙侠修真
    | "palace";        // 宫斗权谋

/** 难度 */
export type Difficulty = "easy" | "normal" | "hard" | "hell";

/** 攻略模式 */
export type StoryMode = "novel" | "portrait";

/** NPC 角色定位 */
export type NpcRole = "male_lead" | "male_second" | "female_second" | "female_support" | "npc";

/** 剧情中的对话 */
export type DialogueLine = {
    speaker: string;
    text: string;
    emotion?: string;
};

/** 剧情选项 */
export type StoryChoice = {
    id: string;
    text: string;
    hint?: string;
    riskLevel?: "safe" | "risky" | "deadly";
    requiresFavor?: { npcId: string; threshold: number };
    /** AI 预估的好感度变化（用于 UI 显示 +X/-X） */
    favorDelta?: number;
};

/** 一个剧情节点 */
export type StoryBeat = {
    id: string;
    chapter: number;
    sceneTitle: string;
    narration: string;
    dialogue: DialogueLine[];
    choices: StoryChoice[];
    favorChanges: Record<string, number>;
    isDeath: boolean;
    isClimax: boolean;
    createdAt: string;
    /** 玩家选择此节点时输入的剧情指导 */
    playerGuidance?: string;
    /** AI 建议的场景画面描述（用于生图 prompt） */
    scenePrompt?: string;
    /** 缓存的场景背景图 dataUrl */
    sceneImageUrl?: string;
};

/** 存档槽 */
export type SaveSlot = {
    id: string;
    slotName: string;
    chapter: number;
    beatId: string;
    favorSnapshot: Record<string, number>;
    storyBeatsCount: number;
    createdAt: string;
};

/** 副本 NPC */
export type DungeonNpc = {
    id: string;
    name: string;
    role: NpcRole;
    persona: string;
    appearance: string;
    initialFavor: number;
    isTarget: boolean;
    characterId?: string;
    /** 用户上传或AI生成的立绘图（dataUrl[]），可多张 */
    portraits?: string[];
    /** 用户上传的参考图（dataUrl[]），用于AI生成立绘，可多张 */
    referenceImages?: string[];
};

/** 副本实例 */
export type RaidDungeon = {
    id: string;
    name: string;
    theme: RaidTheme;
    novelType: NovelType;
    difficulty: Difficulty;
    worldview: string;
    mode: StoryMode;
    targetCharacterIds: string[];
    npcs: DungeonNpc[];
    favor: Record<string, number>;
    storyBeats: StoryBeat[];
    currentBeatId: string | null;
    currentChapter: number;
    status: "setup" | "playing" | "cleared" | "failed";
    bgmUrl?: string;
    bgmName?: string;
    saves: SaveSlot[];
    deathCount: number;
    createdAt: string;
    updatedAt: string;
    /** 用户自定义 CSS */
    customCss?: string;
    /** NPC 立绘缓存：npcId → dataUrl */
    npcPortraits?: Record<string, string>;
    /** 用户上传的副本封面图（dataUrl），用于卡片展示 */
    coverImage?: string;
};

/** 预设模板 */
export type DungeonPreset = {
    id: string;
    novelType: NovelType;
    name: string;
    worldviewTemplate: string;
    themes: RaidTheme[];
    description: string;
    initialFavorRange: [number, number];
    tags: string[];
};

// ── 枚举映射 ──────────────────────────────────────────────

export const THEME_LABELS: Record<RaidTheme, string> = {
    ancient: "古风",
    modern: "现代",
    mono: "黑白简约",
    cyber: "赛博",
    horror: "恐怖",
    cozy: "温馨",
};

export const NOVEL_TYPE_LABELS: Record<NovelType, string> = {
    rebirth: "重生复仇",
    system: "系统流",
    transmigration: "穿越攻略",
    sweet: "甜宠追妻",
    abuse: "虐恋情深",
    harem: "后宫争斗",
    undercover: "潜伏谍战",
    apocalypse: "末世求生",
    campus: "校园青春",
    business: "商战豪门",
    immortal: "仙侠修真",
    palace: "宫斗权谋",
};

export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
    easy: "初级",
    normal: "中级",
    hard: "高级",
    hell: "地狱级",
};

export const DIFFICULTY_DESC: Record<Difficulty, string> = {
    easy: "好感度初始较高，死亡概率低，适合体验剧情",
    normal: "好感度初始中等，选项容错率适中",
    hard: "好感度初始偏低，错误选项容易触发死亡结局",
    hell: "好感度初始极低，一步走错即死，极限挑战",
};

export const DIFFICULTY_FAVOR_MOD: Record<Difficulty, number> = {
    easy: 1.4,
    normal: 1.0,
    hard: 0.7,
    hell: 0.4,
};

export const DIFFICULTY_DEATH_THRESHOLD: Record<Difficulty, number> = {
    easy: -30,
    normal: -15,
    hard: 0,
    hell: 10,
};

export const NPC_ROLE_LABELS: Record<NpcRole, string> = {
    male_lead: "男主",
    male_second: "男二",
    female_second: "女二",
    female_support: "女配",
    npc: "NPC",
};

export const STORY_MODE_LABELS: Record<StoryMode, string> = {
    novel: "小说模式",
    portrait: "立绘模式",
};
