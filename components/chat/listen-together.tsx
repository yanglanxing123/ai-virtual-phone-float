"use client";

import { useState, useEffect, useRef, useCallback, memo } from "react";
import { X, Heart, Pause, Music, ChevronUp, ChevronDown } from "lucide-react";
import type { ChatMessage } from "@/lib/chat-storage";
import { pushChatMessage } from "@/lib/chat-storage";
import { kvGet, kvSet, kvRemove } from "@/lib/kv-db";

/* eslint-disable @typescript-eslint/no-explicit-any */

// ── 类型定义 ──────────────────────────────────────────────

export interface ListenTogetherTrack {
    title: string;
    artist?: string;
    coverUrl?: string;
    source?: string; // "netease" | "local" | "我喜欢的音乐"
    songId?: number;  // 网易云歌曲ID，用于获取歌词
    lyrics?: string; // LRC 格式歌词
    duration?: number; // 歌曲时长（秒）
}

export interface ListenTogetherState {
    active: boolean;
    startTime: number | null;
    pausedDuration: number;
    currentTrack: ListenTogetherTrack | null;
    isPlaying: boolean;
    elapsedSeconds: number;
}

export const initialListenTogetherState: ListenTogetherState = {
    active: false,
    startTime: null,
    pausedDuration: 0,
    currentTrack: null,
    isPlaying: false,
    elapsedSeconds: 0,
};

// ── 全局切歌来源追踪 ──────────────────────────────────────
// bridge 调用时间戳：记录 AI 通过 bridge 切歌的时间
let _bridgeCallTimestamp = 0;

/** 标记此次音乐操作来自 AI（通过 bridge 调用），记录时间戳 */
export function setBridgeCallFlag(): void {
    _bridgeCallTimestamp = Date.now();
}

/**
 * 检查最近的切歌是否来自 AI（通过 bridge 调用）
 * 如果 bridge 调用在 5 秒内，则认为是 AI 切歌
 */
export function consumeBridgeCallFlag(): boolean {
    if (_bridgeCallTimestamp === 0) return false;
    const elapsed = Date.now() - _bridgeCallTimestamp;
    _bridgeCallTimestamp = 0;
    // 5 秒内的 bridge 调用认为是 AI 切歌
    return elapsed < 5000;
}

// ── 全局一起听浮窗状态存储 ──────────────────────────────────
// 用于跨 App 切换保持浮窗显示

export type LtOverlayState = {
    active: boolean;
    track: ListenTogetherTrack | null;
    isPlaying: boolean;
    elapsedSeconds: number;
    charName: string;
    userNickname: string;
    userAvatar?: string;
    charAvatar?: string;
    currentTime: number;  // 当前播放进度（秒）
    duration: number;     // 歌曲总时长（秒）
    switchedBy: "user" | "character" | null;
};

const LT_OVERLAY_KEY = "ai_phone_lt_overlay_v1";

let _overlayState: LtOverlayState = {
    active: false,
    track: null,
    isPlaying: false,
    elapsedSeconds: 0,
    charName: "",
    userNickname: "我",
    currentTime: 0,
    duration: 0,
    switchedBy: null,
};

const _overlayListeners = new Set<() => void>();

function _notifyOverlayListeners() {
    _overlayListeners.forEach(fn => fn());
}

/** 更新全局浮窗状态（由聊天室调用） */
export function setLtOverlayState(patch: Partial<LtOverlayState>): void {
    _overlayState = { ..._overlayState, ...patch };
    try {
        kvSet(LT_OVERLAY_KEY, JSON.stringify({
            active: _overlayState.active,
            track: _overlayState.track,
            isPlaying: _overlayState.isPlaying,
            elapsedSeconds: _overlayState.elapsedSeconds,
            charName: _overlayState.charName,
            userNickname: _overlayState.userNickname,
            userAvatar: _overlayState.userAvatar,
            charAvatar: _overlayState.charAvatar,
            currentTime: _overlayState.currentTime,
            duration: _overlayState.duration,
            switchedBy: _overlayState.switchedBy,
        }));
    } catch { /* 静默 */ }
    _notifyOverlayListeners();
}

/** 清除全局浮窗状态 */
export function clearLtOverlayState(): void {
    _overlayState = {
        active: false, track: null, isPlaying: false, elapsedSeconds: 0,
        charName: "", userNickname: "我", currentTime: 0, duration: 0, switchedBy: null,
    };
    try { kvRemove(LT_OVERLAY_KEY); } catch { /* 静默 */ }
    _notifyOverlayListeners();
}

/** 获取当前浮窗状态（同步） */
export function getLtOverlayState(): LtOverlayState {
    return _overlayState;
}

