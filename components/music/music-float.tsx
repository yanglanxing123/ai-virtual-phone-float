// components/music/music-float.tsx — Floating music control widget (draggable vinyl) + lyrics
"use client";

import { useCallback, useEffect, useRef, useState, memo } from "react";
import { useMusicControlsOptional } from "@/lib/music-context";

const DRAG_START_THRESHOLD = 6;
const SWIPE_DISMISS_EDGE_X = 4;
const SWIPE_DISMISS_SPEED = 1.5; // px/ms
const SWIPE_DISMISS_ARMING_X = 88;
const SWIPE_INERTIA_MS = 140;
const SWIPE_VELOCITY_RECENT_MS = 180;

// ── LRC 歌词解析 ──────────────────────────────────────────

type LyricLine = { time: number; text: string };

function parseLrc(lrc: string): LyricLine[] {
    if (!lrc) return [];
    const lines: LyricLine[] = [];
    const timeRe = /\[(\d{1,2}):(\d{1,2})(?:\.(\d{1,3}))?\]/g;
    for (const raw of lrc.split("\n")) {
        const matches = [...raw.matchAll(timeRe)];
        if (matches.length === 0) continue;
        const text = raw.replace(timeRe, "").trim();
        for (const m of matches) {
            const min = parseInt(m[1], 10);
            const sec = parseInt(m[2], 10);
            const ms = m[3] ? parseInt(m[3].padEnd(3, "0"), 10) : 0;
            lines.push({ time: min * 60 + sec + ms / 1000, text });
        }
    }
    lines.sort((a, b) => a.time - b.time);
    return lines;
}

