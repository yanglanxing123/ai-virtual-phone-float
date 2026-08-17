// components/raid/raid-engine.ts
// 「攻略副本」APP 的 AI 引擎：负责生成副本 NPC 与剧情节点。
// 直接调用 simpleLLMCall（不走聊天预设/正则），要求模型返回 JSON，
// 再在代码层做归一化、兜底与难度校验。

import { simpleLLMCall } from "@/lib/api-helpers";
import { loadApiConfigs, loadBindingConfig, resolveBinding } from "@/lib/settings-storage";
import type { ApiConfig } from "@/lib/settings-types";
import { generateImageFromConfiguredApi } from "@/lib/image-generation-service";
import type {
    RaidDungeon,
    DungeonNpc,
    StoryBeat,
    Difficulty,
    NovelType,
    RaidTheme,
    NpcRole,
    DialogueLine,
    StoryChoice,
} from "./raid-types";
import {
    DIFFICULTY_FAVOR_MOD,
    DIFFICULTY_DEATH_THRESHOLD,
    NOVEL_TYPE_LABELS,
    DIFFICULTY_LABELS,
    NPC_ROLE_LABELS,
    THEME_LABELS,
} from "./raid-types";

// ── 工具函数 ──────────────────────────────────────────────

/** 获取当前激活的 API 配置（与聊天等应用一致，走绑定系统），没有则抛错。 */
function getApiConfig(): ApiConfig {
    const configs = loadApiConfigs();
    if (configs.length === 0) throw new Error("未配置 API，请先在设置中添加 API 配置。");
    // 优先走绑定系统：全局默认绑定的 apiConfigId
    try {
        const bindingConfig = loadBindingConfig();
        const resolved = resolveBinding(bindingConfig);
        if (resolved.apiConfigId) {
            const found = configs.find(c => c.id === resolved.apiConfigId);
            if (found) return found;
        }
    } catch {
        // 绑定解析失败，回退到第一个
    }
    return configs[0];
}

