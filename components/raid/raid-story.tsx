"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { RaidDungeon, StoryBeat, SaveSlot } from "./raid-types";
import {
    NPC_ROLE_LABELS,
    DIFFICULTY_LABELS,
    STORY_MODE_LABELS,
} from "./raid-types";
import {
    findDungeon,
    updateDungeon,
    appendStoryBeat,
    saveToSlot,
    loadFromSlot,
    deleteSaveSlot,
} from "./raid-storage";
import { generateStoryBeat } from "./raid-engine";

type RaidStoryProps = {
    dungeon: RaidDungeon;
    onBack: () => void;
    onNotice?: (msg: string) => void;
    onUpdate: () => void;
};

export function RaidStory({ dungeon: initialDungeon, onBack, onNotice, onUpdate }: RaidStoryProps) {
    const [dungeon, setDungeon] = useState<RaidDungeon>(initialDungeon);
    const [loading, setLoading] = useState(false);
    const [showSaves, setShowSaves] = useState(false);
    const [showBgm, setShowBgm] = useState(false);
    const [saveSlotName, setSaveSlotName] = useState("");
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const abortRef = useRef<AbortController | null>(null);

    // 同步外部更新
    useEffect(() => {
        const fresh = findDungeon(initialDungeon.id);
        if (fresh) setDungeon(fresh);
    }, [initialDungeon.id]);

    const currentBeat = dungeon.storyBeats.find((b) => b.id === dungeon.currentBeatId) || null;
    const isDead = dungeon.status === "failed";
    const isCleared = dungeon.status === "cleared";

    // 自动生成第一章
    const autoGenerate = useCallback(async () => {
        if (dungeon.storyBeats.length > 0 || loading || dungeon.status !== "setup") return;
        if (!dungeon.npcs.length) return;

        setLoading(true);
        const controller = new AbortController();
        abortRef.current = controller;

        try {
            const beat = await generateStoryBeat({
                dungeon,
                choiceText: undefined,
                signal: controller.signal,
            });
            const updated = appendStoryBeat(dungeon.id, beat);
            if (updated) setDungeon(updated);
            onUpdate();
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            onNotice?.(`生成失败：${msg}`);
        } finally {
            setLoading(false);
            abortRef.current = null;
        }
    }, [dungeon, loading, onUpdate, onNotice]);

    useEffect(() => {
        if (dungeon.status === "setup" && dungeon.npcs.length > 0 && !loading) {
            autoGenerate();
        }
    }, [autoGenerate, dungeon.status, dungeon.npcs.length, loading]);

    // 播放 BGM
    useEffect(() => {
        if (!dungeon.bgmUrl || !audioRef.current) return;
        audioRef.current.volume = 0.3;
        audioRef.current.play().catch(() => {});
    }, [dungeon.bgmUrl]);

    async function handleChoice(choiceText: string) {
        if (loading || isDead || isCleared) return;
        setLoading(true);
        const controller = new AbortController();
        abortRef.current = controller;

        try {
            const beat = await generateStoryBeat({
                dungeon,
                choiceText,
                signal: controller.signal,
            });
            const updated = appendStoryBeat(dungeon.id, beat);
            if (updated) {
                // 死亡计数
                if (beat.isDeath) {
                    updateDungeon(dungeon.id, {
                        deathCount: dungeon.deathCount + 1,
                    });
                }
                setDungeon(findDungeon(dungeon.id) || updated);
                onUpdate();
            }
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            onNotice?.(`生成失败：${msg}`);
        } finally {
            setLoading(false);
            abortRef.current = null;
        }
    }

    function handleSave() {
        const name = saveSlotName.trim() || `第${dungeon.currentChapter}章存档`;
        const slot = saveToSlot(dungeon.id, name);
        if (slot) {
            onNotice?.("存档成功");
            setSaveSlotName("");
            setShowSaves(false);
            const fresh = findDungeon(dungeon.id);
            if (fresh) setDungeon(fresh);
            onUpdate();
        }
    }

    function handleLoad(slotId: string) {
        const restored = loadFromSlot(dungeon.id, slotId);
        if (restored) {
            setDungeon(restored);
            onNotice?.("读档成功");
            onUpdate();
        }
    }

    function handleDeleteSave(slotId: string) {
        deleteSaveSlot(dungeon.id, slotId);
        const fresh = findDungeon(dungeon.id);
        if (fresh) setDungeon(fresh);
    }

    function handleRestart() {
        // 从头开始：清空剧情，重置状态
        const npcs = dungeon.npcs.map((n) => ({ ...n }));
        const favor: Record<string, number> = {};
        for (const n of npcs) favor[n.id] = n.initialFavor;
        const updated = updateDungeon(dungeon.id, {
            storyBeats: [],
            currentBeatId: null,
            currentChapter: 1,
            favor,
            status: "setup",
            deathCount: dungeon.deathCount,
        });
        if (updated) {
            setDungeon(updated);
            onUpdate();
        }
    }

    const targetNpcs = dungeon.npcs.filter((n) => n.isTarget);
    const otherNpcs = dungeon.npcs.filter((n) => !n.isTarget);

    return (
        <>
            <header className="raid-header">
                <button className="raid-back-btn" onClick={onBack}>←</button>
                <div className="raid-header-title">
                    <h1>{dungeon.name}</h1>
                    <span className="raid-header-sub">
                        第 {dungeon.currentChapter} 章 · {DIFFICULTY_LABELS[dungeon.difficulty]} · {STORY_MODE_LABELS[dungeon.mode]}
                    </span>
                </div>
                <button
                    className="raid-more-btn"
                    onClick={() => setShowSaves(!showSaves)}
                    title="存档"
                >
                    💾
                </button>
            </header>

            {/* BGM 播放器 */}
            {dungeon.bgmUrl && (
                <audio ref={audioRef} src={dungeon.bgmUrl} loop preload="auto" />
            )}

            {/* 好感度面板 */}
            <div className="raid-favor-panel">
                {targetNpcs.map((npc) => (
                    <FavorBar key={npc.id} npc={npc} favor={dungeon.favor[npc.id] ?? npc.initialFavor} />
                ))}
                {otherNpcs.length > 0 && (
                    <details className="raid-favor-others">
                        <summary>其他角色 ({otherNpcs.length})</summary>
                        {otherNpcs.map((npc) => (
                            <FavorBar key={npc.id} npc={npc} favor={dungeon.favor[npc.id] ?? npc.initialFavor} />
                        ))}
                    </details>
                )}
            </div>

            <main className="raid-body">
                {/* 存档面板 */}
                {showSaves && (
                    <div className="raid-save-panel">
                        <div className="raid-save-new">
                            <input
                                type="text"
                                className="raid-save-name-input"
                                placeholder="存档名称（可选）"
                                value={saveSlotName}
                                onChange={(e) => setSaveSlotName(e.target.value)}
                            />
                            <button className="raid-btn raid-btn--primary raid-btn-sm" onClick={handleSave}>
                                存档
                            </button>
                        </div>
                        <div className="raid-save-list">
                            {dungeon.saves.length === 0 ? (
                                <p className="raid-save-empty">暂无存档</p>
                            ) : (
                                dungeon.saves.map((slot) => (
                                    <SaveSlotRow
                                        key={slot.id}
                                        slot={slot}
                                        onLoad={() => handleLoad(slot.id)}
                                        onDelete={() => handleDeleteSave(slot.id)}
                                    />
                                ))
                            )}
                        </div>
                    </div>
                )}

                {/* 剧情内容 */}
                {loading && !currentBeat ? (
                    <div className="raid-story-loading">
                        <div className="raid-loading" />
                        <p>剧情生成中……</p>
                    </div>
                ) : currentBeat ? (
                    dungeon.mode === "novel" ? (
                        <NovelMode beat={currentBeat} dungeon={dungeon} />
                    ) : (
                        <PortraitMode beat={currentBeat} dungeon={dungeon} />
                    )
                ) : (
                    <div className="raid-story-loading">
                        <div className="raid-loading" />
                        <p>正在进入副本……</p>
                    </div>
                )}
            </main>

            {/* 选项区 */}
            {currentBeat && !isDead && !isCleared && (
                <div className="raid-story-choices">
                    {loading ? (
                        <div className="raid-choices-loading">
                            <div className="raid-loading raid-loading-sm" />
                            <span>生成中……</span>
                        </div>
                    ) : (
                        currentBeat.choices.map((choice) => (
                            <button
                                key={choice.id}
                                className={`raid-story-choice ${choice.riskLevel ? `raid-story-choice--${choice.riskLevel}` : ""}`}
                                onClick={() => handleChoice(choice.text)}
                            >
                                <span className="raid-choice-text">{choice.text}</span>
                                {choice.hint && (
                                    <span className="raid-choice-hint">{choice.hint}</span>
                                )}
                            </button>
                        ))
                    )}
                </div>
            )}

            {/* 死亡覆盖层 */}
            {isDead && (
                <div className="raid-death-screen">
                    <h2 className="raid-death-title">攻略失败</h2>
                    <p className="raid-death-desc">你在这个世界的故事到此终结……</p>
                    <div className="raid-death-actions">
                        <button className="raid-btn raid-btn--primary" onClick={handleRestart}>
                            重新开始
                        </button>
                        <button className="raid-btn raid-btn--ghost" onClick={onBack}>
                            返回
                        </button>
                    </div>
                </div>
            )}

            {/* 通关覆盖层 */}
            {isCleared && (
                <div className="raid-clear-screen">
                    <h2 className="raid-clear-title">攻略成功</h2>
                    <p className="raid-clear-desc">你征服了这个世界的所有挑战</p>
                    <div className="raid-clear-stats">
                        <span>耗时 {dungeon.storyBeats.length} 个场景</span>
                        <span>死亡 {dungeon.deathCount} 次</span>
                    </div>
                    <div className="raid-clear-actions">
                        <button className="raid-btn raid-btn--primary" onClick={handleRestart}>
                            再来一局
                        </button>
                        <button className="raid-btn raid-btn--ghost" onClick={onBack}>
                            返回
                        </button>
                    </div>
                </div>
            )}
        </>
    );
}

