"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
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
    generatePortraitSceneImage,
    aiFillGuidance,
} from "./raid-engine";
import { resolveVoiceConfig, synthesizeSpeech, playAudioBlob, setTtsVolume, getTtsVolume } from "@/lib/tts-service";
import { loadCharacters } from "@/lib/character-storage";
import { resolveUserIdentity } from "@/lib/settings-storage";
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
    // 获取用户昵称作为女主名字 — 使用 useState + useEffect 避免 SSR 水合不匹配
    const [playerName, setPlayerName] = useState("主角");
    useEffect(() => {
        try {
            const identity = resolveUserIdentity(undefined, "raid");
            if (identity?.name) setPlayerName(identity.name);
        } catch { /* 静默 */ }
    }, []);
    const [loading, setLoading] = useState(false);
    const [showSaves, setShowSaves] = useState(false);
    const [saveSlotName, setSaveSlotName] = useState("");
    const [showEditPanel, setShowEditPanel] = useState(true);
    const [guidance, setGuidance] = useState("");
    const [editingChoiceId, setEditingChoiceId] = useState<string | null>(null);
    const [editingChoiceText, setEditingChoiceText] = useState("");
    const [fillingGuidance, setFillingGuidance] = useState(false);
    const [portraitLoading, setPortraitLoading] = useState(false);
    const [voicePlayingNpcId, setVoicePlayingNpcId] = useState<string | null>(null);
    const [voicePlayingLineKey, setVoicePlayingLineKey] = useState<string | null>(null);
    const [bgmVolume, setBgmVolume] = useState(0.3);
    const [voiceVolume, setVoiceVolume] = useState(getTtsVolume());
    const [showVolumePanel, setShowVolumePanel] = useState(false);
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const abortRef = useRef<AbortController | null>(null);
    const voiceAbortRef = useRef<AbortController | null>(null);
    const scrollRef = useRef<HTMLDivElement | null>(null);
    const playedBeatRef = useRef<Set<string>>(new Set());

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
        audioRef.current.volume = bgmVolume;
        audioRef.current.play().catch(() => {});
    }, [dungeon.bgmUrl, bgmVolume]);

    // 实时调整 BGM 音量
    useEffect(() => {
        if (audioRef.current) {
            audioRef.current.volume = bgmVolume;
        }
    }, [bgmVolume]);

    // 实时调整角色语音音量
    useEffect(() => {
        setTtsVolume(voiceVolume);
    }, [voiceVolume]);

    // 手动播放某条对话的语音（单条独立控制）
    async function handlePlayVoice(npcId: string, lineText?: string, lineKey?: string) {
        // 如果正在播放同一条，则停止
        if (lineKey && voicePlayingLineKey === lineKey) {
            handleStopVoice();
            return;
        }
        // 先停止之前的播放
        if (voiceAbortRef.current) {
            voiceAbortRef.current.abort();
            voiceAbortRef.current = null;
        }

        const npc = dungeon.npcs.find((n) => n.id === npcId);
        if (!npc?.characterId) return;
        const voiceConfig = resolveVoiceConfig(npc.characterId, RAID_APP_ID);
        if (!voiceConfig) return;

        // 如果指定了 lineText，只播放这一条；否则播放该角色在当前 beat 的所有对话
        const lines = lineText
            ? [{ text: lineText, emotion: undefined as string | undefined }]
            : (currentBeat?.dialogue.filter((l) => l.speaker === npc.name) || []);
        if (lines.length === 0) return;

        const controller = new AbortController();
        voiceAbortRef.current = controller;
        setVoicePlayingNpcId(npcId);
        setVoicePlayingLineKey(lineKey || npcId);

        try {
            for (const line of lines) {
                if (controller.signal.aborted) break;
                const blob = await synthesizeSpeech(line.text, voiceConfig, {
                    emotion: line.emotion || undefined,
                });
                if (blob) {
                    const player = playAudioBlob(blob);
                    await player.promise;
                }
            }
        } catch {
            // 静默失败
        } finally {
            setVoicePlayingNpcId(null);
            setVoicePlayingLineKey(null);
            voiceAbortRef.current = null;
        }
    }

    // 停止语音
    function handleStopVoice() {
        if (voiceAbortRef.current) {
            voiceAbortRef.current.abort();
            voiceAbortRef.current = null;
        }
        setVoicePlayingNpcId(null);
        setVoicePlayingLineKey(null);
    }

    // 立绘模式：仅在大章节更新时生成「人物+背景」融合图
    useEffect(() => {
        if (dungeon.mode !== "portrait" || !currentBeat || loading) return;
        // 当前 beat 已有融合图就不重复生成
        if (currentBeat.portraitSceneImage) return;
        if (portraitLoading) return;

        // 检查同一大章节内是否已有 beat 生成了融合图，如果有则复用
        const chapterBeats = dungeon.storyBeats.filter(b => b.chapter === currentBeat.chapter);
        const existingImage = chapterBeats.find(b => b.portraitSceneImage)?.portraitSceneImage;
        if (existingImage) {
            // 复用同章节的融合图，并同步封面
            const beats = dungeon.storyBeats.map((b) =>
                b.id === currentBeat.id ? { ...b, portraitSceneImage: existingImage } : b,
            );
            updateDungeon(dungeon.id, { storyBeats: beats, coverImage: existingImage });
            const fresh = findDungeon(dungeon.id);
            if (fresh) setDungeon(fresh);
            return;
        }

        const speaker = currentBeat.dialogue[0]?.speaker;
        const npc = speaker
            ? (dungeon.npcs.find((n) => n.name === speaker) || dungeon.npcs[0])
            : dungeon.npcs[0];
        if (!npc) return;

        const generateFusedImage = async () => {
            setPortraitLoading(true);
            try {
                const controller = new AbortController();
                const url = await generatePortraitSceneImage(
                    currentBeat, npc, dungeon, controller.signal, npc.referenceImages,
                );
                if (url) {
                    const beats = dungeon.storyBeats.map((b) =>
                        b.id === currentBeat.id ? { ...b, portraitSceneImage: url } : b,
                    );
                    // 同步封面图：每章节生成的图片自动更新为剧本封面
                    updateDungeon(dungeon.id, { storyBeats: beats, coverImage: url });
                    const fresh = findDungeon(dungeon.id);
                    if (fresh) setDungeon(fresh);
                }
            } catch {
                // 静默失败
            } finally {
                setPortraitLoading(false);
            }
        };
        generateFusedImage();
    }, [currentBeat, dungeon, loading, portraitLoading]);

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
                // 记录用户选择到历史
                const choiceHistory = [...(dungeon.choiceHistory || []), {
                    beatId: beat.id,
                    choiceText,
                    chapter: dungeon.currentChapter,
                    timestamp: new Date().toISOString(),
                }];
                updateDungeon(dungeon.id, { choiceHistory });
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

    async function handleTriggerClimax() {
        if (loading || isDead || isCleared) return;
        setLoading(true);
        const controller = new AbortController();
        abortRef.current = controller;
        try {
            const beat = await generateStoryBeat({
                dungeon,
                choiceText: "触发圆满结局",
                playerGuidance: undefined,
                signal: controller.signal,
                forceClimax: true,
            });
            const updated = appendStoryBeat(dungeon.id, beat);
            if (updated) {
                setDungeon(findDungeon(dungeon.id) || updated);
                onUpdate();
            }
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            onNotice?.(`生成结局失败：${msg}`);
        } finally {
            setLoading(false);
            abortRef.current = null;
        }
    }

    function handleRevive() {
        // 直接复活：恢复状态为 playing，增加复活次数（影响后续难度）
        const revivalCount = (dungeon.revivalCount || 0) + 1;
        // 移除死亡 beat，回到上一个正常 beat 继续游戏
        const beats = dungeon.storyBeats.slice();
        let lastBeatId = null;
        // 找到最后一个非死亡的 beat
        for (let i = beats.length - 1; i >= 0; i--) {
            if (!beats[i].isDeath && !beats[i].isClimax) {
                lastBeatId = beats[i].id;
                break;
            }
        }
        // 如果找到了正常 beat，回到那个；否则保留所有 beat 但状态改为 playing
        if (lastBeatId) {
            const cutIndex = beats.findIndex(b => b.id === lastBeatId) + 1;
            const keptBeats = beats.slice(0, cutIndex);
            updateDungeon(dungeon.id, {
                status: "playing",
                revivalCount,
                storyBeats: keptBeats,
                currentBeatId: lastBeatId,
            });
        } else {
            updateDungeon(dungeon.id, {
                status: "playing",
                revivalCount,
            });
        }
        const fresh = findDungeon(dungeon.id);
        if (fresh) setDungeon(fresh);
        onUpdate();
        onNotice?.(`已复活（第${revivalCount}次），难度将提升`);
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
            revivalCount: 0,
            choiceHistory: [],
        });
        if (updated) {
            setDungeon(updated);
            onUpdate();
        }
    }

    const targetNpcs = dungeon.npcs.filter((n) => n.isTarget);
    const otherNpcs = dungeon.npcs.filter((n) => !n.isTarget);
    const isPortraitMode = dungeon.mode === "portrait" && !!currentBeat;

    return (
        <>
            {/* 顶部标题栏 — 立绘模式下不渲染，由 PortraitMode 内部提供返回按钮 */}
            {!isPortraitMode && (
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
                            className="raid-icon-btn"
                            onClick={() => setShowSaves(!showSaves)}
                            title="存档"
                        >
                            💾
                        </button>
                    </div>
                </header>
            )}

            {/* 好感度面板 — 立绘模式下不渲染 */}
            {!isPortraitMode && (
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
            )}

            {dungeon.bgmUrl && <audio ref={audioRef} src={dungeon.bgmUrl} loop preload="auto" />}

            {/* 音量控制按钮 — 立绘模式下不渲染（由工具栏"音乐"按钮替代） */}
            {!isPortraitMode && (
            <button
                className="raid-volume-toggle"
                onClick={() => setShowVolumePanel(!showVolumePanel)}
                title="音量调节"
            >
                🔊
            </button>
            )}
            {showVolumePanel && !isPortraitMode && (
                <div className="raid-volume-panel">
                    <div className="raid-volume-row">
                        <span className="raid-volume-label">🎵 BGM</span>
                        <input
                            type="range"
                            min="0"
                            max="1"
                            step="0.05"
                            value={bgmVolume}
                            onChange={(e) => setBgmVolume(parseFloat(e.target.value))}
                            className="raid-volume-slider"
                        />
                        <span className="raid-volume-value">{Math.round(bgmVolume * 100)}%</span>
                    </div>
                    <div className="raid-volume-row">
                        <span className="raid-volume-label">🗣️ 角色</span>
                        <input
                            type="range"
                            min="0"
                            max="2"
                            step="0.05"
                            value={voiceVolume}
                            onChange={(e) => setVoiceVolume(parseFloat(e.target.value))}
                            className="raid-volume-slider"
                        />
                        <span className="raid-volume-value">{Math.round(voiceVolume * 100)}%</span>
                    </div>
                </div>
            )}

            {/* BGM 播放条 — 立绘模式下不渲染 */}
            {dungeon.bgmUrl && !isPortraitMode && (
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

            {/* 主体内容 */}
            {isPortraitMode ? (
                <PortraitMode
                    beat={currentBeat}
                    dungeon={dungeon}
                    loading={loading}
                    portraitLoading={portraitLoading}
                    playerName={playerName}
                    onChoice={handleChoice}
                    onBack={onBack}
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
                    onTriggerClimax={handleTriggerClimax}
                    onPlayVoice={handlePlayVoice}
                    onStopVoice={handleStopVoice}
                    voicePlayingNpcId={voicePlayingNpcId}
                    voicePlayingLineKey={voicePlayingLineKey}
                    bgmVolume={bgmVolume}
                    voiceVolume={voiceVolume}
                    onBgmVolumeChange={setBgmVolume}
                    onVoiceVolumeChange={setVoiceVolume}
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
                            <NovelChatLog
                                dungeon={dungeon}
                                onPlayVoice={handlePlayVoice}
                                onStopVoice={handleStopVoice}
                                voicePlayingNpcId={voicePlayingNpcId}
                                voicePlayingLineKey={voicePlayingLineKey}
                            />
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
                            onTriggerClimax={handleTriggerClimax}
                        />
                    )}
                </>
            )}

            {/* 死亡覆盖层 */}
            {isDead && currentBeat && (
                <DeathScreen
                    beat={currentBeat}
                    deathCount={dungeon.deathCount}
                    chapter={dungeon.currentChapter}
                    revivalCount={dungeon.revivalCount || 0}
                    onRestart={handleRestart}
                    onRevive={handleRevive}
                    onBack={onBack}
                    playerName={playerName}
                />
            )}

            {/* 通关覆盖层 */}
            {isCleared && (
                <div className="raid-clear-screen">
                    <h2 className="raid-clear-title">攻略成功</h2>
                    <p className="raid-clear-desc">{playerName}征服了这个世界的所有挑战</p>
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
function NovelChatLog({
    dungeon,
    onPlayVoice,
    onStopVoice,
    voicePlayingNpcId,
    voicePlayingLineKey,
}: {
    dungeon: RaidDungeon;
    onPlayVoice?: (npcId: string, lineText?: string, lineKey?: string) => void;
    onStopVoice?: () => void;
    voicePlayingNpcId?: string | null;
    voicePlayingLineKey?: string | null;
}) {
    return (
        <div className="raid-chat-log">
            {dungeon.storyBeats.map((beat, idx) => {
                const prevBeat = idx > 0 ? dungeon.storyBeats[idx - 1] : null;
                // 从选择历史中查找当前 beat 对应的用户选择
                const choiceRecord = dungeon.choiceHistory?.find((h) => h.beatId === beat.id);
                const playerChoice = choiceRecord?.choiceText || undefined;
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

                        {/* 对话：每句独立气泡，绑定了语音的角色可单独播放 */}
                        {beat.dialogue.map((line, i) => {
                            const npc = dungeon.npcs.find((n) => n.name === line.speaker);
                            const isTarget = npc?.isTarget;
                            const hasVoice = !!(npc?.characterId && resolveVoiceConfig(npc.characterId, RAID_APP_ID));
                            const lineKey = `${beat.id}-d${i}`;
                            const isPlaying = voicePlayingLineKey === lineKey;
                            return (
                                <div
                                    key={`d-${i}`}
                                    className={`raid-chat-bubble raid-chat-bubble--dialogue ${isTarget ? "raid-chat-bubble--target" : ""}`}
                                >
                                    <div className="raid-chat-speaker-row">
                                        <span className="raid-chat-speaker">{line.speaker}</span>
                                        {line.emotion && <span className="raid-chat-emotion">（{line.emotion}）</span>}
                                        {hasVoice && npc && onPlayVoice && (
                                            <button
                                                className="raid-chat-voice-btn"
                                                onClick={() => onPlayVoice(npc.id, line.text, lineKey)}
                                                title={isPlaying ? "停止" : "播放语音"}
                                            >
                                                {isPlaying ? "⏸" : "🔊"}
                                            </button>
                                        )}
                                    </div>
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
    onTriggerClimax: () => void;
};

function ChoicePanel(props: ChoicePanelProps) {
    const {
        beat, loading, guidance, onGuidanceChange, onAiFill, fillingGuidance,
        showEditPanel, onToggleEditPanel, editingChoiceId, onEditChoice,
        editingChoiceText, onEditingChoiceTextChange, onConfirmEdit, onCancelEdit, onChoice, onTriggerClimax,
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
                ) : beat.atMaxFavor ? (
                    <div className="raid-choice-item raid-max-favor-choice">
                        <p className="raid-max-favor-hint">好感度已满，是否触发圆满结局？</p>
                        <div className="raid-max-favor-buttons">
                            <button
                                className="raid-choice-btn raid-choice-btn--compact raid-choice-btn--safe"
                                onClick={() => onChoice("继续推进剧情")}
                            >
                                继续攻略
                            </button>
                            <button
                                className="raid-choice-btn raid-choice-btn--compact raid-choice-btn--safe raid-choice-btn--climax"
                                onClick={onTriggerClimax}
                            >
                                圆满结局
                            </button>
                        </div>
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
    playerName: string;
    onChoice: (text: string, guidance?: string) => void;
    onBack: () => void;
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
    onTriggerClimax: () => void;
    onPlayVoice: (npcId: string, lineText?: string, lineKey?: string) => void;
    onStopVoice: () => void;
    voicePlayingNpcId: string | null;
    voicePlayingLineKey: string | null;
    bgmVolume: number;
    voiceVolume: number;
    onBgmVolumeChange: (v: number) => void;
    onVoiceVolumeChange: (v: number) => void;
};

function PortraitMode(props: PortraitModeProps) {
    const {
        beat, dungeon, loading, portraitLoading, playerName, onChoice, onBack,
        guidance, onGuidanceChange, onAiFill, fillingGuidance,
        showEditPanel, onToggleEditPanel, editingChoiceId, onEditChoice,
        onEditingChoiceTextChange, onConfirmEdit, onCancelEdit,
        isDead, isCleared, onTriggerClimax,
        onPlayVoice, onStopVoice, voicePlayingNpcId, voicePlayingLineKey,
        bgmVolume, voiceVolume, onBgmVolumeChange, onVoiceVolumeChange,
    } = props;

    // 底部工具栏面板状态
    const [bottomPanel, setBottomPanel] = useState<"none" | "attributes" | "log" | "volume">("none");
    // 自动播放
    const [autoPlay, setAutoPlay] = useState(false);

    // 立绘模式只使用一张「人物+背景」融合图
    const fusedImage = beat.portraitSceneImage;

    // 将当前 beat 的旁白和对话拆分为「剧情段落」，逐段显示
    const segments = useMemo(() => {
        const segs: Array<{
            type: "narration" | "dialogue" | "choice";
            text: string;
            speaker?: string;
            emotion?: string;
        }> = [];
        // 用户选择（如果有，显示在最前面）
        const choiceRecord = dungeon.choiceHistory?.find((h) => h.beatId === beat.id);
        if (choiceRecord) {
            segs.push({ type: "choice", text: choiceRecord.choiceText });
        }
        // 旁白按句拆分
        const narrationParts = splitSentences(beat.narration);
        for (const part of narrationParts) {
            segs.push({ type: "narration", text: part });
        }
        // 每条对话独立一段
        for (const line of beat.dialogue) {
            segs.push({ type: "dialogue", text: line.text, speaker: line.speaker, emotion: line.emotion });
        }
        // 如果没有内容，放一个占位段
        if (segs.length === 0) {
            segs.push({ type: "narration", text: beat.sceneTitle || "……" });
        }
        return segs;
    }, [beat.id, beat.narration, beat.dialogue, beat.sceneTitle, dungeon.choiceHistory]);

    const [segmentIndex, setSegmentIndex] = useState(0);
    const isLastSegment = segmentIndex >= segments.length - 1;

    // beat 切换时重置段落索引
    useEffect(() => {
        setSegmentIndex(0);
    }, [beat.id]);

    // 自动播放：每隔 2.5 秒推进段落
    useEffect(() => {
        if (!autoPlay || isDead || isCleared) return;
        if (!isLastSegment) {
            const timer = setTimeout(() => {
                setSegmentIndex((i) => Math.min(segments.length - 1, i + 1));
            }, 2500);
            return () => clearTimeout(timer);
        }
    }, [autoPlay, segmentIndex, isLastSegment, isDead, isCleared, segments.length]);

    const currentSeg = segments[segmentIndex] || segments[0];
    const canGoBack = segmentIndex > 0;
    const canGoForward = segmentIndex < segments.length - 1;

    // 当前段落的说话角色
    const currentSpeaker = currentSeg?.type === "dialogue" ? currentSeg.speaker : undefined;
    const speakerNpc = currentSpeaker
        ? (dungeon.npcs.find((n) => n.name === currentSpeaker) || undefined)
        : undefined;
    const hasVoice = !!(speakerNpc?.characterId && resolveVoiceConfig(speakerNpc.characterId, RAID_APP_ID));
    const lineKey = `${beat.id}-seg${segmentIndex}`;
    const isVoicePlaying = voicePlayingLineKey === lineKey;

    return (
        <div className={`raid-portrait-fullscreen raid-theme-${dungeon.theme}`}>
            {/* 单张融合图（人物为主体+背景衬托） */}
            <div className="raid-portrait-bg">
                {fusedImage ? (
                    <img src={fusedImage} alt={beat.sceneTitle} className="raid-portrait-bg-img" />
                ) : (
                    <div className="raid-portrait-bg-placeholder">
                        {portraitLoading && (
                            <div className="raid-portrait-gen-loading">
                                <div className="raid-loading" />
                                <span>生成画面中…</span>
                            </div>
                        )}
                    </div>
                )}
                {/* 渐变遮罩，底部加深确保文字可读 */}
                <div className="raid-portrait-gradient" />
            </div>

            {/* 返回按钮（左上角）— 如果有面板打开，先关闭面板；否则退出 */}
            <button
                className="raid-portrait-back-btn"
                onClick={() => {
                    if (bottomPanel !== "none") {
                        setBottomPanel("none");
                    } else if (autoPlay) {
                        setAutoPlay(false);
                    } else {
                        onBack();
                    }
                }}
                title="返回"
            >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M15 18l-6-6 6-6" />
                </svg>
            </button>

            {/* 章节标题（正上方居中） */}
            <div className="raid-portrait-chapter-title">
                <span className="raid-portrait-chapter-num">第 {beat.chapter} 章</span>
                {beat.sceneTitle && (
                    <>
                        <span className="raid-portrait-chapter-sep">·</span>
                        <span className="raid-portrait-chapter-name">{beat.sceneTitle}</span>
                    </>
                )}
            </div>

            {/* 段落导航箭头（左） */}
            {canGoBack && (
                <button
                    className="raid-portrait-nav-arrow raid-portrait-nav-arrow--left"
                    onClick={() => setSegmentIndex(i => Math.max(0, i - 1))}
                    title="上一段"
                >
                    ‹
                </button>
            )}

            {/* 段落导航箭头（右） */}
            {canGoForward && (
                <button
                    className="raid-portrait-nav-arrow raid-portrait-nav-arrow--right"
                    onClick={() => setSegmentIndex(i => Math.min(segments.length - 1, i + 1))}
                    title="下一段"
                >
                    ›
                </button>
            )}

            {/* 底部紧凑剧情框 + 工具栏 */}
            <div className="raid-portrait-bottom-area">
                {/* 选项显示时隐藏剧情框和名称标签 */}
                {!(isLastSegment && !isDead && !isCleared && (beat.choices.length > 0 || beat.atMaxFavor) && !loading) && (
                    <>
                        {/* 角色名称标签（浮动在对话框左上角） */}
                        {currentSeg?.type === "dialogue" && currentSeg.speaker && (
                            <div className="raid-portrait-name-tag">
                                <span className="raid-portrait-name-tag-text">{currentSeg.speaker}</span>
                                {currentSeg.emotion && (
                                    <span className="raid-portrait-emotion">（{currentSeg.emotion}）</span>
                                )}
                                {hasVoice && speakerNpc && (
                                    <button
                                        className="raid-portrait-voice-btn raid-portrait-voice-btn--inline"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            isVoicePlaying ? onStopVoice() : onPlayVoice(speakerNpc.id, currentSeg.text, lineKey);
                                        }}
                                        title={isVoicePlaying ? "停止语音" : "播放语音"}
                                    >
                                        {isVoicePlaying ? (
                                            <span className="raid-portrait-voice-bars">
                                                <span></span><span></span><span></span>
                                            </span>
                                        ) : "🔊"}
                                    </button>
                                )}
                            </div>
                        )}

                        {/* 当前剧情段落 — 对话用半透明白底框，旁白无框纯文字，选择用玩家气泡 */}
                        <div
                            className={`raid-portrait-dialogue-box ${
                                currentSeg?.type === "narration" ? "raid-portrait-dialogue-box--narration" :
                                currentSeg?.type === "choice" ? "raid-portrait-dialogue-box--choice" : ""
                            }`}
                            onClick={() => canGoForward && setSegmentIndex(i => Math.min(segments.length - 1, i + 1))}
                            style={{ cursor: canGoForward ? "pointer" : "default" }}
                        >
                            {currentSeg?.type === "dialogue" ? (
                                <p className="raid-portrait-dialogue-text">{currentSeg.text}</p>
                            ) : currentSeg?.type === "choice" ? (
                                <p className="raid-portrait-choice-text">
                                    <span className="raid-portrait-choice-icon">❥</span>
                                    <span className="raid-portrait-choice-label">{playerName}的选择</span>
                                    <span className="raid-portrait-choice-content">{currentSeg.text}</span>
                                </p>
                            ) : (
                                <p className="raid-portrait-narration-text">{currentSeg?.text}</p>
                            )}
                        </div>
                    </>
                )}

                {/* 选项区：只在最后一段时显示 — 选项 + 指导输入 + 继续按钮 */}
                {!isDead && !isCleared && isLastSegment && (
                    <div className="raid-portrait-choices">
                        {loading ? (
                            <div className="raid-choices-loading">
                                <div className="raid-loading raid-loading-sm" />
                                <span>生成中……</span>
                            </div>
                        ) : beat.atMaxFavor ? (
                            /* 满好感度：用户选择继续或触发结局 */
                            <div className="raid-portrait-max-favor-choice">
                                <p className="raid-portrait-max-favor-hint">好感度已满，是否触发圆满结局？</p>
                                <div className="raid-portrait-max-favor-buttons">
                                    <button
                                        className="raid-portrait-choice-btn raid-portrait-choice-btn--compact raid-portrait-choice-btn--continue"
                                        onClick={() => onChoice("继续推进剧情", guidance)}
                                    >
                                        继续攻略
                                    </button>
                                    <button
                                        className="raid-portrait-choice-btn raid-portrait-choice-btn--compact raid-portrait-choice-btn--climax"
                                        onClick={onTriggerClimax}
                                    >
                                        圆满结局
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <>
                                {/* 剧情选项 — 参考恋与深空：仅简略方向文字 */}
                                {beat.choices.map((choice) => (
                                    <button
                                        key={choice.id}
                                        className="raid-portrait-choice-btn raid-portrait-choice-btn--compact"
                                        onClick={() => onChoice(choice.text, guidance)}
                                    >
                                        <span className="raid-portrait-choice-btn-text">{choice.text}</span>
                                    </button>
                                ))}
                                {/* 指导输入 + 继续按钮 */}
                                <div className="raid-portrait-guidance-row">
                                    <textarea
                                        placeholder="剧情方向指导（选填）"
                                        value={guidance}
                                        onChange={(e) => onGuidanceChange(e.target.value)}
                                        rows={1}
                                        className="raid-portrait-guidance-input"
                                    />
                                    <button
                                        className="raid-btn raid-btn--ghost raid-btn-sm raid-portrait-ai-fill-btn"
                                        onClick={onAiFill}
                                        disabled={fillingGuidance}
                                    >
                                        {fillingGuidance ? "填充中…" : "AI 填入"}
                                    </button>
                                </div>
                                <button
                                    className="raid-portrait-choice-btn raid-portrait-choice-btn--compact raid-portrait-choice-btn--continue"
                                    onClick={() => onChoice("继续推进剧情", guidance)}
                                >
                                    继续
                                </button>
                            </>
                        )}
                    </div>
                )}

                {/* 继续提示 */}
                {!isLastSegment && !isDead && !isCleared && (
                    <div className="raid-portrait-continue-hint">
                        点击继续 ▸
                    </div>
                )}

                {/* 死亡/通关 */}
                {isDead && (
                    <div className="raid-portrait-ending raid-portrait-ending--dead">
                        <div className="raid-portrait-ending-emoji">💀</div>
                        <p className="raid-portrait-ending-title">攻略失败</p>
                        {beat.narration && (
                            <p className="raid-portrait-ending-narration">{beat.narration}</p>
                        )}
                        {beat.dialogue.length > 0 && (
                            <div className="raid-portrait-ending-dialogue">
                                {beat.dialogue.slice(0, 3).map((line, i) => (
                                    <p key={i} className="raid-portrait-ending-line">
                                        <span className="raid-portrait-ending-speaker">{line.speaker}：</span>
                                        {line.text}
                                    </p>
                                ))}
                            </div>
                        )}
                    </div>
                )}
                {isCleared && (
                    <div className="raid-portrait-ending raid-portrait-ending--clear">
                        <div className="raid-portrait-ending-emoji">🎉</div>
                        <p className="raid-portrait-ending-title">攻略成功！</p>
                    </div>
                )}
            </div>

            {/* 底部工具栏（参考图1：音乐/自动/回顾/属性） */}
            {!isDead && !isCleared && (
                <div className="raid-portrait-toolbar">
                    <button
                        className={`raid-portrait-toolbar-btn ${bottomPanel === "volume" ? "raid-portrait-toolbar-btn--active" : ""}`}
                        onClick={() => setBottomPanel(bottomPanel === "volume" ? "none" : "volume")}
                    >
                        <span className="raid-portrait-toolbar-icon">🎵</span>
                        <span className="raid-portrait-toolbar-label">音乐</span>
                    </button>
                    <button
                        className={`raid-portrait-toolbar-btn ${autoPlay ? "raid-portrait-toolbar-btn--active" : ""}`}
                        onClick={() => setAutoPlay(!autoPlay)}
                    >
                        <span className="raid-portrait-toolbar-icon">▶</span>
                        <span className="raid-portrait-toolbar-label">自动</span>
                    </button>
                    <button
                        className={`raid-portrait-toolbar-btn ${bottomPanel === "log" ? "raid-portrait-toolbar-btn--active" : ""}`}
                        onClick={() => setBottomPanel(bottomPanel === "log" ? "none" : "log")}
                    >
                        <span className="raid-portrait-toolbar-icon">📜</span>
                        <span className="raid-portrait-toolbar-label">回顾</span>
                    </button>
                    <button
                        className={`raid-portrait-toolbar-btn ${bottomPanel === "attributes" ? "raid-portrait-toolbar-btn--active" : ""}`}
                        onClick={() => setBottomPanel(bottomPanel === "attributes" ? "none" : "attributes")}
                    >
                        <span className="raid-portrait-toolbar-icon">❤</span>
                        <span className="raid-portrait-toolbar-label">属性</span>
                    </button>
                </div>
            )}

            {/* 人物属性面板 */}
            {bottomPanel === "attributes" && (
                <AttributesPanel dungeon={dungeon} onClose={() => setBottomPanel("none")} />
            )}

            {/* 剧情回顾面板 */}
            {bottomPanel === "log" && (
                <StoryLogPanel dungeon={dungeon} playerName={playerName} onClose={() => setBottomPanel("none")} />
            )}

            {/* 音量面板 */}
            {bottomPanel === "volume" && (
                <VolumePanel
                    bgmVolume={bgmVolume}
                    voiceVolume={voiceVolume}
                    onBgmVolumeChange={onBgmVolumeChange}
                    onVoiceVolumeChange={onVoiceVolumeChange}
                    onClose={() => setBottomPanel("none")}
                />
            )}

            {/* 编辑面板已集成到选项区，不再单独显示 */}
        </div>
    );
}

// ── 人物属性面板（参考图3） ──

type PanelProps = {
    dungeon: RaidDungeon;
    playerName?: string;
    onClose: () => void;
};

// ── 属性面板头像：优先使用角色选择界面的头像，兼容字符串 / {url} 对象，加载失败回退到场景图，再回退到首字母 ──
function AttrAvatar({ npc, fallbackSceneImage }: { npc: DungeonNpc; fallbackSceneImage?: string }) {
    // 从 portraits / referenceImages 中提取可显示的 URL（兼容纯字符串与 {url|dataUrl|src|imageUrl} 对象）
    const directUrl = useMemo(() => {
        const toUrl = (v: unknown): string | null => {
            if (typeof v === "string" && v.trim()) return v;
            if (v && typeof v === "object") {
                const o = v as Record<string, unknown>;
                const u = o.url ?? o.dataUrl ?? o.src ?? o.imageUrl;
                if (typeof u === "string" && u.trim()) return u;
            }
            return null;
        };
        // 优先级：角色选择界面的头像 > NPC portraits > NPC referenceImages
        let charAvatar: string | null = null;
        if (npc.characterId) {
            const char = loadCharacters().find((c) => c.id === npc.characterId);
            if (char?.avatar) charAvatar = char.avatar;
        }
        return charAvatar ?? toUrl(npc.portraits?.[0]) ?? toUrl(npc.referenceImages?.[0]) ?? null;
    }, [npc.characterId, npc.portraits, npc.referenceImages]);

    const [stage, setStage] = useState<"direct" | "scene" | "none">(
        directUrl ? "direct" : fallbackSceneImage ? "scene" : "none",
    );

    // 数据变化时重置回退阶段
    useEffect(() => {
        setStage(directUrl ? "direct" : fallbackSceneImage ? "scene" : "none");
    }, [directUrl, fallbackSceneImage]);

    if (stage === "direct" && directUrl) {
        return (
            <img
                src={directUrl}
                alt={npc.name}
                onError={() => setStage(fallbackSceneImage ? "scene" : "none")}
            />
        );
    }
    if (stage === "scene" && fallbackSceneImage) {
        return (
            <img
                src={fallbackSceneImage}
                alt={npc.name}
                onError={() => setStage("none")}
            />
        );
    }
    return (
        <span className="raid-portrait-attr-avatar-fallback">
            {npc.name?.[0] ?? "?"}
        </span>
    );
}

function AttributesPanel({ dungeon, onClose }: PanelProps) {
    // 备用头像：取最近一张已生成的「人物+背景」融合图，保证属性面板一定能看到角色
    const fallbackSceneImage = useMemo(() => {
        for (let i = dungeon.storyBeats.length - 1; i >= 0; i--) {
            if (dungeon.storyBeats[i].portraitSceneImage) {
                return dungeon.storyBeats[i].portraitSceneImage;
            }
        }
        return undefined;
    }, [dungeon.storyBeats]);

    return (
        <div className="raid-portrait-overlay-panel">
            <div className="raid-portrait-overlay-header">
                <h2>人物属性</h2>
                <span className="raid-portrait-overlay-subtitle">CHARACTER PROFILE</span>
                <button className="raid-portrait-overlay-close" onClick={onClose}>×</button>
            </div>
            <div className="raid-portrait-overlay-body">
                {dungeon.npcs.filter((n) => n.isTarget).map((npc) => {
                    const favor = dungeon.favor[npc.id] ?? 0;
                    const favorPct = Math.max(0, Math.min(100, (favor + 100) / 2));
                    return (
                        <div key={npc.id} className="raid-portrait-attr-card">
                            <div className="raid-portrait-attr-avatar">
                                <AttrAvatar npc={npc} fallbackSceneImage={fallbackSceneImage} />
                            </div>
                            <div className="raid-portrait-attr-info">
                                <div className="raid-portrait-attr-name">{npc.name}</div>
                                <div className="raid-portrait-attr-role">{NPC_ROLE_LABELS[npc.role]}</div>
                                <div className="raid-portrait-attr-bar">
                                    <span className="raid-portrait-attr-bar-label">好感</span>
                                    <div className="raid-portrait-attr-bar-track">
                                        <div className="raid-portrait-attr-bar-fill" style={{ width: `${favorPct}%` }} />
                                    </div>
                                    <span className="raid-portrait-attr-bar-val">{favor}</span>
                                </div>
                                <div className="raid-portrait-attr-persona">{npc.persona}</div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

// ── 剧情回顾面板（参考图2） ──

function StoryLogPanel({ dungeon, playerName, onClose }: PanelProps) {
    const allSegments = useMemo(() => {
        const result: Array<{
            beatIdx: number;
            type: "narration" | "dialogue" | "choice";
            text: string;
            speaker?: string;
            emotion?: string;
            chapter: number;
            sceneTitle: string;
        }> = [];
        dungeon.storyBeats.forEach((beat, beatIdx) => {
            // 章节标题
            result.push({ beatIdx, type: "narration", text: `— 第 ${beat.chapter} 章 · ${beat.sceneTitle} —`, chapter: beat.chapter, sceneTitle: beat.sceneTitle });
            // 用户选择（在 beat 内容之前显示）
            const choiceRecord = dungeon.choiceHistory?.find((h) => h.beatId === beat.id);
            if (choiceRecord) {
                result.push({ beatIdx, type: "choice", text: choiceRecord.choiceText, chapter: beat.chapter, sceneTitle: beat.sceneTitle });
            }
            // 旁白
            const narrationParts = splitSentences(beat.narration);
            narrationParts.forEach((text) => {
                result.push({ beatIdx, type: "narration", text, chapter: beat.chapter, sceneTitle: beat.sceneTitle });
            });
            // 对话
            beat.dialogue.forEach((line) => {
                result.push({ beatIdx, type: "dialogue", text: line.text, speaker: line.speaker, emotion: line.emotion, chapter: beat.chapter, sceneTitle: beat.sceneTitle });
            });
        });
        return result;
    }, [dungeon.storyBeats, dungeon.choiceHistory]);

    return (
        <div className="raid-portrait-overlay-panel">
            <div className="raid-portrait-overlay-header">
                <h2>剧情回顾</h2>
                <span className="raid-portrait-overlay-subtitle">STORY LOG</span>
                <button className="raid-portrait-overlay-close" onClick={onClose}>×</button>
            </div>
            <div className="raid-portrait-overlay-body raid-portrait-log-body">
                {allSegments.map((seg, i) => (
                    <div key={i} className="raid-portrait-log-entry">
                        {seg.type === "dialogue" ? (
                            <p className="raid-portrait-log-dialogue">
                                <span className="raid-portrait-speaker-diamond">◆</span>
                                <span className="raid-portrait-log-speaker">{seg.speaker}</span>
                                <span className="raid-portrait-log-text">{seg.text}</span>
                            </p>
                        ) : seg.type === "choice" ? (
                            <p className="raid-portrait-log-choice">
                                <span className="raid-portrait-log-choice-icon">❥</span>
                                <span className="raid-portrait-log-choice-label">{playerName || "主角"}的选择：</span>
                                <span className="raid-portrait-log-choice-text">{seg.text}</span>
                            </p>
                        ) : (
                            <p className="raid-portrait-log-narration">{seg.text}</p>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
}

// ── 音量面板 ──

type VolumePanelProps = {
    bgmVolume: number;
    voiceVolume: number;
    onBgmVolumeChange: (v: number) => void;
    onVoiceVolumeChange: (v: number) => void;
    onClose: () => void;
};

function VolumePanel({ bgmVolume, voiceVolume, onBgmVolumeChange, onVoiceVolumeChange, onClose }: VolumePanelProps) {
    return (
        <div className="raid-portrait-overlay-panel raid-portrait-overlay-panel--sm">
            <div className="raid-portrait-overlay-header">
                <h2>音量</h2>
                <button className="raid-portrait-overlay-close" onClick={onClose}>×</button>
            </div>
            <div className="raid-portrait-overlay-body raid-portrait-volume-body">
                <div className="raid-portrait-volume-row">
                    <span className="raid-portrait-volume-label">背景音乐</span>
                    <input
                        type="range" min={0} max={1} step={0.01}
                        value={bgmVolume}
                        onChange={(e) => onBgmVolumeChange(parseFloat(e.target.value))}
                        className="raid-portrait-volume-slider"
                    />
                    <span className="raid-portrait-volume-val">{Math.round(bgmVolume * 100)}%</span>
                </div>
                <div className="raid-portrait-volume-row">
                    <span className="raid-portrait-volume-label">角色语音</span>
                    <input
                        type="range" min={0} max={2} step={0.01}
                        value={voiceVolume}
                        onChange={(e) => onVoiceVolumeChange(parseFloat(e.target.value))}
                        className="raid-portrait-volume-slider"
                    />
                    <span className="raid-portrait-volume-val">{Math.round(voiceVolume * 100)}%</span>
                </div>
            </div>
        </div>
    );
}

// ── 死亡结局界面（展示沙雕死亡剧情） ──

const DEATH_EMOJIS = ["💀", "👻", "🤡", "🤦", "💀", "😵", "🤪", "😭", "🫠", "🩲", "🦆", "🍌"];
const DEATH_SUBTITLES = [
    "{name}在这个世界的故事……以一种离谱的方式终结了",
    "这大概是最社死的结局了",
    "连编剧都没想到{name}会这样收场",
    "这不是他们想要的结局，但确实很好笑",
    "{name}的攻略之路，止步于此（笑）",
    "也许换个活法会更好……大概吧",
    "这一幕将成为传说……被人嘲笑的那种",
    "至少{name}走得很……有画面感",
    "史书上不会记载这一天，但表情包会",
    "如果尴尬能致死，那{name}已经死了三次",
    "这一刻，空气都凝固了……然后炸了",
    "攻略失败，但{name}的社死成功了",
];

type DeathScreenProps = {
    beat: StoryBeat;
    deathCount: number;
    chapter: number;
    revivalCount: number;
    onRestart: () => void;
    onRevive: () => void;
    onBack: () => void;
    playerName: string;
};

function DeathScreen({ beat, deathCount, chapter, revivalCount, onRestart, onRevive, onBack, playerName }: DeathScreenProps) {
    const emoji = useMemo(() => DEATH_EMOJIS[Math.floor(Math.random() * DEATH_EMOJIS.length)], []);
    const subtitle = useMemo(() => {
        const raw = DEATH_SUBTITLES[Math.floor(Math.random() * DEATH_SUBTITLES.length)];
        return raw.replace(/{name}/g, playerName);
    }, [playerName]);

    return (
        <div className="raid-death-screen">
            <div className="raid-death-emoji">{emoji}</div>
            <h2 className="raid-death-screen-title">攻略失败</h2>
            <p className="raid-death-screen-subtitle">{subtitle}</p>

            {beat.sceneTitle && (
                <div className="raid-death-scene-title">「{beat.sceneTitle}」</div>
            )}

            {beat.narration && (
                <div className="raid-death-narration">
                    <p>{beat.narration}</p>
                </div>
            )}

            {beat.dialogue.length > 0 && (
                <div className="raid-death-dialogue">
                    {beat.dialogue.map((line, i) => (
                        <div key={i} className="raid-death-dialogue-line">
                            <span className="raid-death-speaker">{line.speaker}</span>
                            <span className="raid-death-line-text">{line.text}</span>
                        </div>
                    ))}
                </div>
            )}

            <p className="raid-death-screen-count">
                第 {chapter} 章 · 累计死亡 {deathCount} 次{revivalCount > 0 ? ` · 已复活 ${revivalCount} 次` : ""}
            </p>

            <div className="raid-death-actions">
                <button className="raid-btn raid-btn--primary" onClick={onRevive}>
                    直接复活{revivalCount > 0 ? `（难度+${revivalCount}）` : ""}
                </button>
                <button className="raid-btn raid-btn--ghost" onClick={onRestart}>
                    重头再来
                </button>
                <button className="raid-btn raid-btn--ghost" onClick={onBack}>
                    返回
                </button>
            </div>
        </div>
    );
}