/** 生成带时间戳与随机后缀的唯一 id。 */
function genId(prefix: string): string {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** [min, max] 闭区间随机整数。 */
function randomInRange(min: number, max: number): number {
    const lo = Math.min(min, max);
    const hi = Math.max(min, max);
    return Math.floor(Math.random() * (hi - lo + 1)) + lo;
}

/** 不同难度下 NPC 的初始好感度区间。 */
function favorRangeForDifficulty(d: Difficulty): [number, number] {
    switch (d) {
        case "easy":
            return [30, 40];
        case "normal":
            return [15, 25];
        case "hard":
            return [5, 15];
        case "hell":
            return [0, 10];
        default:
            return [15, 25];
    }
}

/** 校验 role 是否合法，非法时回退为 "npc"。 */
function sanitizeRole(role: unknown): NpcRole {
    const valid: NpcRole[] = ["male_lead", "male_second", "female_second", "female_support", "npc"];
    return typeof role === "string" && valid.includes(role as NpcRole) ? (role as NpcRole) : "npc";
}

/** 不同难度下选项的风险分布指引（写入 prompt）。 */
function riskGuideForDifficulty(d: Difficulty): string {
    switch (d) {
        case "easy":
            return "以 safe 为主，少量 risky，几乎不出现 deadly。";
        case "normal":
            return "safe 与 risky 各半，偶尔出现一个 deadly。";
        case "hard":
            return "risky 居多，至少 1 个 deadly，safe 较少。";
        case "hell":
            return "deadly 占多数，risky 次之，safe 极少甚至没有。";
        default:
            return "safe 与 risky 各半。";
    }
}

/**
 * 从 AI 返回的文本中提取 JSON：兼容 ```json 代码块与纯 JSON，
 * 也会剥离代码块外的多余说明文字。解析失败返回 null。
 */
export function parseJsonResponse(text: string): any {
    if (!text || typeof text !== "string") return null;
    let cleaned = text.trim();
    if (!cleaned) return null;

    // 1) 优先提取 ```json ... ``` 或 ``` ... ``` 代码块
    const codeBlock = cleaned.match(/```(?:json|JSON)?\s*([\s\S]*?)```/);
    if (codeBlock) {
        cleaned = codeBlock[1].trim();
    }

    // 2) 直接尝试解析
    try {
        return JSON.parse(cleaned);
    } catch {
        // fall through
    }

    // 3) 截取第一个 { 或 [ 到最后一个 } 或 ] 之间的内容再试
    const start = cleaned.search(/[{[]/);
    if (start >= 0) {
        const sliced = cleaned.slice(start);
        const endBrace = sliced.lastIndexOf("}");
        const endBracket = sliced.lastIndexOf("]");
        const end = Math.max(endBrace, endBracket);
        if (end > 0) {
            try {
                return JSON.parse(sliced.slice(0, end + 1));
            } catch {
                // fall through
            }
        }
    }
    return null;
}

// ── NPC 生成 ──────────────────────────────────────────────

export interface GenerateNpcsParams {
    /** 世界观文本 */
    worldview: string;
    /** 小说类型 */
    novelType: NovelType;
    /** 画风 */
    theme: RaidTheme;
    /** 难度 */
    difficulty: Difficulty;
    /** 手机里要攻略的角色（将转为 isTarget=true 的男主 NPC） */
    targetCharacters: { id: string; name: string; persona: string; personality: string }[];
    /** 取消信号 */
    signal?: AbortSignal;
}

/**
 * 生成副本 NPC：把目标角色转为 isTarget=true 的男主，再额外生成 2-4 个 NPC
 * （至少 1 个男二、至少 1 个女配），用 simpleLLMCall 调用 AI 并返回 JSON。
 */
export async function generateNpcs(params: GenerateNpcsParams): Promise<DungeonNpc[]> {
    const { worldview, novelType, theme, difficulty, targetCharacters } = params;
    const config = getApiConfig();

    const novelLabel = NOVEL_TYPE_LABELS[novelType];
    const themeLabel = THEME_LABELS[theme];
    const diffLabel = DIFFICULTY_LABELS[difficulty];
    const [favMin, favMax] = favorRangeForDifficulty(difficulty);

    // 没有指定目标角色时，多生成 1 个让 AI 自创男主
    const extraCount = targetCharacters.length > 0 ? randomInRange(2, 4) : randomInRange(3, 4);
    const totalEstimate = targetCharacters.length + extraCount;

    const targetInfo =
        targetCharacters.length > 0
            ? targetCharacters
                  .map(
                      (c, i) =>
                          `目标角色${i + 1}：\n  名字：${c.name}\n  原始人设：${c.persona || "（暂无）"}\n  性格：${c.personality || "（暂无）"}`,
                  )
                  .join("\n\n")
            : "（未指定目标角色，请自创一位男主作为玩家的攻略目标，isTarget=true。）";

    const systemPrompt = [
        "你是番茄小说顶级作者，擅长写爆款攻略文，人设塑造功力深厚。",
        "现在要根据世界观与小说类型，为一款「攻略副本」文字游戏生成全套 NPC。",
        "每个 NPC 都要有独特、有深度的人设与外貌，角色之间关系错综复杂，能撑起一条完整的攻略剧情线。",
        "",
        "【世界观】",
        worldview || "（未提供，请自行构思一个契合小说类型的世界观）",
        "",
        `【小说类型】${novelLabel}`,
        `【画风】${themeLabel}`,
        `【难度】${diffLabel}（NPC 初始好感区间 ${favMin}-${favMax}）`,
        "",
        "【需攻略的目标角色】",
        targetInfo,
        "",
        "生成要求：",
        `1. 把上方每个目标角色转化为 NPC：role="male_lead"（男主，即玩家要攻略的对象），isTarget=true，保留其名字，并基于原始人设扩写更丰富、更有张力的人设与外貌。`,
        `2. 额外生成 ${extraCount} 个 NPC，必须满足：至少 1 个 role="male_second"（男二，与男主形成对照/竞争/暗线），至少 1 个 role="female_support"（女配，推动剧情冲突与误会），其余可为 role="female_second"（女二）或 role="npc"。`,
        "3. 男二、女配、女二的人设要与目标角色形成戏剧张力（情敌/旧爱/挑拨者/助攻等），不可与目标角色同质化，也不得重名。",
        `4. 每个 NPC 的 initialFavor 取 ${favMin}-${favMax} 之间的整数；目标角色（男主）取该区间偏上限，配角取偏下限。`,
        "5. persona 写 150-400 字：身份背景、性格内核、与主角的关系、隐藏动机、说话风格。",
        "6. appearance 写 60-200 字：具有辨识度的外貌描写，符合画风与小说类型。",
        "7. 名字要契合世界观与小说类型。",
        "",
        "严格返回如下 JSON（不要输出任何额外文字、不要包裹 markdown 以外内容）：",
        "{",
        '  "npcs": [',
        "    {",
        '      "name": "角色名",',
        '      "role": "male_lead" | "male_second" | "female_second" | "female_support" | "npc",',
        '      "isTarget": true | false,',
        '      "persona": "完整人设",',
        '      "appearance": "外貌描写",',
        '      "initialFavor": 25',
        "    }",
        "  ]",
        "}",
    ].join("\n");

    const maxTokens = Math.min(16000, Math.max(4096, totalEstimate * 1500));

    const result = await simpleLLMCall(
        config,
        [
            { role: "system", content: systemPrompt },
            {
                role: "user",
                content: `请生成攻略副本的 NPC 阵容。目标角色 ${targetCharacters.length} 个，额外 NPC ${extraCount} 个。`,
            },
        ],
        { temperature: 0.9, max_tokens: maxTokens, signal: params.signal },
    );

    if (result.error) throw new Error(`AI 调用失败：${result.error}`);
    if (!result.content) throw new Error("AI 返回了空内容，请重试。");

    const parsed = parseJsonResponse(result.content);
    if (!parsed || !Array.isArray(parsed.npcs)) {
        if (result.wasTruncated) {
            throw new Error("AI 输出被截断（max_tokens 不足），请减少目标角色数量后重试。");
        }
        throw new Error("AI 返回的 NPC 数据格式不正确，请重试。");
    }

    return buildNpcs(parsed.npcs, targetCharacters, difficulty);
}

/** 把 AI 返回的原始 NPC 数组归一化为 DungeonNpc[]，并做兜底补全。 */
function buildNpcs(
    rawNpcs: any[],
    targetCharacters: { id: string; name: string; persona: string; personality: string }[],
    difficulty: Difficulty,
): DungeonNpc[] {
    const [favMin, favMax] = favorRangeForDifficulty(difficulty);
    const targetByName = new Map(targetCharacters.map((c) => [c.name, c]));
    const usedNames = new Set<string>();
    const result: DungeonNpc[] = [];

    for (const raw of rawNpcs) {
        if (!raw || typeof raw !== "object") continue;
        const name = String(raw.name || "").trim();
        if (!name) continue;
        const safeName = usedNames.has(name) ? `${name}_${result.length + 1}` : name;
        usedNames.add(safeName);

        const target = targetByName.get(name);
        // 目标角色固定为男主；其余按 AI 给的角色（非法则 npc）
        const role: NpcRole = target ? "male_lead" : sanitizeRole(raw.role);

        let initialFavor = Number(raw.initialFavor);
        if (!Number.isFinite(initialFavor)) {
            initialFavor = randomInRange(favMin, favMax);
        }
        initialFavor = Math.max(favMin, Math.min(favMax, Math.round(initialFavor)));

        const persona = String(raw.persona || "").trim() || "（人设待补全）";
        const appearance = String(raw.appearance || "").trim() || "（外貌待补全）";

        result.push({
            id: genId("npc"),
            name: safeName,
            role,
            persona,
            appearance,
            initialFavor,
            isTarget: !!target,
            characterId: target?.id,
        });
    }

    // 兜底 1：确保每个目标角色都出现（AI 漏写时补上）
    for (const tc of targetCharacters) {
        if (!result.some((n) => n.characterId === tc.id)) {
            result.push({
                id: genId("npc"),
                name: tc.name,
                role: "male_lead",
                persona: tc.persona || "（人设待补全）",
                appearance: "（外貌待补全）",
                initialFavor: randomInRange(favMin, favMax),
                isTarget: true,
                characterId: tc.id,
            });
        }
    }

    // 兜底 2：未指定目标角色时，把第一位男主标记为攻略目标
    if (targetCharacters.length === 0 && !result.some((n) => n.isTarget)) {
        const lead = result.find((n) => n.role === "male_lead") || result[0];
        if (lead) lead.isTarget = true;
    }

    // 兜底 3：确保至少 1 个男二
    if (!result.some((n) => n.role === "male_second")) {
        result.push({
            id: genId("npc"),
            name: "顾衍",
            role: "male_second",
            persona:
                "温润如玉的世家公子，表面谦和实则城府极深，与男主亦敌亦友，对主角有着难以言说的执念，是剧情最大的变数。",
            appearance: "眉目清朗，嘴角常含三分笑意，眼底却藏着算计的光，衣着考究、举止从容。",
            initialFavor: randomInRange(favMin, favMax),
            isTarget: false,
        });
    }

    // 兜底 4：确保至少 1 个女配
    if (!result.some((n) => n.role === "female_support")) {
        result.push({
            id: genId("npc"),
            name: "苏婉",
            role: "female_support",
            persona:
                "看似柔弱无害的白月光式女配，实则心思缜密，擅长以退为进，是男女主之间误会与冲突的主要推手。",
            appearance: "鹅蛋脸，柳眉杏眼，常是一副楚楚可怜的模样，眼底偶尔闪过精明。",
            initialFavor: randomInRange(favMin, favMax),
            isTarget: false,
        });
    }

    return result;
}

// ── 剧情节点生成 ──────────────────────────────────────────

export interface GenerateStoryBeatParams {
    /** 当前副本状态 */
    dungeon: RaidDungeon;
    /** 玩家选择的文本（第一章为空） */
    choiceText?: string;
    /** 玩家的剧情方向指导（可选） */
    playerGuidance?: string;
    /** 取消信号 */
    signal?: AbortSignal;
}

/** 取最近一个剧情节点，拼成前情摘要写入 prompt。 */
function summarizeLastBeat(dungeon: RaidDungeon): string {
    const beats = dungeon.storyBeats;
    if (beats.length === 0) return "（这是开局第一章，尚无前情提要）";
    const last = beats[beats.length - 1];
    const lines: string[] = [];
    lines.push(`第${last.chapter}章·${last.sceneTitle}`);
    if (last.isDeath) lines.push("[上一节点为死亡结局]");
    if (last.isClimax) lines.push("[上一节点为高潮结局]");
    if (last.narration) lines.push(`旁白：${last.narration.slice(0, 280)}`);
    for (const d of last.dialogue.slice(0, 4)) {
        lines.push(`${d.speaker}：${d.text.slice(0, 100)}`);
    }
    if (last.choices.length > 0) {
        lines.push(`当时选项：${last.choices.map((c) => c.text).join(" / ")}`);
    }
    const changes = Object.entries(last.favorChanges);
    if (changes.length > 0) {
        lines.push(
            `好感变化：${changes
                .map(([id, d]) => {
                    const n = dungeon.npcs.find((x) => x.id === id);
                    return `${n?.name ?? id}${d >= 0 ? "+" : ""}${d}`;
                })
                .join("，")}`,
        );
    }
    return lines.join("\n");
}

/** 把 AI 返回的 favorChanges 归一化：key 统一为 npcId（兼容名字），值 clamp 到 [-50,50]。 */
function normalizeFavorChanges(raw: any, npcs: DungeonNpc[]): Record<string, number> {
    const out: Record<string, number> = {};
    if (!raw || typeof raw !== "object") return out;
    const validIds = new Set(npcs.map((n) => n.id));
    const nameToId = new Map(npcs.map((n) => [n.name, n.id]));
    for (const [key, val] of Object.entries(raw)) {
        const num = typeof val === "number" ? val : Number(val);
        if (!Number.isFinite(num) || num === 0) continue;
        let id = key;
        if (!validIds.has(key)) {
            const mapped = nameToId.get(key);
            if (mapped) id = mapped;
            else continue; // 未知 NPC，丢弃
        }
        const clamped = Math.max(-50, Math.min(50, Math.round(num)));
        out[id] = (out[id] || 0) + clamped;
    }
    return out;
}

/** 把 AI 返回的 choices 归一化为 StoryChoice[]，最多 4 个。 */
function buildChoices(raw: any, beatId: string): StoryChoice[] {
    if (!Array.isArray(raw)) return [];
    const list: StoryChoice[] = [];
    for (let i = 0; i < raw.length && list.length < 4; i++) {
        const c = raw[i];
        if (!c || typeof c !== "object") continue;
        const text = String(c.text || "").trim();
        if (!text) continue;
        const choice: StoryChoice = {
            id: `${beatId}_c${i}`,
            text: text.slice(0, 120),
        };
        if (c.hint) choice.hint = String(c.hint).trim().slice(0, 80);
        const risk = String(c.riskLevel || "").trim();
        if (risk === "safe" || risk === "risky" || risk === "deadly") {
            choice.riskLevel = risk;
        }
        if (c.requiresFavor && typeof c.requiresFavor === "object") {
            const npcId = String(c.requiresFavor.npcId || "").trim();
            const threshold = Number(c.requiresFavor.threshold);
            if (npcId && Number.isFinite(threshold)) {
                choice.requiresFavor = { npcId, threshold: Math.round(threshold) };
            }
        }
        const fd = Number(c.favorDelta);
        if (Number.isFinite(fd) && fd !== 0) {
            choice.favorDelta = Math.round(fd);
        }
        list.push(choice);
    }
    return list;
}

/**
 * 生成下一个剧情节点：根据当前章节、好感度、难度推进剧情，
 * 返回 narration / dialogue / choices / favorChanges，并判定死亡与高潮结局。
 */
export async function generateStoryBeat(params: GenerateStoryBeatParams): Promise<StoryBeat> {
    const { dungeon, choiceText, playerGuidance } = params;
    const config = getApiConfig();

    const difficulty = dungeon.difficulty;
    const deathThreshold = DIFFICULTY_DEATH_THRESHOLD[difficulty];
    const favorMod = DIFFICULTY_FAVOR_MOD[difficulty];

    // 以目标角色（男主）的好感度判定死亡 / 高潮；无目标时退化为全部 NPC
    const targetNpcs = dungeon.npcs.filter((n) => n.isTarget);
    const checkNpcs = targetNpcs.length > 0 ? targetNpcs : dungeon.npcs;
    const favors = checkNpcs.map((n) => dungeon.favor[n.id] ?? n.initialFavor ?? 0);
    const minFavor = favors.length > 0 ? Math.min(...favors) : 0;
    const maxFavor = favors.length > 0 ? Math.max(...favors) : 0;

    const isDeathTriggered = minFavor <= deathThreshold;
    const canClimax = maxFavor >= 80;

    const lastSummary = summarizeLastBeat(dungeon);

    const npcRoster = dungeon.npcs
        .map((n) => {
            const fav = dungeon.favor[n.id] ?? n.initialFavor ?? 0;
            const appearance = n.appearance ? `\n    外貌：${n.appearance.slice(0, 80)}` : "";
            return `  - id=${n.id} | ${n.name}（${NPC_ROLE_LABELS[n.role]}${n.isTarget ? "·攻略目标" : ""}）| 好感度=${fav}\n    人设：${n.persona.slice(0, 80)}${appearance}`;
        })
        .join("\n");

    const diffLabel = DIFFICULTY_LABELS[difficulty];
    const novelLabel = NOVEL_TYPE_LABELS[dungeon.novelType];
    const riskGuide = riskGuideForDifficulty(difficulty);

    // 第 5 条规则按当前局势动态切换
    let rule5: string;
    if (isDeathTriggered) {
        rule5 = `5. 【重要】当前已有目标好感度（${minFavor}）低于死亡线 ${deathThreshold}，本次必须生成死亡结局：isDeath=true，写一段具有冲击力的死亡/失败收尾，choices 留空数组 []。`;
    } else if (canClimax) {
        rule5 = `5. 当前目标好感度已达 ${maxFavor}（≥80），可以生成高潮圆满结局：isClimax=true，写一段高潮收尾，choices 留空数组 []；若你认为剧情仍有发展空间，也可继续推进（isClimax=false）并给出选项。`;
    } else {
        rule5 = "5. 当前正常推进剧情，isDeath=false、isClimax=false。";
    }

    const systemPrompt = [
        "你是番茄小说顶级作者，擅长写爆款攻略文，深谙爽点与虐点的节奏掌控。",
        "现在你为一款「攻略副本」文字游戏执笔下一个剧情节点，要像写爆款小说一样推进剧情：有悬念、有反转、有情绪拉扯。",
        "",
        "【副本设定】",
        `名称：${dungeon.name}`,
        `小说类型：${novelLabel}`,
        `画风：${THEME_LABELS[dungeon.theme]}`,
        `难度：${diffLabel}（死亡线：目标好感度 ≤ ${deathThreshold} 即死；好感度 ≥ 80 可触发高潮结局）`,
        "世界观：",
        dungeon.worldview || "（未提供）",
        "",
        "【NPC 阵容与当前好感度】",
        npcRoster || "（无 NPC）",
        "",
        "【当前进度】",
        `当前章节：第 ${dungeon.currentChapter} 章`,
        `已死亡次数：${dungeon.deathCount}`,
        `目标最低好感度：${minFavor}　最高：${maxFavor}`,
        "",
        "【上次剧情摘要】",
        lastSummary,
        "",
        "【玩家本次选择】",
        choiceText && choiceText.trim() ? choiceText.trim() : "（无，这是开局第一章）",
        "",
        playerGuidance && playerGuidance.trim()
            ? `【玩家对剧情方向的指导（请参考但不必完全遵从）】\n${playerGuidance.trim()}`
            : "",
        "生成要求：",
        "1. 根据玩家选择推进剧情：narration 写 100-300 字第三人称旁白（场景、心理、氛围）；dialogue 写 2-6 句对话，每句含 speaker（NPC 名）与 text，可带 emotion。",
        `2. choices 生成 2-4 个选项，每个含 text（选项内容）、hint（后果提示，如"勇气+5"或"风险：可能激怒对方"）、riskLevel、favorDelta（选择该选项预估的好感度变化，正负整数，如 12、-8、18）。风险分布：${riskGuide}`,
        "3. favorChanges 是本次剧情/玩家选择带来的好感度变化，键为 NPC 的 id（见上方阵容表），值为整数（正数加好感，负数减好感）。目标角色（男主）好感变化幅度通常较大。开局第一章且玩家无选择时，favorChanges 可为空对象 {}。",
        `4. 好感度变化会被难度系数 ${favorMod} 调整（正向收益 ×${favorMod}，负向不变）。`,
        rule5,
        "6. sceneTitle 取一个有小说感的场景标题（8-16 字）。chapter 填本节点所属章节号（通常等于当前章节；若本节点开启新章节，填 currentChapter+1）。",
        "7. 参考番茄小说的爽点（逆袭、打脸、甜宠）与虐点（误会、背叛、错过）节奏，让剧情有张力、有钩子，让人欲罢不能。",
        "8. scenePrompt 写一段 30-80 字的英文画面描述，用于 AI 生成场景背景图（landscape, anime style, no text, atmospheric lighting matching the scene mood）。",
        "",
        "严格返回如下 JSON（不要输出任何额外文字）：",
        "{",
        '  "sceneTitle": "场景标题",',
        '  "chapter": 1,',
        '  "narration": "旁白文本",',
        '  "dialogue": [',
        '    { "speaker": "NPC名", "text": "台词", "emotion": "冷淡/惊喜/..." }',
        "  ],",
        '  "choices": [',
        '    { "text": "选项", "hint": "后果提示", "riskLevel": "safe" | "risky" | "deadly", "favorDelta": 12 }',
        "  ],",
        '  "favorChanges": { "NPC的id": 5 },',
        '  "isDeath": false,',
        '  "isClimax": false,',
        '  "scenePrompt": "a cozy cafe by the sea, warm sunset light, anime style..."',
        "}",
    ].join("\n");

    const result = await simpleLLMCall(
        config,
        [
            { role: "system", content: systemPrompt },
            { role: "user", content: `请生成第 ${dungeon.currentChapter} 章的下一个剧情节点。` },
        ],
        { temperature: 0.9, max_tokens: 4000, signal: params.signal },
    );

    if (result.error) throw new Error(`AI 调用失败：${result.error}`);
    if (!result.content) throw new Error("AI 返回了空内容，请重试。");

    const parsed = parseJsonResponse(result.content);
    if (!parsed || typeof parsed !== "object") {
        if (result.wasTruncated) {
            throw new Error("AI 输出被截断（max_tokens 不足），请重试。");
        }
        throw new Error("AI 返回的剧情数据格式不正确，请重试。");
    }

    return buildStoryBeat(parsed, dungeon, isDeathTriggered, favorMod, playerGuidance);
}

/** 把 AI 返回的原始剧情对象归一化为 StoryBeat，并强制死亡/高潮判定与选项兜底。 */
function buildStoryBeat(
    parsed: any,
    dungeon: RaidDungeon,
    isDeathTriggered: boolean,
    favorMod: number,
    playerGuidance?: string,
): StoryBeat {
    const beatId = genId("beat");
    const now = new Date().toISOString();

    // chapter：clamp 到 [currentChapter, currentChapter+1]
    const cur = dungeon.currentChapter;
    let chapter = Number(parsed.chapter);
    if (!Number.isFinite(chapter)) chapter = cur;
    chapter = Math.max(cur, Math.min(cur + 1, Math.round(chapter)));

    const sceneTitle = String(parsed.sceneTitle || `第${chapter}章`).trim().slice(0, 40);
    const narration = String(parsed.narration || "").trim() || "（旁白缺失）";

    const dialogue: DialogueLine[] = Array.isArray(parsed.dialogue)
        ? parsed.dialogue
              .map((d: any): DialogueLine | null => {
                  if (!d || typeof d !== "object") return null;
                  const speaker = String(d.speaker || "").trim();
                  const text = String(d.text || "").trim();
                  if (!speaker || !text) return null;
                  const line: DialogueLine = { speaker, text };
                  if (d.emotion) line.emotion = String(d.emotion).trim();
                  return line;
              })
              .filter((d: DialogueLine | null): d is DialogueLine => d !== null)
        : [];

    // favorChanges：归一化 key，并应用难度系数（仅正向 ×favorMod，负向不变）
    const rawFavor = normalizeFavorChanges(parsed.favorChanges, dungeon.npcs);
    const favorChanges: Record<string, number> = {};
    for (const [id, delta] of Object.entries(rawFavor)) {
        const scaled = delta > 0 ? Math.round(delta * favorMod) : Math.round(delta);
        if (scaled !== 0) favorChanges[id] = scaled;
    }

    // 死亡 / 高潮：代码层强制判定，避免 AI 误判
    const isDeath = parsed.isDeath === true || isDeathTriggered;
    const isClimax = !isDeath && parsed.isClimax === true;

    // 死亡 / 高潮结局无选项；正常推进时构建选项并兜底至 2 个
    let choices: StoryChoice[] = [];
    if (!isDeath && !isClimax) {
        choices = buildChoices(parsed.choices, beatId);
        if (choices.length < 2) {
            const fallbacks: StoryChoice[] = [
                { id: `${beatId}_safe`, text: "谨慎应对", hint: "稳妥推进", riskLevel: "safe", favorDelta: 5 },
                { id: `${beatId}_risky`, text: "主动出击", hint: "可能改变局势", riskLevel: "risky", favorDelta: -3 },
            ];
            let fi = 0;
            while (choices.length < 2 && fi < fallbacks.length) {
                choices.push(fallbacks[fi]);
                fi++;
            }
        }
    }

    const scenePrompt = String(parsed.scenePrompt || "").trim() || undefined;

    return {
        id: beatId,
        chapter,
        sceneTitle,
        narration,
        dialogue,
        choices,
        favorChanges,
        isDeath,
        isClimax,
        createdAt: now,
        playerGuidance: playerGuidance?.trim() || undefined,
        scenePrompt,
    };
}

// ── 场景图 & 立绘生成 ─────────────────────────────────────

const THEME_IMAGE_STYLE: Record<RaidTheme, string> = {
    ancient: "traditional Chinese painting style, ink wash, muted gold and brown tones, historical aesthetic",
    modern: "modern anime art style, clean lines, contemporary setting, soft lighting",
    mono: "monochrome black and white manga style, high contrast, dramatic shading, no color",
    cyber: "cyberpunk neon aesthetic, dark backgrounds with glowing neon accents, futuristic",
    horror: "dark horror anime style, eerie atmosphere, muted desaturated colors, unsettling mood",
    cozy: "warm cozy anime style, soft pastel colors, gentle lighting, wholesome atmosphere",
};

/** 为剧情节点生成场景背景图。 */
export async function generateSceneImage(
    beat: StoryBeat,
    dungeon: RaidDungeon,
    signal?: AbortSignal,
): Promise<string | null> {
    const styleSuffix = THEME_IMAGE_STYLE[dungeon.theme] || "";
    const basePrompt = beat.scenePrompt
        ? beat.scenePrompt
        : `${beat.sceneTitle}, ${beat.narration.slice(0, 100)}`;
    const prompt = `${basePrompt}. ${styleSuffix}. landscape orientation, 9:16 aspect ratio, no text, no watermark, anime illustration`;
    try {
        const result = await generateImageFromConfiguredApi({
            description: prompt,
            signal,
        });
        return result?.dataUrl ?? null;
    } catch {
        return null;
    }
}

/** 生成立绘模式用的「人物+背景」融合图（一张图搞定）。
 *  根据当前说话角色 + 场景信息，生成一张人物为主体、背景为衬托的完整画面。
 *  支持参考图（用户上传或角色系统）。
 *  注意：不随画风(theme)变化，只随世界观和角色变化。
 *  参考图优先级：剧本级参考图 > NPC参考图 > 角色系统参考图 > 纯文本生图。
 */
export async function generatePortraitSceneImage(
    beat: StoryBeat,
    npc: DungeonNpc,
    dungeon: RaidDungeon,
    signal?: AbortSignal,
    referenceDataUrls?: string[],
): Promise<string | null> {
    // 不使用 THEME_IMAGE_STYLE，画面只随世界观和角色变化
    const sceneDesc = beat.scenePrompt
        ? beat.scenePrompt
        : `${beat.sceneTitle}, ${beat.narration.slice(0, 80)}`;
    const prompt = `Anime illustration, 9:16 vertical portrait composition. Character: ${npc.name}, ${npc.appearance}. ${npc.persona.slice(0, 60)}. Scene/setting: ${sceneDesc}. World setting: ${dungeon.worldview.slice(0, 80)}. The character is the main focal point, scene environment as background. Emotional mood: ${beat.dialogue[0]?.emotion || "neutral"}. High quality anime art style, no text, no watermark`;

    try {
        // 模式1: 剧本级画风参考图（用户在创建副本时上传）→ 最高优先级
        if (dungeon.styleReferenceImage) {
            const url = await generateWithReferenceImage(prompt, dungeon.styleReferenceImage, signal);
            if (url) return url;
        }

        // 模式2: NPC 的用户上传参考图
        if (referenceDataUrls && referenceDataUrls.length > 0) {
            const url = await generateWithReferenceImage(prompt, referenceDataUrls[0], signal);
            if (url) return url;
        }

        // 模式3: NPC 有 characterId → 用角色系统的参考图
        if (npc.characterId) {
            const result = await generateImageFromConfiguredApi({
                description: prompt,
                characterId: npc.characterId,
                useReferenceImage: true,
                signal,
            });
            if (result?.dataUrl) return result.dataUrl;
        }

        // 模式4: 纯文本生图
        const result = await generateImageFromConfiguredApi({
            description: prompt,
            signal,
        });
        return result?.dataUrl ?? null;
    } catch {
        return null;
    }
}

/** 为 NPC 生成立绘（standing portrait）。
 *  支持三种模式：
 *  1. 有 characterId + 有角色参考图配置 → 用 generateImageFromConfiguredApi 的 useReferenceImage
 *  2. 有用户上传的参考图（referenceDataUrls）→ 用第一张做 image edit
 *  3. 无参考图 → 纯文本生图
 */
export async function generateNpcPortrait(
    npc: DungeonNpc,
    dungeon: RaidDungeon,
    signal?: AbortSignal,
    referenceDataUrls?: string[],
): Promise<string | null> {
    const styleSuffix = THEME_IMAGE_STYLE[dungeon.theme] || "";
    const prompt = `Full body character portrait of ${npc.name}: ${npc.appearance}. ${npc.persona.slice(0, 100)}. ${styleSuffix}. anime style, standing pose, transparent or simple background, character illustration, no text, 9:16 aspect ratio`;
    try {
        // 模式1: 有用户上传的参考图 → 优先使用（用户明确选择）
        if (referenceDataUrls && referenceDataUrls.length > 0) {
            const url = await generateWithReferenceImage(prompt, referenceDataUrls[0], signal);
            if (url) return url;
        }

        // 模式2: NPC 有 characterId → 用角色系统的参考图
        if (npc.characterId) {
            const result = await generateImageFromConfiguredApi({
                description: prompt,
                characterId: npc.characterId,
                useReferenceImage: true,
                signal,
            });
            if (result?.dataUrl) return result.dataUrl;
        }

        // 模式3: 纯文本生图
        const result = await generateImageFromConfiguredApi({
            description: prompt,
            signal,
        });
        return result?.dataUrl ?? null;
    } catch {
        return null;
    }
}

/**
 * 用参考图调用图像 edit API 生成立绘。
 * 直接传入参考图 dataUrl，让 generateImageFromConfiguredApi 走 image edit 端点。
 */
async function generateWithReferenceImage(
    prompt: string,
    referenceDataUrl: string,
    signal?: AbortSignal,
): Promise<string | null> {
    try {
        const result = await generateImageFromConfiguredApi({
            description: prompt,
            referenceImageDataUrl: referenceDataUrl,
            signal,
        });
        return result?.dataUrl ?? null;
    } catch {
        return null;
    }
}

// ── AI 填充剧情指导 ───────────────────────────────────────

/** AI 自动生成剧情方向指导文本。 */
export async function aiFillGuidance(
    dungeon: RaidDungeon,
    currentBeat: StoryBeat | null,
    signal?: AbortSignal,
): Promise<string> {
    const config = getApiConfig();
    const lastSummary = currentBeat ? summarizeLastBeat({ ...dungeon, storyBeats: [currentBeat] }) : "（开局）";

    const systemPrompt = [
        "你是攻略副本玩家的策略助手。请根据当前剧情进展，用一句话给出下一步剧情方向的建议（玩家指导）。",
        "要求：简洁、有趣、符合当前世界观和角色关系，20-60 字。",
        "只输出指导文本，不要加引号或多余说明。",
        "",
        `世界观：${dungeon.worldview.slice(0, 200)}`,
        `当前章节：第${dungeon.currentChapter}章`,
        `上次剧情：${lastSummary}`,
    ].join("\n");

    const result = await simpleLLMCall(
        config,
        [
            { role: "system", content: systemPrompt },
            { role: "user", content: "请给出下一步剧情方向建议。" },
        ],
        { temperature: 0.8, max_tokens: 200, signal },
    );

    if (result.error) throw new Error(`AI 填充失败：${result.error}`);
    return (result.content || "").trim().slice(0, 200);
}
