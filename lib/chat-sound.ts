// lib/chat-sound.ts
// 聊天消息提示音系统 — 支持：
// 1. 内置程序化生成提示音（保留原有"叮咚"和特别关心"流水声"）
// 2. 自由调节音量（0–200%）
// 3. 绑定本地音频文件作为自定义提示音
// 4. 区分普通提示音和特别关心提示音

import { kvGet, kvSet, registerKvMigration } from "@/lib/kv-db";

// ── 类型定义 ──────────────────────────────────────────────

export interface ChatSoundSettings {
    /** 普通消息音量 0–200（百分比，100=原始音量） */
    normalVolume: number;
    /** 特别关心消息音量 0–200 */
    specialVolume: number;
    /** 普通消息自定义提示音（本地音频 data URL，为空则用内置） */
    normalCustomSoundUrl: string | null;
    /** 特别关心自定义提示音（本地音频 data URL，为空则用内置） */
    specialCustomSoundUrl: string | null;
    /** 普通消息自定义提示音文件名 */
    normalCustomSoundName: string | null;
    /** 特别关心自定义提示音文件名 */
    specialCustomSoundName: string | null;
}

const DEFAULT_SOUND_SETTINGS: ChatSoundSettings = {
    normalVolume: 200,
    specialVolume: 200,
    normalCustomSoundUrl: null,
    specialCustomSoundUrl: null,
    normalCustomSoundName: null,
    specialCustomSoundName: null,
};

const SOUND_SETTINGS_KEY = "ai_phone_chat_sound_settings_v1";
registerKvMigration(SOUND_SETTINGS_KEY);

// ── 设置持久化 ──────────────────────────────────────────────

export function loadChatSoundSettings(): ChatSoundSettings {
    if (typeof window === "undefined") return DEFAULT_SOUND_SETTINGS;
    try {
        const raw = kvGet(SOUND_SETTINGS_KEY);
        if (!raw) return DEFAULT_SOUND_SETTINGS;
        const parsed = JSON.parse(raw);
        // 确保迁移后音量至少为 200（用户要求）
        const result = { ...DEFAULT_SOUND_SETTINGS, ...parsed };
        // 如果音量是旧默认值 100，升级为 200
        if (result.normalVolume === 100) result.normalVolume = 200;
        if (result.specialVolume === 100) result.specialVolume = 200;
        return result;
    } catch {
        return DEFAULT_SOUND_SETTINGS;
    }
}

export function saveChatSoundSettings(settings: ChatSoundSettings): void {
    if (typeof window === "undefined") return;
    try {
        kvSet(SOUND_SETTINGS_KEY, JSON.stringify(settings));
        window.dispatchEvent(new CustomEvent("chat-sound-settings-updated", { detail: settings }));
    } catch { /* 静默 */ }
}

export function updateChatSoundSettings(patch: Partial<ChatSoundSettings>): ChatSoundSettings {
    const current = loadChatSoundSettings();
    const next = { ...current, ...patch };
    saveChatSoundSettings(next);
    return next;
}

// ── Web Audio 内置提示音 ──────────────────────────────────────

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
    if (typeof window === "undefined") return null;
    if (!audioCtx) {
        try {
            const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
            audioCtx = new AC();
        } catch {
            return null;
        }
    }
    // 每次都尝试 resume（浏览器可能因策略挂起 AudioContext）
    if (audioCtx.state === "suspended") {
        audioCtx.resume().catch(() => {});
    }
    return audioCtx;
}

type ToneSpec = {
    freq: number;
    duration: number;
    delay: number;
    type?: OscillatorType;
    volume?: number;
    /** 频率扫描结束值（用于创建滑音效果） */
    freqEnd?: number;
};

/**
 * 播放一组音调序列（内置提示音使用）
 * @param volumePercent 音量百分比 0–200（100=原始）
 */