function findCurrentLyric(lines: LyricLine[], currentTime: number): { current: LyricLine | null; next: LyricLine | null } {
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

// ── 歌词行组件 ──

const LyricLineView = memo(function LyricLineView({ text }: { text: string }) {
    if (!text) return <span className="music-float-lyric-placeholder">♪</span>;
    return <span className="music-float-lyric-text">{text}</span>;
});

// ── 主组件 ──

export default function MusicFloat({ hidden }: { hidden?: boolean }) {
    const player = useMusicControlsOptional();
    const floatRef = useRef<HTMLDivElement>(null);
    const [pos, setPos] = useState({ x: 310, y: 680 });
    const dragRef = useRef<{
        pointerId: number | null; active: boolean;
        startX: number; startY: number; origX: number; origY: number;
        lastX: number; lastTime: number;
        lastLeftSpeed: number; lastLeftSpeedTime: number;
        moved: boolean; startedOnInfo: boolean;
    }>({
        pointerId: null,
        active: false,
        startX: 0,
        startY: 0,
        origX: 0,
        origY: 0,
        lastX: 0,
        lastTime: 0,
        lastLeftSpeed: 0,
        lastLeftSpeedTime: 0,
        moved: false,
        startedOnInfo: false,
    });
    const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [expanded, setExpanded] = useState(false);
    const [dismissing, setDismissing] = useState(false);

    // ── 歌词状态 ──
    const [lyrics, setLyrics] = useState<LyricLine[]>([]);
    const [progressTime, setProgressTime] = useState(0);

    // 解析歌词
    useEffect(() => {
        const lrc = player?.currentTrack?.lyrics;
        if (lrc) {
            setLyrics(parseLrc(lrc));
        } else {
            setLyrics([]);
        }
    }, [player?.currentTrack?.lyrics]);

    // 轮询播放进度
    useEffect(() => {
        if (!player || !player.isPlaying) return;
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
        }, 500);
        return () => clearInterval(interval);
    }, [player, player?.isPlaying]);

    const clampPos = useCallback((x: number, y: number) => {
        const el = floatRef.current;
        const parent = el?.closest("[data-ui='phone-screen']") as HTMLElement | null;
        if (!el || !parent) return { x, y };
        const pw = parent.clientWidth;
        const ph = parent.clientHeight;
        const ew = el.offsetWidth;
        const eh = el.offsetHeight;
        return {
            x: Math.max(0, Math.min(x, pw - ew)),
            y: Math.max(0, Math.min(y, ph - eh)),
        };
    }, []);

    const dismissFloat = useCallback(() => {
        if (!player) return;
        if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
        setDismissing(true);
        dismissTimerRef.current = setTimeout(() => {
            player.dismissFloat();
            setDismissing(false);
            setExpanded(false);
            dismissTimerRef.current = null;
        }, 250);
    }, [player]);

    useEffect(() => () => {
        if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    }, []);

    const handlePointerDown = useCallback((e: React.PointerEvent) => {
        const target = e.target as HTMLElement;
        // Let transport buttons keep their native click behavior.
        if (target.closest("button")) return;
        e.preventDefault();
        e.stopPropagation();
        floatRef.current?.setPointerCapture?.(e.pointerId);
        const now = performance.now();
        dragRef.current = {
            pointerId: e.pointerId,
            active: true,
            startX: e.clientX, startY: e.clientY,
            origX: pos.x, origY: pos.y,
            lastX: e.clientX,
            lastTime: now,
            lastLeftSpeed: 0,
            lastLeftSpeedTime: 0,
            moved: false,
            startedOnInfo: Boolean(target.closest(".music-float-info")),
        };
    }, [pos]);

    const handlePointerMove = useCallback((e: React.PointerEvent) => {
        const d = dragRef.current;
        if (!d.active || d.pointerId !== e.pointerId) return;
        const dx = e.clientX - d.startX;
        const dy = e.clientY - d.startY;
        if (Math.abs(dx) > DRAG_START_THRESHOLD || Math.abs(dy) > DRAG_START_THRESHOLD) d.moved = true;
        if (d.moved) {
            const nextPos = clampPos(d.origX + dx, d.origY + dy);
            const now = performance.now();
            const dt = Math.max(1, now - d.lastTime);
            const stepDx = e.clientX - d.lastX;
            const leftSpeed = stepDx < 0 ? Math.abs(stepDx) / dt : 0;
            if (leftSpeed > 0) {
                d.lastLeftSpeed = leftSpeed;
                d.lastLeftSpeedTime = now;
            }
            d.lastX = e.clientX;
            d.lastTime = now;
            setPos(nextPos);
        }
    }, [clampPos]);

    const finishPointer = useCallback((e: React.PointerEvent) => {
        const d = dragRef.current;
        if (!d.active || d.pointerId !== e.pointerId) return;
        if (floatRef.current?.hasPointerCapture?.(e.pointerId)) {
            floatRef.current.releasePointerCapture(e.pointerId);
        }
        d.active = false;
        d.pointerId = null;
        const dx = e.clientX - d.startX;
        const dy = e.clientY - d.startY;
        const finalPos = clampPos(d.origX + dx, d.origY + dy);
        const now = performance.now();
        const dt = Math.max(1, now - d.lastTime);
        const stepDx = e.clientX - d.lastX;
        const leftSpeed = stepDx < 0 ? Math.abs(stepDx) / dt : 0;
        const recentMoveSpeed = now - d.lastLeftSpeedTime <= SWIPE_VELOCITY_RECENT_MS ? d.lastLeftSpeed : 0;
        const effectiveLeftSpeed = Math.max(leftSpeed, recentMoveSpeed);
        const inertialX = finalPos.x - effectiveLeftSpeed * SWIPE_INERTIA_MS;
        const shouldDismiss = d.moved
            && finalPos.x <= SWIPE_DISMISS_ARMING_X
            && effectiveLeftSpeed >= SWIPE_DISMISS_SPEED
            && inertialX <= SWIPE_DISMISS_EDGE_X;

        if (shouldDismiss) {
            dismissFloat();
            return;
        }

        if (d.moved) {
            setPos(finalPos);
            return;
        }

        if (!d.moved && player) {
            if (d.startedOnInfo) {
                player.openFullPlayer();
                return;
            }

            setExpanded(prev => {
                requestAnimationFrame(() => setPos(p => clampPos(p.x, p.y)));
                return !prev;
            });
        }
    }, [player, clampPos, dismissFloat]);

    const handlePointerUp = useCallback((e: React.PointerEvent) => finishPointer(e), [finishPointer]);
    const handlePointerCancel = useCallback((e: React.PointerEvent) => finishPointer(e), [finishPointer]);

    if (!player || !player.currentTrack || hidden || player.floatDismissed) return null;

    const track = player.currentTrack;
    const { current: currentLyric } = findCurrentLyric(lyrics, progressTime);

    return (
        <div
            ref={floatRef}
            className="music-float-wrapper"
            style={{ left: pos.x, top: pos.y }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerCancel}
        >
            <div
                className="music-float"
                {...(expanded ? { "data-expanded": "" } : {})}
                {...(dismissing ? { "data-dismissing": "" } : {})}
            >
                <div className="music-float-inner">
                    {/* Cover art */}
                    <div className="music-float-cover-wrap" {...(player.isPlaying ? { "data-playing": "" } : {})}>
                        <div className="music-float-vinyl-groove music-float-vinyl-groove-1" />
                        <div className="music-float-vinyl-groove music-float-vinyl-groove-2" />
                        <div className="music-float-vinyl-center">
                            {track.coverUrl ? (
                                <img src={track.coverUrl} alt="" className="music-float-cover-img" draggable={false} />
                            ) : (
                                <div className="music-float-cover-placeholder">
                                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                                        <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
                                    </svg>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Track Info + Lyrics */}
                    <div className="music-float-info">
                        <div className="music-float-title">{track.title}</div>
                        <div className="music-float-artist">{track.artist}</div>
                        {/* 歌词单行（展开时内部显示） */}
                        <div className="music-float-lyric" key={currentLyric?.time ?? "none"}>
                            <LyricLineView text={currentLyric?.text || ""} />
                        </div>
                    </div>

                    {/* Compact Controls */}
                    <div className="music-float-controls">
                        <button className="music-float-btn" onClick={(e) => { e.stopPropagation(); player.prev(); }}>
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" />
                            </svg>
                        </button>
                        <button className="music-float-btn music-float-btn-play" onClick={(e) => { e.stopPropagation(); player.togglePlay(); }}>
                            {player.isPlaying ? (
                                <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M6 4h4v16H6zm8 0h4v16h-4z" />
                                </svg>
                            ) : (
                                <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M8 5v14l11-7z" />
                                </svg>
                            )}
                        </button>
                        <button className="music-float-btn" onClick={(e) => { e.stopPropagation(); player.next(); }}>
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M6 18l8.5-6L6 6v12zm8.5 0h2V6h-2v12z" />
                            </svg>
                        </button>
                    </div>
                </div>
            </div>

            {/* 歌词框 — 圆形组件下方常驻显示 */}
            {lyrics.length > 0 && (
                <div className="music-float-lyric-box" key={currentLyric?.time ?? "none"}>
                    <span className="music-float-lyric-box-text">
                        {currentLyric?.text || "♪"}
                    </span>
                </div>
            )}
        </div>
    );
}