// ── 好感度条 ──
function FavorBar({ npc, favor }: { npc: { id: string; name: string; role: string }; favor: number }) {
    const pct = Math.max(0, Math.min(100, favor));
    const isLow = favor < 0;
    const displayFavor = Math.round(favor);

    return (
        <div className="raid-favor-bar">
            <div className="raid-favor-bar-header">
                <span className="raid-favor-name">{npc.name}</span>
                <span className="raid-favor-role">{NPC_ROLE_LABELS[npc.role as keyof typeof NPC_ROLE_LABELS] || "NPC"}</span>
                <span className={`raid-favor-value ${isLow ? "raid-favor-value--low" : ""}`}>
                    {displayFavor}
                </span>
            </div>
            <div className="raid-favor-bar-track">
                <div
                    className="raid-favor-bar-fill"
                    style={{ width: `${pct}%` }}
                />
            </div>
        </div>
    );
}

// ── 存档行 ──
function SaveSlotRow({
    slot,
    onLoad,
    onDelete,
}: {
    slot: SaveSlot;
    onLoad: () => void;
    onDelete: () => void;
}) {
    const date = new Date(slot.createdAt);
    return (
        <div className="raid-save-slot">
            <div className="raid-save-slot-info">
                <span className="raid-save-slot-name">{slot.slotName}</span>
                <span className="raid-save-slot-meta">
                    第{slot.chapter}章 · {slot.storyBeatsCount}个场景 · {date.toLocaleDateString()}
                </span>
            </div>
            <div className="raid-save-slot-actions">
                <button className="raid-btn raid-btn--ghost raid-btn-sm" onClick={onLoad}>读档</button>
                <button className="raid-btn raid-btn--danger raid-btn-sm" onClick={onDelete}>删</button>
            </div>
        </div>
    );
}