function playToneSequence(tones: ToneSpec[], volumePercent: number): void {
    const ctx = getAudioContext();
    if (!ctx) return;

    const volMultiplier = Math.max(0, Math.min(2, volumePercent / 100));
    if (volMultiplier === 0) return; // 音量为0不播放

    const now = ctx.currentTime;
    const masterGain = ctx.createGain();
    // 提高基础音量从 0.3 到 0.5，让提示音更响亮
    masterGain.gain.value = 0.5 * volMultiplier;
    masterGain.connect(ctx.destination);

    for (const tone of tones) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = tone.type || "sine";
        osc.frequency.setValueAtTime(tone.freq, now + tone.delay);

        // 频率扫描（用于创建水滴效果）
        if (tone.freqEnd && tone.freqEnd !== tone.freq) {
            osc.frequency.exponentialRampToValueAtTime(
                tone.freqEnd,
                now + tone.delay + tone.duration,
            );
        }

        const vol = (tone.volume ?? 0.4) * volMultiplier;
        const startAt = now + tone.delay;
        const endAt = startAt + tone.duration;

        gain.gain.setValueAtTime(0, startAt);
        gain.gain.linearRampToValueAtTime(vol, startAt + 0.008);
        gain.gain.exponentialRampToValueAtTime(0.0001, endAt);

        osc.connect(gain);
        gain.connect(masterGain);
        osc.start(startAt);
        osc.stop(endAt + 0.02);
    }
}

/**
 * 仿QQ经典提示音 "叮咚" — 两个音调，清脆悦耳
 */
function playDefaultMessageSound(volumePercent: number): void {
    playToneSequence([
        { freq: 1046.5, duration: 0.12, delay: 0,    type: "sine", volume: 0.35 }, // C6
        { freq: 1318.5, duration: 0.20, delay: 0.10, type: "sine", volume: 0.30 }, // E6
    ], volumePercent);
}

/**
 * 仿QQ特别关心提示音 — "流水声"水滴音效
 * 使用频率快速下降模拟水滴入水，加上短促噪声模拟水花
 */
function playSpecialCareSound(volumePercent: number): void {
    const ctx = getAudioContext();
    if (!ctx) return;

    const volMultiplier = Math.max(0, Math.min(2, volumePercent / 100));
    if (volMultiplier === 0) return;

    const now = ctx.currentTime;
    const masterGain = ctx.createGain();
    masterGain.gain.value = 0.5 * volMultiplier;
    masterGain.connect(ctx.destination);

    // 1. 水滴主音 — 高频快速下降（模拟水滴）
    const dropOsc = ctx.createOscillator();
    const dropGain = ctx.createGain();
    dropOsc.type = "sine";
    dropOsc.frequency.setValueAtTime(2200, now);
    dropOsc.frequency.exponentialRampToValueAtTime(440, now + 0.15);
    dropGain.gain.setValueAtTime(0, now);
    dropGain.gain.linearRampToValueAtTime(0.4 * volMultiplier, now + 0.005);
    dropGain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    dropOsc.connect(dropGain);
    dropGain.connect(masterGain);
    dropOsc.start(now);
    dropOsc.stop(now + 0.17);

    // 2. 第二个水滴 — 稍微延迟，频率略低
    const drop2Osc = ctx.createOscillator();
    const drop2Gain = ctx.createGain();
    drop2Osc.type = "sine";
    drop2Osc.frequency.setValueAtTime(1800, now + 0.08);
    drop2Osc.frequency.exponentialRampToValueAtTime(380, now + 0.08 + 0.12);
    drop2Gain.gain.setValueAtTime(0, now + 0.08);
    drop2Gain.gain.linearRampToValueAtTime(0.3 * volMultiplier, now + 0.08 + 0.005);
    drop2Gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08 + 0.12);
    drop2Osc.connect(drop2Gain);
    drop2Gain.connect(masterGain);
    drop2Osc.start(now + 0.08);
    drop2Osc.stop(now + 0.08 + 0.14);

    // 3. 水花噪声 — 短促的过滤噪声模拟水花溅起
    try {
        const noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 0.08, ctx.sampleRate);
        const noiseData = noiseBuffer.getChannelData(0);
        for (let i = 0; i < noiseData.length; i++) {
            noiseData[i] = (Math.random() * 2 - 1) * Math.exp(-i / (noiseData.length * 0.3));
        }
        const noiseSource = ctx.createBufferSource();
        noiseSource.buffer = noiseBuffer;
        const noiseFilter = ctx.createBiquadFilter();
        noiseFilter.type = "bandpass";
        noiseFilter.frequency.value = 3000;
        noiseFilter.Q.value = 2;
        const noiseGain = ctx.createGain();
        noiseGain.gain.setValueAtTime(0, now + 0.03);
        noiseGain.gain.linearRampToValueAtTime(0.15 * volMultiplier, now + 0.04);
        noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
        noiseSource.connect(noiseFilter);
        noiseFilter.connect(noiseGain);
        noiseGain.connect(masterGain);
        noiseSource.start(now + 0.03);
        noiseSource.stop(now + 0.12);
    } catch { /* 噪声创建失败不影响主音 */ }
}

