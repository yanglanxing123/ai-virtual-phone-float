import type { MusicTrack } from "./music-storage";
import type { PlayMode } from "./music-context";

export type MusicActionSource = "user" | "character" | "autoplay" | "system";

export type MusicActionSnapshot = {
    id: number;
    type: "play" | "resume" | "pause" | "switch" | "stop";
    source: MusicActionSource;
    trackId?: string;
};

export type MusicControlSnapshot = {
    currentTrack: MusicTrack | null;
    isPlaying: boolean;
    currentTime: number;
    duration: number;
    playMode: PlayMode;
    queue: MusicTrack[];
    volume: number;
    /** Latest explicit playback action. Monotonic id lets consumers process it exactly once. */
    lastAction: MusicActionSnapshot | null;
};

export type MusicControlBridge = {
    getState: () => MusicControlSnapshot;
    playTrack: (track: MusicTrack, source?: MusicActionSource) => Promise<{ ok: boolean; message: string; track?: MusicTrack }>;
    playByQuery: (query: string, artist?: string, source?: MusicActionSource) => Promise<{ ok: boolean; message: string; track?: MusicTrack }>;
    addToQueue: (tracks: MusicTrack[], options?: { replace?: boolean; playFirst?: boolean }) => Promise<{ ok: boolean; message: string; queue: MusicTrack[] }>;
    pause: (source?: MusicActionSource) => void;
    resume: (source?: MusicActionSource) => void;
    stop: (source?: MusicActionSource) => void;
    next: (source?: MusicActionSource) => void;
    prev: (source?: MusicActionSource) => void;
    setPlayMode: (mode: PlayMode) => void;
};

let bridge: MusicControlBridge | null = null;

export function registerMusicControlBridge(nextBridge: MusicControlBridge | null): void {
    bridge = nextBridge;
}

export function getMusicControlBridge(): MusicControlBridge | null {
    return bridge;
}