/** React Hook：订阅浮窗状态变化 */
export function useLtOverlayState(): LtOverlayState {
    const [state, setState] = useState<LtOverlayState>(_overlayState);
    useEffect(() => {
        // 初始化时从 kv-db 恢复
        try {
            const raw = kvGet(LT_OVERLAY_KEY);
            if (raw) {
                const parsed = JSON.parse(raw);
                _overlayState = { ..._overlayState, ...parsed };
                setState(_overlayState);
            }
        } catch { /* 静默 */ }

        const listener = () => setState({ ..._overlayState });
        _overlayListeners.add(listener);
        return () => { _overlayListeners.delete(listener); };
    }, []);
    return state;
}

// ── LRC 歌词解析 ──────────────────────────────────────────

type LyricLine = { time: number; text: string };

function parseLrc(lrc: string): LyricLine[] {
    if (!lrc) return [];
    const lines: LyricLine[] = [];
    const timeRegex = /\[(\d{2}):(\d{2})\.(\d{2,3})\]/g;
    for (const rawLine of lrc.split("\n")) {
        const matches = [...rawLine.matchAll(timeRegex)];
        const text = rawLine.replace(timeRegex, "").trim();
        if (!text) continue;
        for (const m of matches) {
            const min = parseInt(m[1]);
            const sec = parseInt(m[2]);
            const ms = parseInt(m[3]);
            const time = min * 60 + sec + ms / (m[3].length === 3 ? 1000 : 100);
            lines.push({ time, text });
        }
    }
    lines.sort((a, b) => a.time - b.time);
    return lines;
}

function findCurrentLyric(lines: LyricLine[], currentTime: number): { current: LyricLine | null; next: LyricLine | null } {
    if (lines.length === 0) return { current: null, next: null };
    let current: LyricLine | null = null;
    let next: LyricLine | null = null;
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].time <= currentTime) {
            current = lines[i];
            next = lines[i + 1] || null;
        } else {
            if (!next) next = lines[i];
            break;
        }
    }
    return { current, next };
}

// ── 音乐系统消息生成 ──────────────────────────────────────

export type MusicSystemAction = "play" | "resume" | "favorite" | "switch";

/**
 * 向聊天记录中插入一条音乐系统消息
 * @param actor "character" | "user" — 谁执行了操作
 */
export function pushMusicSystemMessage(
    sessionId: string,
    type: MusicSystemAction,
    actor: string,
    track: ListenTogetherTrack,
    playlistName?: string,
): void {
    try {
        let content = "";
        let action = "播放了";
        switch (type) {
            case "play":
                action = "播放了";
                content = `${actor} 播放了《${track.title}》${track.artist ? `—${track.artist}` : ""}`;
                break;
            case "switch":
                action = "切换了";
                content = `${actor} 切换了《${track.title}》${track.artist ? `—${track.artist}` : ""}`;
                break;
            case "resume":
                action = "继续播放";
                content = `${actor} 继续播放《${track.title}》${track.artist ? `—${track.artist}` : ""}`;
                break;
            case "favorite":
                action = "收藏了";
                content = `${actor} 收藏了《${track.title}》${track.artist ? `—${track.artist}` : ""}`;
                if (playlistName) {
                    content += ` 收藏到 歌单-${playlistName}-`;
                }
                break;
        }
        pushChatMessage({
            sessionId,
            role: "system",
            content,
            mediaType: "music_system" as any,
            mediaData: {
                musicTitle: track.title,
                musicArtist: track.artist,
                musicSource: track.source || "网易云导入",
                musicAction: type,
                musicActor: actor,
                playlistName,
            } as any,
        });
    } catch (e) {
        console.warn("[listen-together] pushMusicSystemMessage failed:", e);
    }
}

// ── 心电图跳动爱心动画 ─────────────────────────────────────

const ECGHeartbeat = memo(function ECGHeartbeat({ beating = true }: { beating?: boolean }) {
    return (
        <div className={`lt-heartbeat-wrap ${beating ? "lt-heartbeat-active" : "lt-heartbeat-idle"}`}>
            <svg
                width="56"
                height="32"
                viewBox="0 0 56 32"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                className="lt-ecg-svg"
            >
                <path
                    d="M2 16 L14 16 L18 8 L22 24 L26 4 L30 28 L34 16 L54 16"
                    stroke="var(--lt-heart-color, #FF6B8A)"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    fill="none"
                    className="lt-ecg-line"
                />
            </svg>
            <Heart
                size={22}
                fill="var(--lt-heart-color, #FF6B8A)"
                color="var(--lt-heart-color, #FF6B8A)"
                className="lt-heart-pulse"
            />
        </div>
    );
});

// ── 顶部状态栏组件（常驻显示双头像+爱心） ─────────────────────