// ── 自定义音频文件播放 ──────────────────────────────────────

/** 缓存已加载的 Audio 对象，避免重复创建 */
const audioCache = new Map<string, HTMLAudioElement>();

function playCustomSound(dataUrl: string, volumePercent: number): void {
    if (!dataUrl) return;
    const volMultiplier = Math.max(0, Math.min(2, volumePercent / 100));
    if (volMultiplier === 0) return;

    let audio = audioCache.get(dataUrl);
    if (!audio) {
        audio = new Audio(dataUrl);
        audio.preload = "auto";
        audioCache.set(dataUrl, audio);
    }

    // HTMLAudio volume 范围 0–1，但我们可以通过 Web Audio API 增益超过 1
    audio.volume = Math.min(1, volMultiplier);
    audio.currentTime = 0;

    // 尝试用 Web Audio API 增强音量（允许超过 100%）
    if (volMultiplier > 1) {
        try {
            const ctx = getAudioContext();
            if (ctx) {
                const source = ctx.createMediaElementSource(audio);
                const gain = ctx.createGain();
                gain.gain.value = volMultiplier;
                source.connect(gain);
                gain.connect(ctx.destination);
            }
        } catch {
            // 如果已经连接过，直接用 HTMLAudio 的 volume
        }
    }

    audio.play().catch(() => { /* 静默：可能是浏览器策略阻止 */ });
}

// ── 公开接口 ──────────────────────────────────────────────

/**
 * 播放聊天消息提示音
 * @param isSpecial 是否特别关心联系人 — 使用不同提示音和音量
 * @param settings 可选：传入自定义设置，不传则从存储读取
 */
export function playChatMessageSound(isSpecial?: boolean, settings?: ChatSoundSettings): void {
    try {
        // 每次播放都确保 AudioContext 已解锁
        const ctx = getAudioContext();
        if (ctx && ctx.state === "suspended") {
            ctx.resume().catch(() => {});
        }

        const s = settings || loadChatSoundSettings();

        if (isSpecial) {
            // 特别关心：优先用自定义音频，否则用内置流水声
            if (s.specialCustomSoundUrl) {
                playCustomSound(s.specialCustomSoundUrl, s.specialVolume);
            } else {
                playSpecialCareSound(s.specialVolume);
            }
        } else {
            // 普通消息：优先用自定义音频，否则用内置叮咚
            if (s.normalCustomSoundUrl) {
                playCustomSound(s.normalCustomSoundUrl, s.normalVolume);
            } else {
                playDefaultMessageSound(s.normalVolume);
            }
        }
    } catch {
        // 静默失败：不影响消息收发
    }
}

/**
 * 预览提示音（在设置面板中点击测试时调用）
 * @param isSpecial 测试普通音还是特别关心音
 */
export function previewChatSound(isSpecial: boolean): void {
    // 确保在用户点击时解锁 AudioContext
    const ctx = getAudioContext();
    if (ctx && ctx.state === "suspended") {
        ctx.resume().catch(() => {});
    }
    const settings = loadChatSoundSettings();
    playChatMessageSound(isSpecial, settings);
}

/**
 * 用户首次交互后解锁 AudioContext（部分浏览器要求用户手势触发）
 */
export function unlockChatSound(): void {
    const ctx = getAudioContext();
    if (ctx && ctx.state === "suspended") {
        ctx.resume().catch(() => {});
    }
}

/**
 * 将本地音频文件转换为 data URL
 * @param file 用户选择的音频文件
 * @returns data URL 字符串
 */
export function audioFileToDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        if (!file.type.startsWith("audio/")) {
            reject(new Error("请选择音频文件"));
            return;
        }
        // 限制文件大小 2MB（data URL 编码后约 2.7MB）
        if (file.size > 2 * 1024 * 1024) {
            reject(new Error("音频文件不能超过 2MB"));
            return;
        }
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error("文件读取失败"));
        reader.readAsDataURL(file);
    });
}