// ── 小说模式 ──
function NovelMode({ beat, dungeon }: { beat: StoryBeat; dungeon: RaidDungeon }) {
    return (
        <div className="raid-story-novel">
            <div className="raid-story-chapter">
                第 {beat.chapter} 章 · {beat.sceneTitle}
            </div>
            <div className="raid-story-narration">{beat.narration}</div>
            {beat.dialogue.length > 0 && (
                <div className="raid-story-dialogue">
                    {beat.dialogue.map((line, i) => (
                        <div key={i} className="raid-story-dialogue-item">
                            <span className="raid-story-speaker">{line.speaker}</span>
                            {line.emotion && <span className="raid-story-emotion">（{line.emotion}）</span>}
                            <span className="raid-story-text">{line.text}</span>
                        </div>
                    ))}
                </div>
            )}
            <div className="raid-story-worldview-hint">
                📖 {dungeon.worldview.slice(0, 60)}……
            </div>
        </div>
    );
}

// ── 立绘模式 ──
function PortraitMode({ beat, dungeon }: { beat: StoryBeat; dungeon: RaidDungeon }) {
    // 取对话中的角色或目标角色
    const speaker = beat.dialogue[0]?.speaker || dungeon.npcs[0]?.name || "???";
    const speakerNpc = dungeon.npcs.find((n) => n.name === speaker) || dungeon.npcs[0];
    const allDialogue = beat.dialogue.length > 0
        ? beat.dialogue
        : [{ speaker: "旁白", text: beat.narration }];

    return (
        <div className="raid-story-portrait">
            {/* 立绘舞台 */}
            <div className="raid-portrait-stage">
                {speakerNpc && (
                    <div className="raid-portrait-figure">
                        <div className="raid-portrait-avatar">
                            {speakerNpc.name.charAt(0)}
                        </div>
                        <div className="raid-portrait-name">{speakerNpc.name}</div>
                        <div className="raid-portrait-role">
                            {NPC_ROLE_LABELS[speakerNpc.role as keyof typeof NPC_ROLE_LABELS] || "NPC"}
                        </div>
                    </div>
                )}
            </div>

            {/* 章节标题 */}
            <div className="raid-portrait-chapter">
                第 {beat.chapter} 章 · {beat.sceneTitle}
            </div>

            {/* 旁白 */}
            {beat.narration && (
                <div className="raid-portrait-narration">{beat.narration}</div>
            )}

            {/* 对话框 */}
            <div className="raid-portrait-dialogue-box">
                {allDialogue.map((line, i) => (
                    <div key={i} className="raid-portrait-dialogue-line">
                        <span className="raid-portrait-dialogue-speaker">{line.speaker}</span>
                        {line.emotion && <em className="raid-portrait-emotion">{line.emotion}</em>}
                        <p className="raid-portrait-dialogue-text">{line.text}</p>
                    </div>
                ))}
            </div>
        </div>
    );
}