interface ListenTogetherStatusBarProps {
    userAvatar?: string;
    userNickname: string;
    charAvatar?: string;
    charName: string;
    elapsedSeconds?: number;
    currentTrack?: ListenTogetherTrack | null;
    isPlaying: boolean;
    onClose?: () => void;
    showTimer?: boolean;
    showClose?: boolean;
}

export const ListenTogetherStatusBar = memo(function ListenTogetherStatusBar({
    userAvatar,
    userNickname,
    charAvatar,
    charName,
    elapsedSeconds = 0,
    isPlaying,
    onClose,
    showTimer = true,
    showClose = true,
}: ListenTogetherStatusBarProps) {
    const minutes = Math.floor(elapsedSeconds / 60);
    const seconds = elapsedSeconds % 60;
    const timeStr = minutes > 0 ? `一起听了 ${minutes}分${seconds}秒` : `一起听了 ${seconds}秒`;

    return (
        <div className="lt-status-bar lt-status-bar-permanent">
            <div className="lt-header-avatars">
                <div className="lt-header-avatar lt-header-avatar-user">
                    {userAvatar ? (
                        <img src={userAvatar} alt={userNickname} className="lt-header-avatar-img" />
                    ) : (
                        <span className="lt-header-avatar-fallback">{userNickname[0] || "?"}</span>
                    )}
                </div>
                <div className="lt-header-center">
                    <ECGHeartbeat beating={isPlaying} />
                    {showTimer && elapsedSeconds > 0 && (
                        <span className="lt-header-timer">{timeStr}</span>
                    )}
                </div>
                <div className="lt-header-avatar lt-header-avatar-char">
                    {charAvatar ? (
                        <img src={charAvatar} alt={charName} className="lt-header-avatar-img" />
                    ) : (
                        <span className="lt-header-avatar-fallback">{charName[0] || "?"}</span>
                    )}
                </div>
            </div>
            {showClose && onClose && (
                <button
                    className="lt-close-btn"
                    onClick={onClose}
                    aria-label="退出一起听"
                    title="退出一起听"
                >
                    <X size={16} strokeWidth={2} />
                </button>
            )}
        </div>
    );
});

// ── 全局浮窗组件（跨App持久显示） ──────────────────────────

