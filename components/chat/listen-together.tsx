"use client";

import { useState, useEffect, useRef, useCallback, memo } from "react";
import { X, Headphones, Heart, Play, Pause, Music } from "lucide-react";
import type { ChatMessage } from "@/lib/chat-storage";
import { pushChatMessage } from "@/lib/chat-storage";

// ── 类型定义 ──────────────────────────────────────────────

export interface ListenTogetherTrack {
    title: string;
    artist?: string;
    coverUrl?: string;
    source?: string; // "netease" | "local" | "我喜欢的音乐"
}

export interface ListenTogetherState {
    active: boolean;
    startTime: number | null; // 一起听开始时间戳
    pausedDuration: number; // 已暂停的累计秒数
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

// ── 音乐系统消息生成 ──────────────────────────────────────

/**
 * 向聊天记录中插入一条音乐系统消息
 */
export function pushMusicSystemMessage(
    sessionId: string,
    type: "play" | "resume" | "favorite",
    charName: string,
    track: ListenTogetherTrack,
    playlistName?: string,
): ChatMessage {
    let content = "";
    switch (type) {
        case "play":
            content = `${charName} 播放了《${track.title}》${track.artist ? `—${track.artist}` : ""}`;
            break;
        case "resume":
            content = `${charName} 继续播放《${track.title}》${track.artist ? `—${track.artist}` : ""}`;
            break;
        case "favorite":
            content = `${charName} 收藏了《${track.title}》${track.artist ? `—${track.artist}` : ""}`;
            if (playlistName) {
                content += ` 收藏到 歌单-${playlistName}-`;
            }
            break;
    }
    return pushChatMessage({
        sessionId,
        role: "system",
        content,
        mediaType: "music_system",
        mediaData: {
            musicTitle: track.title,
            musicArtist: track.artist,
            musicSource: track.source || "网易云导入",
            musicAction: type,
            playlistName,
        },
    });
}

// ── 心电图跳动爱心动画 ─────────────────────────────────────

const ECGHeartbeat = memo(function ECGHeartbeat() {
    return (
        <div className="lt-heartbeat-wrap">
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
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    fill="none"
                    className="lt-ecg-line"
                />
            </svg>
            <Heart
                size={20}
                fill="var(--lt-heart-color, #FF6B8A)"
                color="var(--lt-heart-color, #FF6B8A)"
                className="lt-heart-pulse"
            />
        </div>
    );
});

// ── 顶部状态栏组件 ─────────────────────────────────────────

interface ListenTogetherStatusBarProps {
    userAvatar?: string;
    userNickname: string;
    charAvatar?: string;
    charName: string;
    elapsedSeconds: number;
    currentTrack: ListenTogetherTrack | null;
    isPlaying: boolean;
    onClose: () => void;
}

export const ListenTogetherStatusBar = memo(function ListenTogetherStatusBar({
    userAvatar,
    userNickname,
    charAvatar,
    charName,
    elapsedSeconds,
    currentTrack,
    isPlaying,
    onClose,
}: ListenTogetherStatusBarProps) {
    const minutes = Math.floor(elapsedSeconds / 60);
    const seconds = elapsedSeconds % 60;
    const timeStr = `${minutes}分钟`;

    return (
        <div className="lt-status-bar">
            <div className="lt-avatars">
                <div className="lt-avatar lt-avatar-user">
                    {userAvatar ? (
                        <img src={userAvatar} alt={userNickname} className="lt-avatar-img" />
                    ) : (
                        <span className="lt-avatar-fallback">{userNickname[0] || "?"}</span>
                    )}
                    <span className="lt-avatar-name">{userNickname}</span>
                </div>
                <ECGHeartbeat />
                <div className="lt-avatar lt-avatar-char">
                    {charAvatar ? (
                        <img src={charAvatar} alt={charName} className="lt-avatar-img" />
                    ) : (
                        <span className="lt-avatar-fallback">{charName[0] || "?"}</span>
                    )}
                    <span className="lt-avatar-name">{charName}</span>
                </div>
            </div>
            <div className="lt-timer-info">
                <span className="lt-timer-label">一起听了</span>
                <span className="lt-timer-value">{timeStr}</span>
            </div>
            <button
                className="lt-close-btn"
                onClick={onClose}
                aria-label="退出一起听"
                title="退出一起听"
            >
                <X size={16} strokeWidth={2} />
            </button>
        </div>
    );
});

// ── 悬浮播放预览卡片 ───────────────────────────────────────

interface ListenTogetherFloatingCardProps {
    track: ListenTogetherTrack | null;
    isPlaying: boolean;
    charName: string;
}

export const ListenTogetherFloatingCard = memo(function ListenTogetherFloatingCard({
    track,
    isPlaying,
    charName,
}: ListenTogetherFloatingCardProps) {
    if (!track) return null;
    return (
        <div className="lt-floating-card">
            <div className="lt-floating-card-cover">
                {track.coverUrl ? (
                    <img src={track.coverUrl} alt="" className="lt-floating-card-cover-img" />
                ) : (
                    <Music size={20} strokeWidth={1.5} color="var(--c-text)" />
                )}
            </div>
            <div className="lt-floating-card-info">
                <div className="lt-floating-card-title">{track.title}</div>
                <div className="lt-floating-card-artist">
                    {track.artist || "未知歌手"}
                </div>
                <div className="lt-floating-card-source">
                    <Headphones size={11} strokeWidth={1.5} />
                    <span>{track.source || "网易云导入"}</span>
                    <span className="lt-floating-card-status">
                        {isPlaying ? (
                            <>
                                <span className="lt-playing-dot" />
                                正在播放
                            </>
                        ) : (
                            <>
                                <Pause size={10} strokeWidth={2} />
                                已暂停
                            </>
                        )}
                    </span>
                </div>
            </div>
        </div>
    );
});

// ── 音乐系统消息渲染组件 ───────────────────────────────────

interface MusicSystemMessageProps {
    msg: ChatMessage;
}

export const MusicSystemMessage = memo(function MusicSystemMessage({ msg }: MusicSystemMessageProps) {
    const data = msg.mediaData || {};
    const title = data.musicTitle || "";
    const artist = data.musicArtist || "";
    const source = data.musicSource || "网易云导入";
    const action = data.musicAction || "play";
    const playlist = data.playlistName;

    let actionText = "";
    switch (action) {
        case "play":
            actionText = "播放了";
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

    return (
        <div className="lt-music-system-msg">
            <div className="lt-music-system-icon">
                <Music size={14} strokeWidth={1.5} />
            </div>
            <div className="lt-music-system-content">
                <span className="lt-music-system-action">{msg.content.split("播放了")[0].split("收藏了")[0].split("继续播放")[0].trim()}</span>
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
            setElapsed(Math.floor((now - startTime - totalPause) / 1000));
        };

        if (isPlaying) {
            // 如果从暂停恢复，累计暂停时间
            if (pauseStartRef.current !== null) {
                accumulatedPauseRef.current += Date.now() - pauseStartRef.current;
                pauseStartRef.current = null;
            }
            updateElapsed();
            intervalRef.current = setInterval(updateElapsed, 1000);
        } else {
            // 暂停时记录暂停开始时间
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

    // 清理时恢复
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
    return msg.mediaType === "music_system";
}
