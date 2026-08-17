import type { RaidDungeon, SaveSlot, StoryBeat } from "./raid-types";
import { kvGet, kvSet, registerKvMigration } from "@/lib/kv-db";

const STORAGE_KEY = "ai_phone_raid_dungeons_v1";
registerKvMigration(STORAGE_KEY);

// ── 内存缓存 ──────────────────────────────────────────
let _cache: RaidDungeon[] | null = null;

// ── 读取全部副本 ──────────────────────────────────────
export function loadDungeons(): RaidDungeon[] {
    if (_cache) return _cache;
    if (typeof window === "undefined") return [];
    try {
        const raw = kvGet(STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw) as unknown;
        if (!Array.isArray(parsed)) return [];
        _cache = parsed as RaidDungeon[];
        return _cache;
    } catch {
        return [];
    }
}

// ── 保存全部 ──────────────────────────────────────────
export function saveDungeons(dungeons: RaidDungeon[]): void {
    if (typeof window === "undefined") return;
    _cache = dungeons;
    kvSet(STORAGE_KEY, JSON.stringify(dungeons));
}

// ── 创建新副本 ──────────────────────────────────────────
export function createDungeon(
    partial: Omit<RaidDungeon, "id" | "createdAt" | "updatedAt" | "storyBeats" | "currentBeatId" | "currentChapter" | "status" | "saves" | "deathCount" | "favor"> & { favor?: Record<string, number> },
): RaidDungeon {
    const now = new Date().toISOString();
    const id = `raid_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const dungeon: RaidDungeon = {
        ...partial,
        id,
        storyBeats: [],
        currentBeatId: null,
        currentChapter: 1,
        status: "setup",
        saves: [],
        deathCount: 0,
        favor: partial.favor || {},
        createdAt: now,
        updatedAt: now,
    };
    const all = loadDungeons();
    all.push(dungeon);
    saveDungeons(all);
    return dungeon;
}

// ── 更新单个副本 ──────────────────────────────────────
export function updateDungeon(id: string, patch: Partial<RaidDungeon>): RaidDungeon | null {
    const all = loadDungeons();
    const idx = all.findIndex((d) => d.id === id);
    if (idx < 0) return null;
    all[idx] = { ...all[idx], ...patch, updatedAt: new Date().toISOString() };
    saveDungeons(all);
    return all[idx];
}

// ── 删除副本 ──────────────────────────────────────────
export function deleteDungeon(id: string): void {
    const all = loadDungeons().filter((d) => d.id !== id);
    saveDungeons(all);
}

// ── 按 ID 查找 ──────────────────────────────────────────
export function findDungeon(id: string): RaidDungeon | null {
    return loadDungeons().find((d) => d.id === id) || null;
}

// ── 存档：保存当前进度到存档槽 ──────────────────────
export function saveToSlot(dungeonId: string, slotName: string): SaveSlot | null {
    const dungeon = findDungeon(dungeonId);
    if (!dungeon) return null;
    const slot: SaveSlot = {
        id: `save_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        slotName,
        chapter: dungeon.currentChapter,
        beatId: dungeon.currentBeatId || "",
        favorSnapshot: { ...dungeon.favor },
        storyBeatsCount: dungeon.storyBeats.length,
        createdAt: new Date().toISOString(),
    };
    const saves = [...dungeon.saves, slot];
    updateDungeon(dungeonId, { saves });
    return slot;
}

// ── 存档：从存档槽恢复 ──────────────────────────────
export function loadFromSlot(dungeonId: string, slotId: string): RaidDungeon | null {
    const dungeon = findDungeon(dungeonId);
    if (!dungeon) return null;
    const slot = dungeon.saves.find((s) => s.id === slotId);
    if (!slot) return null;
    // 恢复好感度和章节位置（不删已生成的剧情，但跳回存档点）
    const restored = updateDungeon(dungeonId, {
        favor: { ...slot.favorSnapshot },
        currentChapter: slot.chapter,
        currentBeatId: slot.beatId,
        status: "playing",
    });
    return restored;
}

// ── 存档：删除存档槽 ──────────────────────────────
export function deleteSaveSlot(dungeonId: string, slotId: string): void {
    const dungeon = findDungeon(dungeonId);
    if (!dungeon) return;
    const saves = dungeon.saves.filter((s) => s.id !== slotId);
    updateDungeon(dungeonId, { saves });
}

// ── 追加剧情节点 ──────────────────────────────────────
export function appendStoryBeat(dungeonId: string, beat: StoryBeat): RaidDungeon | null {
    const dungeon = findDungeon(dungeonId);
    if (!dungeon) return null;
    const storyBeats = [...dungeon.storyBeats, beat];
    const favor = { ...dungeon.favor };
    for (const [npcId, delta] of Object.entries(beat.favorChanges)) {
        favor[npcId] = Math.max(-100, Math.min(100, (favor[npcId] || 0) + delta));
    }
    return updateDungeon(dungeonId, {
        storyBeats,
        currentBeatId: beat.id,
        currentChapter: beat.chapter,
        favor,
        status: beat.isDeath ? "failed" : beat.isClimax ? "cleared" : "playing",
    });
}