export function ListenTogetherOverlay({ onClose }: { onClose: () => void }) {
    const state = useLtOverlayState();
    const [expanded, setExpanded] = useState(false);
    const [lyrics, setLyrics] = useState<LyricLine[]>([]);

    // 解析歌词
    useEffect(() => {
        if (state.track?.lyrics) {
            setLyrics(parseLrc(state.track.lyrics));
        } else {
            setLyrics([]);
        }
    }, [state.track?.lyrics]);

    // 轮询音乐播放进度
    const [progressTime, setProgressTime] = useState(state.currentTime);
    useEffect(() => {
        if (!state.active || !state.isPlaying) return;
        const interval = setInterval(() => {
            try {
                const bridge = (window as any).__musicControlBridge;
                if (bridge?.getState) {
                    const s = bridge.getState();
                    if (s?.currentTime != null) {
                        setProgressTime(s.currentTime);
                    }
                }
            } catch { /* 静默 */ }
        }, 1000);
        return () => clearInterval(interval);
    }, [state.active, state.isPlaying]);

    if (!state.active || !state.track) return null;

    const track = state.track;
    const currentTime = progressTime || state.currentTime;
    const { current: currentLyric, next: nextLyric } = findCurrentLyric(lyrics, currentTime);
    const mins = Math.floor(state.elapsedSeconds / 60);
    const secs = state.elapsedSeconds % 60;

    return (
        <div className={`lt-overlay ${expanded ? "lt-overlay-expanded" : ""}`}>
            <div className="lt-overlay-card" onClick={() => setExpanded(!expanded)}>
                <div className="lt-overlay-cover">
                    {track.coverUrl ? (
                        <img src={track.coverUrl} alt="" className="lt-overlay-cover-img" />
                    ) : (
                        <Music size={22} strokeWidth={1.5} color="var(--c-text)" />
                    )}
                </div>
                <div className="lt-overlay-info">
                    <div className="lt-overlay-title-row">
                        <ECGHeartbeat beating={state.isPlaying} />
                        <span className="lt-overlay-title">{track.title}</span>
                    </div>
                    <div className="lt-overlay-meta">
                        <span className="lt-overlay-artist">{track.artist || "未知歌手"}</span>
                        <span className="lt-overlay-timer">
                            一起听了 {mins > 0 ? `${mins}分${secs}秒` : `${secs}秒`}
                        </span>
                        <span className={`lt-overlay-status ${state.isPlaying ? "playing" : "paused"}`}>
                            {state.isPlaying ? (
                                <><span className="lt-playing-dot" />正在播放</>
                            ) : (
                                <><Pause size={10} strokeWidth={2} />已暂停</>
                            )}
                        </span>
                    </div>
                    {/* 单行歌词 */}
                    <div className="lt-overlay-lyric-single">
                        {currentLyric?.text || "♪"}
                    </div>
                </div>
                <button
                    className="lt-overlay-close"
                    onClick={(e) => { e.stopPropagation(); onClose(); }}
                    aria-label="退出一起听"
                    title="退出一起听"
                >
                    <X size={16} strokeWidth={2} />
                </button>
                <button
                    className="lt-overlay-expand"
                    onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
                    aria-label={expanded ? "收起" : "展开"}
                >
                    {expanded ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
                </button>
            </div>
            {/* 展开时显示完整歌词 */}
            {expanded && lyrics.length > 0 && (
                <div className="lt-overlay-lyrics-full">
                    {lyrics.map((line, i) => (
                        <div
                            key={i}
                            className={`lt-overlay-lyric-line ${currentLyric?.text === line.text ? "active" : ""}`}
                        >
                            {line.text}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

// ── 音乐系统消息渲染组件 ───────────────────────────────────

interface MusicSystemMessageProps {
    msg: ChatMessage;
}

export const MusicSystemMessage = memo(function MusicSystemMessage({ msg }: MusicSystemMessageProps) {
    const data = (msg.mediaData || {}) as Record<string, any>;
    const title = data.musicTitle || "";
    const artist = data.musicArtist || "";
    const source = data.musicSource || "网易云导入";
    const action = data.musicAction || "play";
    const actor = data.musicActor || "";
    const playlist = data.playlistName;
    const content = msg.content || "";

    let actionText = "";
    switch (action) {
        case "play":
            actionText = "播放了";
            break;
        case "switch":
            actionText = "切换了";
            break;
        case "resume":
            actionText = "继续播放";
            break;
        case "favorite":
            actionText = "收藏了";
            break;
        default:
            actionText = "播放了";
    }

    // 从 content 中提取操作者名称
    let actorName = "";
    try {
        const parts = content.split(/播放了|收藏了|继续播放|切换了/);
        actorName = parts[0]?.trim() || actor || "";
    } catch { /* 静默 */ }

    return (
        <div className="lt-music-system-msg">
            <div className="lt-music-system-icon">
                <Music size={14} strokeWidth={1.5} />
            </div>
            <div className="lt-music-system-content">
                {actorName && <span className="lt-music-system-action">{actorName}</span>}
                <span className="lt-music-system-action-text">{actionText}</span>
                <span className="lt-music-system-title">《{title}》</span>
                {artist && <span className="lt-music-system-artist">—{artist}</span>}
                <span className="lt-music-system-source">[{source}]</span>
                {playlist && <span className="lt-music-system-playlist"> 收藏到 歌单-{playlist}-</span>}
            </div>
        </div>
    );
});

// ── 计时器 Hook ────────────────────────────────────────────

export function useListenTogetherTimer(
    active: boolean,
    isPlaying: boolean,
    startTime: number | null,
    pausedDuration: number,
) {
    const [elapsed, setElapsed] = useState(0);
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const pauseStartRef = useRef<number | null>(null);
    const accumulatedPauseRef = useRef(pausedDuration);

    useEffect(() => {
        accumulatedPauseRef.current = pausedDuration;
    }, [pausedDuration]);

    useEffect(() => {
        if (!active || !startTime) {
            setElapsed(0);
            return;
        }

        const updateElapsed = () => {
            const now = Date.now();
            const totalPause = accumulatedPauseRef.current + (pauseStartRef.current ? now - pauseStartRef.current : 0);
            setElapsed(Math.max(0, Math.floor((now - startTime - totalPause) / 1000)));
        };

        if (isPlaying) {
            if (pauseStartRef.current !== null) {
                accumulatedPauseRef.current += Date.now() - pauseStartRef.current;
                pauseStartRef.current = null;
            }
            updateElapsed();
            intervalRef.current = setInterval(updateElapsed, 1000);
        } else {
            if (pauseStartRef.current === null) {
                pauseStartRef.current = Date.now();
            }
            updateElapsed();
        }

        return () => {
            if (intervalRef.current) {
                clearInterval(intervalRef.current);
                intervalRef.current = null;
            }
        };
    }, [active, isPlaying, startTime]);

    useEffect(() => {
        if (!active) {
            pauseStartRef.current = null;
            accumulatedPauseRef.current = 0;
        }
    }, [active]);

    return elapsed;
}

// ── 检查消息是否为音乐系统消息 ──────────────────────────────

export function isMusicSystemMessage(msg: ChatMessage): boolean {
    return (msg.mediaType as string) === "music_system";
}
