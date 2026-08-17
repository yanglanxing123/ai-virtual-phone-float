"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { RaidDungeon, StoryBeat, SaveSlot, StoryChoice, DungeonNpc } from "./raid-types";
import {
    NPC_ROLE_LABELS,
    DIFFICULTY_LABELS,
    STORY_MODE_LABELS,
    THEME_LABELS,
} from "./raid-types";
import {
    findDungeon,
    updateDungeon,
    appendStoryBeat,
    saveToSlot,
    loadFromSlot,
    deleteSaveSlot,
} from "./raid-storage";
import {
    generateStoryBeat,
    generateSceneImage,
    generateNpcPortrait,
    aiFillGuidance,
} from "./raid-engine";
import { resolveVoiceConfig, synthesizeSpeech, playAudioBlob } from "@/lib/tts-service";
import type { ContentAppId } from "@/lib/settings-types";

const RAID_APP_ID = "raid" as ContentAppId;

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
    const [saveSlotName, setSaveSlotName] = useState("");
    const [showEditPanel, setShowEditPanel] = useState(true);
    const [guidance, setGuidance] = useState("");
    const [editingChoiceId, setEditingChoiceId] = useState<string | null>(null);
    const [editingChoiceText, setEditingChoiceText] = useState("");
    const [fillingGuidance, setFillingGuidance] = useState(false);
    const [portraitMgrNpcId, setPortraitMgrNpcId] = useState<string | null>(null);
    const [portraitGenerating, setPortraitGenerating] = useState(false);
    const [voiceEnabled, setVoiceEnabled] = useState(true);
    const [voicePlaying, setVoicePlaying] = useState(false);
    const [portraitLoading, setPortraitLoading] = useState(false);
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const abortRef = useRef<AbortController | null>(null);
    const voiceAbortRef = useRef<AbortController | null>(null);
    const playedBeatRef = useRef<Set<string>>(new Set());
    const scrollRef = useRef<HTMLDivElement | null>(null);

    // 同步外部更新
    useEffect(() => {
        const fresh = findDungeon(initialDungeon.id);
        if (fresh) setDungeon(fresh);
    }, [initialDungeon.id]);

    const currentBeat = dungeon.storyBeats.find((b) => b.id === dungeon.currentBeatId) || null;
    const isDead = dungeon.status === "failed";
    const isCleared = dungeon.status === "cleared";

    // 自动滚动到底部
    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [dungeon.storyBeats, loading]);

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

    // 自动播放语音
    useEffect(() => {
        if (!voiceEnabled || !currentBeat || loading) return;
        if (playedBeatRef.current.has(currentBeat.id)) return;
        playedBeatRef.current.add(currentBeat.id);

        const playVoice = async () => {
            for (const line of currentBeat.dialogue) {
                const npc = dungeon.npcs.find((n) => n.name === line.speaker);
                if (!npc?.characterId) continue;
                const voiceConfig = resolveVoiceConfig(npc.characterId, RAID_APP_ID);
                if (!voiceConfig) continue;
                try {
                    setVoicePlaying(true);
                    const blob = await synthesizeSpeech(line.text, voiceConfig, {
                        emotion: line.emotion || undefined,
                    });
                    if (blob) {
                        const player = playAudioBlob(blob);
                        await player.promise;
                    }
                } catch {
                    // 语音失败不中断剧情
                } finally {
                    setVoicePlaying(false);
                }
            }
        };
        playVoice();
    }, [currentBeat, voiceEnabled, loading, dungeon.npcs]);

    // 立绘模式：自动生成场景图
    useEffect(() => {
        if (dungeon.mode !== "portrait" || !currentBeat || loading) return;
        if (currentBeat.sceneImageUrl) return;
        if (portraitLoading) return;

        const generateScene = async () => {
            setPortraitLoading(true);
            try {
                const controller = new AbortController();
                const url = await generateSceneImage(currentBeat, dungeon, controller.signal);
                if (url) {
                    const updated = updateDungeon(dungeon.id, {});
                    // 更新 beat 的 sceneImageUrl
                    const beats = dungeon.storyBeats.map((b) =>
                        b.id === currentBeat.id ? { ...b, sceneImageUrl: url } : b,
                    );
                    updateDungeon(dungeon.id, { storyBeats: beats });
                    const fresh = findDungeon(dungeon.id);
                    if (fresh) setDungeon(fresh);
                }
            } catch {
                // 静默失败
            } finally {
                setPortraitLoading(false);
            }
        };
        generateScene();
    }, [currentBeat, dungeon, loading, portraitLoading]);

    // 立绘模式：自动生成 NPC 立绘（仅当该 NPC 没有任何立绘时）
    useEffect(() => {
        if (dungeon.mode !== "portrait" || !currentBeat || loading) return;
        const speaker = currentBeat.dialogue[0]?.speaker;
        if (!speaker) return;
        const npc = dungeon.npcs.find((n) => n.name === speaker);
        if (!npc) return;
        // 已有立绘就不自动生成
        if (npc.portraits && npc.portraits.length > 0) return;

        const generatePortrait = async () => {
            try {
                const url = await generateNpcPortrait(npc, dungeon, undefined, npc.referenceImages);
                if (url) {
                    const npcs = dungeon.npcs.map(n =>
                        n.id === npc.id ? { ...n, portraits: [...(n.portraits || []), url] } : n,
                    );
                    updateDungeon(dungeon.id, { npcs });
                    const fresh = findDungeon(dungeon.id);
                    if (fresh) setDungeon(fresh);
                }
            } catch {
                // 静默失败
            }
        };
        generatePortrait();
    }, [currentBeat, dungeon, loading]);

    async function handleChoice(choiceText: string, guidanceText?: string) {
        if (loading || isDead || isCleared) return;
        setLoading(true);
        const controller = new AbortController();
        abortRef.current = controller;

        try {
            const beat = await generateStoryBeat({
                dungeon,
                choiceText,
                playerGuidance: guidanceText || undefined,
                signal: controller.signal,
            });
            const updated = appendStoryBeat(dungeon.id, beat);
            if (updated) {
                if (beat.isDeath) {
                    updateDungeon(dungeon.id, { deathCount: dungeon.deathCount + 1 });
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
            setGuidance("");
            setEditingChoiceId(null);
        }
    }

    async function handleAiFill() {
        if (fillingGuidance) return;
        setFillingGuidance(true);
        const controller = new AbortController();
        try {
            const text = await aiFillGuidance(dungeon, currentBeat, controller.signal);
            setGuidance(text);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            onNotice?.(`AI 填充失败：${msg}`);
        } finally {
            setFillingGuidance(false);
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
            playedBeatRef.current.clear();
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
        const npcs = dungeon.npcs.map((n) => ({ ...n }));
        const favor: Record<string, number> = {};
        for (const n of npcs) favor[n.id] = n.initialFavor;
        playedBeatRef.current.clear();
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

    // ── 立绘管理 ──
    function handleUploadPortraits(npcId: string, files: FileList) {
        const npc = dungeon.npcs.find((n) => n.id === npcId);
        if (!npc) return;
        const promises = Array.from(files).map(f => {
            return new Promise<string>((resolve) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result as string);
                reader.readAsDataURL(f);
            });
        });
        Promise.all(promises).then(dataUrls => {
            const portraits = [...(npc.portraits || []), ...dataUrls];
            const npcs = dungeon.npcs.map(n => n.id === npcId ? { ...n, portraits } : n);
            updateDungeon(dungeon.id, { npcs });
            const fresh = findDungeon(dungeon.id);
            if (fresh) setDungeon(fresh);
            onNotice?.(`已添加 ${dataUrls.length} 张立绘`);
        });
    }

    function handleUploadReferences(npcId: string, files: FileList) {
        const npc = dungeon.npcs.find((n) => n.id === npcId);
        if (!npc) return;
        const promises = Array.from(files).map(f => {
            return new Promise<string>((resolve) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result as string);
                reader.readAsDataURL(f);
            });
        });
        Promise.all(promises).then(dataUrls => {
            const referenceImages = [...(npc.referenceImages || []), ...dataUrls];
            const npcs = dungeon.npcs.map(n => n.id === npcId ? { ...n, referenceImages } : n);
            updateDungeon(dungeon.id, { npcs });
            const fresh = findDungeon(dungeon.id);
            if (fresh) setDungeon(fresh);
            onNotice?.(`已添加 ${dataUrls.length} 张参考图`);
        });
    }

    function handleDeletePortrait(npcId: string, index: number) {
        const npc = dungeon.npcs.find((n) => n.id === npcId);
        if (!npc?.portraits) return;
        const portraits = npc.portraits.filter((_, i) => i !== index);
        const npcs = dungeon.npcs.map(n => n.id === npcId ? { ...n, portraits } : n);
        updateDungeon(dungeon.id, { npcs });
        const fresh = findDungeon(dungeon.id);
        if (fresh) setDungeon(fresh);
    }

    function handleDeleteReference(npcId: string, index: number) {
        const npc = dungeon.npcs.find((n) => n.id === npcId);
        if (!npc?.referenceImages) return;
        const referenceImages = npc.referenceImages.filter((_, i) => i !== index);
        const npcs = dungeon.npcs.map(n => n.id === npcId ? { ...n, referenceImages } : n);
        updateDungeon(dungeon.id, { npcs });
        const fresh = findDungeon(dungeon.id);
        if (fresh) setDungeon(fresh);
    }

    async function handleGeneratePortrait(npcId: string) {
        const npc = dungeon.npcs.find((n) => n.id === npcId);
        if (!npc) return;
        setPortraitGenerating(true);
        try {
            const url = await generateNpcPortrait(npc, dungeon, undefined, npc.referenceImages);
            if (url) {
                const portraits = [...(npc.portraits || []), url];
                const npcs = dungeon.npcs.map(n => n.id === npcId ? { ...n, portraits } : n);
                updateDungeon(dungeon.id, { npcs });
                const fresh = findDungeon(dungeon.id);
                if (fresh) setDungeon(fresh);
                onNotice?.("立绘生成成功");
            } else {
                onNotice?.("立绘生成失败，请检查图像 API 配置");
            }
        } catch {
            onNotice?.("立绘生成失败");
        } finally {
            setPortraitGenerating(false);
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
                        第 {dungeon.currentChapter} 章 · {DIFFICULTY_LABELS[dungeon.difficulty]}
                    </span>
                </div>
                <div className="raid-header-actions">
                    <button
                        className={`raid-icon-btn ${voiceEnabled ? "raid-icon-btn--active" : ""}`}
                        onClick={() => setVoiceEnabled(!voiceEnabled)}
                        title={voiceEnabled ? "语音已开启" : "语音已关闭"}
                    >
                        {voiceEnabled ? "🔊" : "🔇"}
                    </button>
                    <button
                        className="raid-icon-btn"
                        onClick={() => setShowSaves(!showSaves)}
                        title="存档"
                    >
                        💾
                    </button>
                </div>
            </header>

            {/* 好感度面板 */}
            <div className="raid-favor-panel raid-favor-panel--compact">
                {targetNpcs.map((npc) => (
                    <FavorChip
                        key={npc.id}
                        npc={npc}
                        favor={dungeon.favor[npc.id] ?? npc.initialFavor}
                    />
                ))}
                {otherNpcs.length > 0 && (
                    <details className="raid-favor-others">
                        <summary>其他 ({otherNpcs.length})</summary>
                        {otherNpcs.map((npc) => (
                            <FavorChip
                                key={npc.id}
                                npc={npc}
                                favor={dungeon.favor[npc.id] ?? npc.initialFavor}
                            />
                        ))}
                    </details>
                )}
            </div>

            {dungeon.bgmUrl && <audio ref={audioRef} src={dungeon.bgmUrl} loop preload="auto" />}

            {/* BGM 播放器 */}
            {dungeon.bgmUrl && (
                <div className="raid-bgm-bar">
                    <span>🎵 {dungeon.bgmName || "BGM"}</span>
                </div>
            )}

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

            {/* 语音播放指示 */}
            {voicePlaying && (
                <div className="raid-voice-indicator">
                    <div className="raid-loading raid-loading-sm" />
                    <span>语音播放中…</span>
                </div>
            )}

            {/* 立绘管理弹窗 */}
            <PortraitManager
                npc={dungeon.npcs.find((n) => n.id === portraitMgrNpcId) || null}
                dungeon={dungeon}
                generating={portraitGenerating}
                onUploadPortraits={handleUploadPortraits}
                onUploadReferences={handleUploadReferences}
                onDeletePortrait={handleDeletePortrait}
                onDeleteReference={handleDeleteReference}
                onGenerate={handleGeneratePortrait}
                onClose={() => setPortraitMgrNpcId(null)}
            />

            {/* 主体内容 */}
            {dungeon.mode === "portrait" && currentBeat ? (
                <PortraitMode
                    beat={currentBeat}
                    dungeon={dungeon}
                    loading={loading}
                    portraitLoading={portraitLoading}
                    onChoice={handleChoice}
                    guidance={guidance}
                    onGuidanceChange={setGuidance}
                    onAiFill={handleAiFill}
                    fillingGuidance={fillingGuidance}
                    showEditPanel={showEditPanel}
                    onToggleEditPanel={() => setShowEditPanel(!showEditPanel)}
                    editingChoiceId={editingChoiceId}
                    onEditChoice={(id, text) => { setEditingChoiceId(id); setEditingChoiceText(text); }}
                    onEditingChoiceTextChange={setEditingChoiceText}
                    onConfirmEdit={() => {
                        if (editingChoiceId && currentBeat) {
                            const beats = dungeon.storyBeats.map((b) =>
                                b.id === currentBeat.id
                                    ? { ...b, choices: b.choices.map((c) =>
                                        c.id === editingChoiceId ? { ...c, text: editingChoiceText } : c,
                                    ) } : b,
                            );
                            updateDungeon(dungeon.id, { storyBeats: beats });
                            const fresh = findDungeon(dungeon.id);
                            if (fresh) setDungeon(fresh);
                        }
                        setEditingChoiceId(null);
                    }}
                    onCancelEdit={() => setEditingChoiceId(null)}
                    isDead={isDead}
                    isCleared={isCleared}
                    onOpenPortraitMgr={(npcId) => setPortraitMgrNpcId(npcId)}
                />
            ) : (
                <>
                    <main className="raid-body raid-body--chat" ref={scrollRef}>
                        {loading && !currentBeat ? (
                            <div className="raid-story-loading">
                                <div className="raid-loading" />
                                <p>剧情生成中……</p>
                            </div>
                        ) : (
                            <NovelChatLog dungeon={dungeon} />
                        )}
                    </main>

                    {/* 选项 + 编辑面板 */}
                    {currentBeat && !isDead && !isCleared && (
                        <ChoicePanel
                            beat={currentBeat}
                            loading={loading}
                            guidance={guidance}
                            onGuidanceChange={setGuidance}
                            onAiFill={handleAiFill}
                            fillingGuidance={fillingGuidance}
                            showEditPanel={showEditPanel}
                            onToggleEditPanel={() => setShowEditPanel(!showEditPanel)}
                            editingChoiceId={editingChoiceId}
                            onEditChoice={(id, text) => { setEditingChoiceId(id); setEditingChoiceText(text); }}
                            editingChoiceText={editingChoiceText}
                            onEditingChoiceTextChange={setEditingChoiceText}
                            onConfirmEdit={() => {
                                if (editingChoiceId && currentBeat) {
                                    const beats = dungeon.storyBeats.map((b) =>
                                        b.id === currentBeat.id
                                            ? { ...b, choices: b.choices.map((c) =>
                                                c.id === editingChoiceId ? { ...c, text: editingChoiceText } : c,
                                            ) } : b,
                                    );
                                    updateDungeon(dungeon.id, { storyBeats: beats });
                                    const fresh = findDungeon(dungeon.id);
                                    if (fresh) setDungeon(fresh);
                                }
                                setEditingChoiceId(null);
                            }}
                            onCancelEdit={() => setEditingChoiceId(null)}
                            onChoice={(text) => handleChoice(text, guidance)}
                        />
                    )}
                </>
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

// ── 好感度小芯片 ──
function FavorChip({ npc, favor }: { npc: DungeonNpc; favor: number }) {
    const isLow = favor < 0;
    return (
        <div className={`raid-favor-chip ${isLow ? "raid-favor-chip--low" : ""}`}>
            <span className="raid-favor-chip-name">{npc.name}</span>
            <span className="raid-favor-chip-value">{Math.round(favor)}</span>
        </div>
    );
}

// ── 存档行 ──
function SaveSlotRow({ slot, onLoad, onDelete }: { slot: SaveSlot; onLoad: () => void; onDelete: () => void }) {
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

// ── 立绘管理弹窗 ──
type PortraitManagerProps = {
    npc: DungeonNpc | null;
    dungeon: RaidDungeon;
    generating: boolean;
    onUploadPortraits: (npcId: string, files: FileList) => void;
    onUploadReferences: (npcId: string, files: FileList) => void;
    onDeletePortrait: (npcId: string, index: number) => void;
    onDeleteReference: (npcId: string, index: number) => void;
    onGenerate: (npcId: string) => void;
    onClose: () => void;
};

function PortraitManager(props: PortraitManagerProps) {
    const {
        npc, dungeon, generating,
        onUploadPortraits, onUploadReferences,
        onDeletePortrait, onDeleteReference,
        onGenerate, onClose,
    } = props;

    if (!npc) return null;
    const portraits = npc.portraits || [];
    const references = npc.referenceImages || [];

    return (
        <div className="raid-portrait-mgr-overlay" onClick={onClose}>
            <div className="raid-portrait-mgr-panel" onClick={(e) => e.stopPropagation()}>
                {/* 头部 */}
                <div className="raid-portrait-mgr-header">
                    <h3>{npc.name} · 立绘管理</h3>
                    <button className="raid-portrait-mgr-close" onClick={onClose}>✕</button>
                </div>

                {/* 当前立绘 */}
                <div className="raid-portrait-mgr-section">
                    <div className="raid-portrait-mgr-section-title">
                        立绘（{portraits.length}）
                    </div>
                    <div className="raid-portrait-mgr-grid">
                        {portraits.map((url, i) => (
                            <div key={i} className="raid-portrait-mgr-thumb">
                                <img src={url} alt={`立绘 ${i + 1}`} />
                                <button
                                    className="raid-portrait-mgr-del"
                                    onClick={() => onDeletePortrait(npc.id, i)}
                                >✕</button>
                            </div>
                        ))}
                        <label className="raid-portrait-mgr-upload">
                            <span>＋ 上传立绘</span>
                            <input
                                type="file"
                                accept="image/*"
                                multiple
                                onChange={(e) => e.target.files && onUploadPortraits(npc.id, e.target.files)}
                                style={{ display: "none" }}
                            />
                        </label>
                    </div>
                </div>

                {/* 参考图 */}
                <div className="raid-portrait-mgr-section">
                    <div className="raid-portrait-mgr-section-title">
                        参考图（{references.length}）
                    </div>
                    <div className="raid-portrait-mgr-grid raid-portrait-mgr-grid--ref">
                        {references.map((url, i) => (
                            <div key={i} className="raid-portrait-mgr-thumb raid-portrait-mgr-thumb--ref">
                                <img src={url} alt={`参考 ${i + 1}`} />
                                <button
                                    className="raid-portrait-mgr-del"
                                    onClick={() => onDeleteReference(npc.id, i)}
                                >✕</button>
                            </div>
                        ))}
                        <label className="raid-portrait-mgr-upload raid-portrait-mgr-upload--ref">
                            <span>＋ 上传参考图</span>
                            <input
                                type="file"
                                accept="image/*"
                                multiple
                                onChange={(e) => e.target.files && onUploadReferences(npc.id, e.target.files)}
                                style={{ display: "none" }}
                            />
                        </label>
                    </div>
                </div>

                {/* AI 生成 */}
                <div className="raid-portrait-mgr-section">
                    <button
                        className="raid-btn raid-btn--primary raid-btn-sm raid-portrait-mgr-gen"
                        onClick={() => onGenerate(npc.id)}
                        disabled={generating}
                    >
                        {generating ? (
                            <><div className="raid-loading raid-loading-sm" /> <span>生成中…</span></>
                        ) : (
                            <>🎨 AI 生成立绘</>
                        )}
                    </button>
                    {references.length > 0 && (
                        <p className="raid-portrait-mgr-hint">
                            将使用第一张参考图辅助生成（共 {references.length} 张）
                        </p>
                    )}
                    {npc.characterId && references.length === 0 && (
                        <p className="raid-portrait-mgr-hint">
                            该角色已绑定小手机角色，将使用角色参考图
                        </p>
                    )}
                </div>
            </div>
        </div>
    );
}
// ── 工具：把旁白按句子拆分 ──
function splitSentences(text: string): string[] {
    if (!text) return [];
    // 按中文句号、感叹号、问号拆分，保留标点
    const parts = text.split(/(?<=[。！？\n])/).map(s => s.trim()).filter(Boolean);
    // 合并过短的片段（<6字）到前一句
    const merged: string[] = [];
    for (const p of parts) {
        if (merged.length > 0 && p.length < 6) {
            merged[merged.length - 1] += p;
        } else {
            merged.push(p);
        }
    }
    return merged;
}

// ── 小说模式：聊天式日志 ──
function NovelChatLog({ dungeon }: { dungeon: RaidDungeon }) {
    return (
        <div className="raid-chat-log">
            {dungeon.storyBeats.map((beat, idx) => {
                const prevBeat = idx > 0 ? dungeon.storyBeats[idx - 1] : null;
                // 玩家选择消息：用上一次的选择文本
                const playerChoice = beat.playerGuidance || prevBeat?.choices[0]?.text || undefined;
                const narrationParts = splitSentences(beat.narration);

                return (
                    <div key={beat.id} className="raid-chat-turn">
                        {/* 玩家选择气泡 */}
                        {playerChoice && (
                            <div className="raid-chat-bubble raid-chat-bubble--player">
                                <span className="raid-chat-bubble-icon">💕</span>
                                <span className="raid-chat-bubble-text">{playerChoice}</span>
                            </div>
                        )}

                        {/* 章节标记（仅第一章或有新章节时显示） */}
                        {(idx === 0 || (prevBeat && prevBeat.chapter !== beat.chapter)) && (
                            <div className="raid-chat-chapter-divider">
                                <span>第 {beat.chapter} 章 · {beat.sceneTitle}</span>
                            </div>
                        )}

                        {/* 旁白：每句一条独立消息 */}
                        {narrationParts.map((part, i) => (
                            <div key={`n-${i}`} className="raid-chat-bubble raid-chat-bubble--narration">
                                {part}
                            </div>
                        ))}

                        {/* 对话：每句独立气泡，可单独触发语音 */}
                        {beat.dialogue.map((line, i) => {
                            const npc = dungeon.npcs.find((n) => n.name === line.speaker);
                            const isTarget = npc?.isTarget;
                            return (
                                <div
                                    key={`d-${i}`}
                                    className={`raid-chat-bubble raid-chat-bubble--dialogue ${isTarget ? "raid-chat-bubble--target" : ""}`}
                                >
                                    <span className="raid-chat-speaker">{line.speaker}</span>
                                    {line.emotion && <span className="raid-chat-emotion">（{line.emotion}）</span>}
                                    <span className="raid-chat-dialogue-text">{line.text}</span>
                                </div>
                            );
                        })}

                        {/* 好感度变化（选完后显示结果） */}
                        {Object.keys(beat.favorChanges).length > 0 && (
                            <div className="raid-chat-favor-result">
                                {Object.entries(beat.favorChanges).map(([npcId, delta]) => {
                                    const npc = dungeon.npcs.find((n) => n.id === npcId);
                                    return (
                                        <span
                                            key={npcId}
                                            className={`raid-favor-delta ${delta > 0 ? "raid-favor-delta--up" : "raid-favor-delta--down"}`}
                                        >
                                            {npc?.name ?? "???"} {delta > 0 ? "+" : ""}{delta}
                                        </span>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
}

// ── 选项面板（小说模式） ──
type ChoicePanelProps = {
    beat: StoryBeat;
    loading: boolean;
    guidance: string;
    onGuidanceChange: (v: string) => void;
    onAiFill: () => void;
    fillingGuidance: boolean;
    showEditPanel: boolean;
    onToggleEditPanel: () => void;
    editingChoiceId: string | null;
    onEditChoice: (id: string, text: string) => void;
    editingChoiceText: string;
    onEditingChoiceTextChange: (v: string) => void;
    onConfirmEdit: () => void;
    onCancelEdit: () => void;
    onChoice: (text: string) => void;
};

function ChoicePanel(props: ChoicePanelProps) {
    const {
        beat, loading, guidance, onGuidanceChange, onAiFill, fillingGuidance,
        showEditPanel, onToggleEditPanel, editingChoiceId, onEditChoice,
        editingChoiceText, onEditingChoiceTextChange, onConfirmEdit, onCancelEdit, onChoice,
    } = props;

    return (
        <div className="raid-choice-panel">
            {/* 选项列表 */}
            <div className="raid-choice-list">
                {loading ? (
                    <div className="raid-choices-loading">
                        <div className="raid-loading raid-loading-sm" />
                        <span>生成中……</span>
                    </div>
                ) : (
                    beat.choices.map((choice) => (
                        <div key={choice.id} className="raid-choice-item">
                            {editingChoiceId === choice.id ? (
                                <div className="raid-choice-edit">
                                    <textarea
                                        className="raid-choice-edit-input"
                                        value={editingChoiceText}
                                        onChange={(e) => onEditingChoiceTextChange(e.target.value)}
                                        rows={2}
                                    />
                                    <div className="raid-choice-edit-actions">
                                        <button className="raid-btn raid-btn--ghost raid-btn-sm" onClick={onCancelEdit}>取消</button>
                                        <button className="raid-btn raid-btn--primary raid-btn-sm" onClick={onConfirmEdit}>确定</button>
                                    </div>
                                </div>
                            ) : (
                                <button
                                    className={`raid-choice-btn raid-choice-btn--compact ${choice.riskLevel ? `raid-choice-btn--${choice.riskLevel}` : ""}`}
                                    onClick={() => onChoice(choice.text)}
                                >
                                    <span className="raid-choice-text">{choice.text}</span>
                                    <div className="raid-choice-meta">
                                        <button
                                            className="raid-choice-edit-icon"
                                            onClick={(e) => { e.stopPropagation(); onEditChoice(choice.id, choice.text); }}
                                            title="编辑选项"
                                        >
                                            ✏️
                                        </button>
                                    </div>
                                </button>
                            )}
                        </div>
                    ))
                )}
            </div>

            {/* 编辑面板 */}
            <div className="raid-edit-panel-toggle">
                <button className="raid-edit-panel-toggle-btn" onClick={onToggleEditPanel}>
                    {showEditPanel ? "▼" : "▶"} 收起编辑面板
                </button>
            </div>
            {showEditPanel && (
                <div className="raid-edit-panel">
                    <textarea
                        className="raid-guidance-input"
                        placeholder="接下来对GM的剧情方向指导（选填）"
                        value={guidance}
                        onChange={(e) => onGuidanceChange(e.target.value)}
                        rows={2}
                    />
                    <div className="raid-edit-panel-actions">
                        <button
                            className="raid-btn raid-btn--ghost raid-btn-sm"
                            onClick={onAiFill}
                            disabled={fillingGuidance}
                        >
                            {fillingGuidance ? (
                                <>
                                    <span className="raid-loading raid-loading-sm" /> 填充中…
                                </>
                            ) : (
                                "🤖 AI 一键填入"
                            )}
                        </button>
                        <button
                            className="raid-btn raid-btn--primary"
                            onClick={() => onChoice(beat.choices[0]?.text || "")}
                            disabled={loading}
                        >
                            提交本回合
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}

// ── 立绘模式（9:16 竖屏） ──
type PortraitModeProps = {
    beat: StoryBeat;
    dungeon: RaidDungeon;
    loading: boolean;
    portraitLoading: boolean;
    onChoice: (text: string, guidance?: string) => void;
    guidance: string;
    onGuidanceChange: (v: string) => void;
    onAiFill: () => void;
    fillingGuidance: boolean;
    showEditPanel: boolean;
    onToggleEditPanel: () => void;
    editingChoiceId: string | null;
    onEditChoice: (id: string, text: string) => void;
    onEditingChoiceTextChange: (v: string) => void;
    onConfirmEdit: () => void;
    onCancelEdit: () => void;
    isDead: boolean;
    isCleared: boolean;
    onOpenPortraitMgr: (npcId: string) => void;
};

function PortraitMode(props: PortraitModeProps) {
    const {
        beat, dungeon, loading, portraitLoading, onChoice,
        guidance, onGuidanceChange, onAiFill, fillingGuidance,
        showEditPanel, onToggleEditPanel, editingChoiceId, onEditChoice,
        onEditingChoiceTextChange, onConfirmEdit, onCancelEdit,
        isDead, isCleared, onOpenPortraitMgr,
    } = props;

    const [portraitIdx, setPortraitIdx] = useState(0);

    const speaker = beat.dialogue[0]?.speaker || dungeon.npcs[0]?.name || "???";
    const speakerNpc = dungeon.npcs.find((n) => n.name === speaker) || dungeon.npcs[0];
    const portraits = speakerNpc?.portraits || [];
    // 确保索引不越界
    const safeIdx = portraits.length > 0 ? portraitIdx % portraits.length : 0;
    const portraitUrl = portraits[safeIdx];
    const sceneUrl = beat.sceneImageUrl;

    const allDialogue = beat.dialogue.length > 0
        ? beat.dialogue
        : [{ speaker: "旁白", text: beat.narration }];

    // 点击立绘切换到下一张
    function handlePortraitClick() {
        if (portraits.length > 1) {
            setPortraitIdx((safeIdx + 1) % portraits.length);
        }
    }

    return (
        <div className="raid-portrait-fullscreen">
            {/* 场景背景 */}
            <div className="raid-portrait-bg">
                {sceneUrl ? (
                    <img src={sceneUrl} alt="场景" className="raid-portrait-bg-img" />
                ) : (
                    <div className={`raid-portrait-bg-placeholder raid-theme-${dungeon.theme}`}>
                        {portraitLoading && (
                            <div className="raid-portrait-gen-loading">
                                <div className="raid-loading" />
                                <span>生成场景中…</span>
                            </div>
                        )}
                    </div>
                )}
                {/* 渐变遮罩 */}
                <div className="raid-portrait-gradient" />
            </div>

            {/* 角色立绘 */}
            {portraitUrl && speakerNpc && (
                <div
                    className="raid-portrait-figure-full"
                    onClick={handlePortraitClick}
                    style={portraits.length > 1 ? { cursor: "pointer" } : undefined}
                >
                    <img src={portraitUrl} alt={speakerNpc.name} className="raid-portrait-figure-img" />
                    {portraits.length > 1 && (
                        <div className="raid-portrait-counter">
                            {safeIdx + 1} / {portraits.length}
                        </div>
                    )}
                </div>
            )}
            {!portraitUrl && speakerNpc && (
                <div className="raid-portrait-figure-placeholder" onClick={() => onOpenPortraitMgr(speakerNpc.id)}>
                    <div className="raid-portrait-avatar-lg">
                        {speakerNpc.name.charAt(0)}
                    </div>
                    <span className="raid-portrait-add-hint">点击管理立绘</span>
                </div>
            )}

            {/* 立绘管理按钮 */}
            {portraitUrl && speakerNpc && (
                <button className="raid-portrait-mgr-btn" onClick={() => onOpenPortraitMgr(speakerNpc.id)}>
                    🖼️
                </button>
            )}

            {/* 章节标记 */}
            <div className="raid-portrait-chapter-tag">
                第 {beat.chapter} 章 · {beat.sceneTitle}
            </div>

            {/* 对话框 */}
            <div className="raid-portrait-dialogue-box">
                {/* 当前对话 */}
                <div className="raid-portrait-current-line">
                    <span className="raid-portrait-speaker-name">{speaker}</span>
                    {beat.dialogue[0]?.emotion && (
                        <span className="raid-portrait-emotion">（{beat.dialogue[0].emotion}）</span>
                    )}
                </div>
                <p className="raid-portrait-dialogue-text">
                    {beat.dialogue[0]?.text || beat.narration}
                </p>

                {/* 选项（蓝半透明按钮） */}
                {!isDead && !isCleared && (
                    <div className="raid-portrait-choices">
                        {loading ? (
                            <div className="raid-choices-loading">
                                <div className="raid-loading raid-loading-sm" />
                                <span>生成中……</span>
                            </div>
                        ) : (
                            beat.choices.map((choice) => (
                                <button
                                    key={choice.id}
                                    className="raid-portrait-choice-btn"
                                    onClick={() => onChoice(choice.text, guidance)}
                                >
                                    {choice.text}
                                </button>
                            ))
                        )}
                    </div>
                )}

                {/* 编辑面板 */}
                {!isDead && !isCleared && (
                    <>
                        <div className="raid-portrait-edit-toggle">
                            <button onClick={onToggleEditPanel}>
                                {showEditPanel ? "▼" : "▶"} 剧情指导
                            </button>
                        </div>
                        {showEditPanel && (
                            <div className="raid-portrait-edit-panel">
                                <textarea
                                    placeholder="剧情方向指导（选填）"
                                    value={guidance}
                                    onChange={(e) => onGuidanceChange(e.target.value)}
                                    rows={1}
                                />
                                <div className="raid-portrait-edit-actions">
                                    <button
                                        className="raid-btn raid-btn--ghost raid-btn-sm"
                                        onClick={onAiFill}
                                        disabled={fillingGuidance}
                                    >
                                        {fillingGuidance ? "填充中…" : "AI 填入"}
                                    </button>
                                </div>
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}
