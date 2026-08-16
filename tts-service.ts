// lib/tts-service.ts — 语音合成服务

import type { VoiceApiConfig, ContentAppId } from "./settings-types";
import { loadVoiceConfigs, loadBindingConfig, resolveBinding } from "./settings-storage";

export type VoiceApiConfigResolved = VoiceApiConfig;

/**
 * Resolve the TTS voice config for a character via the binding cascade.
 * Returns null if no voice config is bound or found.
 */
export function resolveVoiceConfig(characterId: string, appId?: ContentAppId): VoiceApiConfig | null {
    const bindings = loadBindingConfig();
    const slot = resolveBinding(bindings, characterId, appId ?? "chat");
    if (!slot.voiceConfigId) return null;

    const configs = loadVoiceConfigs();
    return configs.find(c => c.id === slot.voiceConfigId) || null;
}

/**
 * Synthesize speech from text using the given voice config.
 * Returns an audio Blob (mp3/wav) or null if synthesis failed.
 *
 * Supported providers:
 * - Minimax: REST API → hex-encoded mp3
 * - OpenAI: REST API → binary audio blob
 * - FishAudio: REST API → binary mp3 (uses reference_id for voice selection)
 */
export async function synthesizeSpeech(
    text: string,
    voiceConfig: VoiceApiConfig,
    options?: { emotion?: string },
): Promise<Blob | null> {
    if (!text.trim()) return null;

    const provider = voiceConfig.provider;

    if (provider === "Minimax") {
        return synthesizeMinimax(text, voiceConfig, options?.emotion);
    }

    if (provider === "OpenAI") {
        return synthesizeOpenAI(text, voiceConfig);
    }

    if (provider === "FishAudio") {
        return synthesizeFish(text, voiceConfig, options?.emotion);
    }

    return null;
}

// A stalled TTS request (TCP connected but no response — cold start, rate-limit
// hold, network blip) would otherwise hang forever, since fetch has no default
// timeout. That froze voice/video calls at "对方正在说话..." until the user
// toggled the mic. Abort after a ceiling so the caller can recover.
const TTS_TIMEOUT_MS = 120_000;

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = TTS_TIMEOUT_MS): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...init, signal: controller.signal });
    } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") {
            throw new Error(`语音合成超时（超过 ${Math.round(timeoutMs / 1000)} 秒无响应）`);
        }
        throw e;
    } finally {
        clearTimeout(timer);
    }
}

// ── Minimax TTS ─────────────────────────────────────

// MiniMax voice_setting.emotion 支持的取值（speech-01-turbo/hd、speech-02-turbo/hd 等）。
const MINIMAX_EMOTIONS = new Set([
    "happy", "sad", "angry", "fearful", "disgusted", "surprised", "calm", "neutral", "fluent",
]);

const MINIMAX_SPEED_MIN = 0.5;
const MINIMAX_SPEED_MAX = 2.0;

function normalizeMinimaxSpeed(speed: number | undefined): number {
    if (typeof speed !== "number" || !Number.isFinite(speed)) return 1.0;
    return Math.min(MINIMAX_SPEED_MAX, Math.max(MINIMAX_SPEED_MIN, speed));
}

async function synthesizeMinimax(text: string, config: VoiceApiConfig, emotion?: string): Promise<Blob | null> {
    if (!config.apiKey) throw new Error("Minimax API Key 未配置");

    const baseUrl = (config.baseUrl || "https://api.minimaxi.com/v1").replace(/\/$/, "");
    const voiceSetting: Record<string, unknown> = {
        voice_id: config.defaultVoice || "male-qn-qingse",
        speed: normalizeMinimaxSpeed(config.speechSpeed),
        vol: 1.0,
        pitch: 0,
    };
    const normalizedEmotion = emotion?.trim().toLowerCase();
    if (normalizedEmotion && MINIMAX_EMOTIONS.has(normalizedEmotion)) {
        voiceSetting.emotion = normalizedEmotion;
    }

    const response = await fetchWithTimeout(`${baseUrl}/t2a_v2`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${config.apiKey}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            model: config.model || "speech-01-turbo",
            text,
            stream: false,
            ...(config.languageBoost ? { language_boost: config.languageBoost } : {}),
            voice_setting: voiceSetting,
            // 44100/256k 是 Minimax 支持的最高档;之前 32000/128k 会把 hd 模型
            // 的输出压闷(用户反馈"声音糊"),各模型均支持该档位。
            audio_setting: {
                sample_rate: 44100,
                bitrate: 256000,
                format: "mp3",
                channel: 1,
            },
        }),
    });

    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.base_resp?.status_msg || `Minimax API 请求失败 (${response.status})`);
    }

    const data = await response.json();
    if (data.data?.audio) {
        const hexString: string = data.data.audio;
        const bytes = new Uint8Array(hexString.length / 2);
        for (let i = 0; i < hexString.length; i += 2) {
            bytes[i / 2] = parseInt(hexString.substring(i, i + 2), 16);
        }
        return new Blob([bytes], { type: "audio/mpeg" });
    }

    throw new Error(data.base_resp?.status_msg || "Minimax 未返回音频数据");
}

// ── OpenAI TTS ──────────────────────────────────────

async function synthesizeOpenAI(text: string, config: VoiceApiConfig): Promise<Blob | null> {
    if (!config.apiKey) throw new Error("OpenAI API Key 未配置");

    const baseUrl = config.baseUrl || "https://api.openai.com/v1";
    const response = await fetchWithTimeout(`${baseUrl.replace(/\/$/, "")}/audio/speech`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${config.apiKey}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            model: config.model || "tts-1",
            input: text,
            voice: config.defaultVoice || "alloy",
            response_format: "mp3",
        }),
    });

    if (!response.ok) {
        const errText = await response.text().catch(() => "");
        throw new Error(`OpenAI TTS 请求失败 (${response.status}): ${errText}`);
    }

    const blob = await response.blob();
    return new Blob([await blob.arrayBuffer()], { type: "audio/mpeg" });
}

// ── Fish Audio TTS ───────────────────────────────────

const FISH_PROXY_PATH = "/api/voice/fishaudio-tts";
const DEFAULT_FISH_MODEL = "s2.1-pro";

// 鱼声实际可靠生效的方括号 cue 标签（S2.1 对非白名单标签大多弱响应或忽略）。
const FISH_SUPPORTED_CUES = new Set([
    // 情感语调
    "angry", "sad", "embarrassed", "emphasis", "whispering", "soft", "breathy", "excited",
    // 音效
    "laughing", "chuckling", "moaning", "clear throat", "sobbing", "crying loudly",
    "sighing", "panting", "groaning", "crowd laughing", "background laughter", "audience laughing",
    // 停顿
    "pause", "long pause",
]);

// 把模型可能写出的各种 cue（同义词 / MiniMax 习惯 / 自造词）映射到鱼声支持集。
const FISH_CUE_SYNONYMS: Record<string, string> = {
    "break": "pause", "short pause": "pause",
    "long-break": "long pause", "longbreak": "long pause", "long break": "long pause",
    happy: "excited", joyful: "excited", delighted: "excited", cheerful: "excited", glad: "excited",
    smug: "excited", proud: "excited", gleeful: "excited", playful: "excited", teasing: "excited",
    confident: "excited", surprised: "excited", amazed: "excited", curious: "excited", hopeful: "excited",
    enthusiastic: "excited", eager: "excited",
    annoyed: "angry", irritated: "angry", frustrated: "angry", mad: "angry", furious: "angry", grumpy: "angry",
    unhappy: "sad", disappointed: "sad", hurt: "sad", depressed: "sad", pleading: "sad", sulking: "sad", lonely: "sad", regretful: "sad",
    shy: "embarrassed", bashful: "embarrassed", awkward: "embarrassed", flustered: "embarrassed",
    "soft tone": "soft", gentle: "soft", tender: "soft", warm: "soft", calm: "soft", soothing: "soft",
    tired: "soft", sleepy: "soft", relaxed: "soft", sincere: "soft",
    nervous: "breathy", anxious: "breathy", scared: "breathy", fearful: "breathy", worried: "breathy", timid: "breathy",
    whisper: "whispering", hushed: "whispering", murmuring: "whispering",
    emphatic: "emphasis", stressing: "emphasis",
    laugh: "laughing", laughs: "laughing",
    giggle: "chuckling", giggling: "chuckling", giggles: "chuckling", chuckle: "chuckling", chuckles: "chuckling",
    sigh: "sighing", sighs: "sighing",
    sob: "sobbing", sobs: "sobbing", crying: "crying loudly", cry: "crying loudly",
    groan: "groaning", groans: "groaning",
    pant: "panting", pants: "panting", gasp: "panting", gasps: "panting", gasping: "panting", "out of breath": "panting",
    moan: "moaning", moans: "moaning",
    "clears throat": "clear throat", ahem: "clear throat", cough: "clear throat", coughs: "clear throat",
};

// emotion 属性兜底映射（→ 鱼声支持集）。
const FISH_EMOTION_MAP: Record<string, string> = {
    happy: "excited",
    sad: "sad",
    angry: "angry",
    fearful: "breathy",
    disgusted: "angry",
    surprised: "excited",
    calm: "soft",
};

function normalizeFishCue(inner: string): string {
    const key = (inner || "").trim().toLowerCase().replace(/\s+/g, " ");
    if (!key) return "";
    if (FISH_SUPPORTED_CUES.has(key)) return key;
    if (FISH_CUE_SYNONYMS[key]) return FISH_CUE_SYNONYMS[key];
    for (const [syn, canon] of Object.entries(FISH_CUE_SYNONYMS)) {
        if (key.includes(syn)) return canon;
    }
    for (const canon of FISH_SUPPORTED_CUES) {
        if (key.includes(canon)) return canon;
    }
    return "";
}

/**
 * 鱼声专用文本清洗：
 * - 保留英文方括号 cue（[excited]/[whispering]…）原样送进 API；
 * - 清掉会被鱼声原样念出来的脏东西：系统标记、中文舞台指示、MiniMax <#秒#>；
 * - 把所有 cue 归一到 Fish 实际支持的标签（同义词映射、映射不到的丢弃）。
 */
function cleanTextForFish(raw: string): string {
    if (!raw) return "";
    let text = raw
        .replace(/\[\[.*?\]\]/g, "")                 // [[系统标记]]
        .replace(/（[^）]{0,48}）/g, "")              // 中文圆括号舞台指示
        .replace(/<#\s*[\d.]+\s*#>/g, "")            // MiniMax 停顿标记，鱼声不认
        // 西文圆括号声音标签 → 方括号，交给下面归一
        .replace(/\(([^)]{1,40})\)/g, "[$1]")
        // 换行 → 停顿
        .replace(/\n{2,}/g, " [long pause] ")
        .replace(/\n+/g, " [pause] ")
        // 归一：方括号 cue → Fish 实际支持的标签；映射不到的丢弃
        .replace(/\[([^\[\]]{1,40})\]/g, (_m, inner: string) => {
            const canon = normalizeFishCue(inner);
            return canon ? `[${canon}]` : "";
        })
        .replace(/\s+/g, " ")
        .trim();
    return text;
}

/**
 * 归一化鱼声音色 id（reference_id）。容忍用户直接粘 fish.audio 网页链接：
 *   https://fish.audio/app/text-to-speech/?modelId=98655a12fa944e26b274c535e5e03842
 * 也容忍只粘 id 本身。reference_id 是 32 位十六进制。
 */
function normalizeFishReferenceId(raw?: string): string {
    const s = (raw || "").trim();
    if (!s) return "";
    const byQuery = s.match(/[?&]modelId=([a-z0-9]+)/i);
    if (byQuery) return byQuery[1];
    const byHex = s.match(/[a-f0-9]{32}/i);
    if (byHex) return byHex[0];
    return s.split(/[?#\s]/)[0];
}

const FISH_SPEED_MIN = 0.5;
const FISH_SPEED_MAX = 2.0;

function normalizeFishSpeed(speed: number | undefined): number {
    if (typeof speed !== "number" || !Number.isFinite(speed)) return 0.9;
    return Math.min(FISH_SPEED_MAX, Math.max(FISH_SPEED_MIN, speed));
}

async function synthesizeFish(text: string, config: VoiceApiConfig, emotion?: string): Promise<Blob | null> {
    if (!config.apiKey) throw new Error("Fish Audio API Key 未配置");

    const referenceId = normalizeFishReferenceId(config.defaultVoice);
    if (!referenceId) throw new Error("未配置鱼声音色 reference_id（在「默认音色」里填）");

    const model = (config.model || DEFAULT_FISH_MODEL).trim() || DEFAULT_FISH_MODEL;

    // 鱼声文本清洗：保留方括号 cue，清除 MiniMax 残留标记
    let spoken = cleanTextForFish(text);
    // 兜底：上层传了 emotion 且正文没有情绪 cue 时，前置一个
    const hasInlineCue = /\[(?!(?:pause|long pause)\])/.test(spoken);
    if (!hasInlineCue && emotion) {
        const fishEmotion = FISH_EMOTION_MAP[emotion.trim().toLowerCase()];
        if (fishEmotion) spoken = `[${fishEmotion}] ${spoken}`;
    }
    if (!spoken) throw new Error("鱼声 TTS 文本为空");

    const payload = {
        text: spoken,
        reference_id: referenceId,
        format: "mp3",
        normalize: true,
        prosody: { speed: normalizeFishSpeed(config.speechSpeed) },
    };

    // 鱼声不发 ACAO 头，浏览器直连会被 CORS 挡 → 走服务端代理 /api/voice/fishaudio-tts
    const response = await fetchWithTimeout(FISH_PROXY_PATH, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${config.apiKey}`,
            "x-fish-model": model,
        },
        body: JSON.stringify(payload),
    });

    if (!response.ok) {
        let detail = "";
        try { detail = (await response.text()).slice(0, 200); } catch { /* ignore */ }
        throw new Error(`鱼声 TTS 请求失败 (${response.status})${detail ? `：${detail}` : ""}`);
    }

    const blob = await response.blob();
    if (!blob.size) throw new Error("鱼声 TTS 返回空音频");
    return new Blob([await blob.arrayBuffer()], { type: blob.type || "audio/mpeg" });
}

// ── iOS audio playback that coexists with speech recognition ──────────
// On iOS Safari, playing TTS through an <audio> element keeps the system audio
// session in "playback" mode, which steals the mic from webkitSpeechRecognition
// and stops it from restarting on the next turn (calls go silent after one
// round). To keep hands-free multi-turn working we play through a Web Audio
// AudioContext and explicitly suspend() it after each clip so iOS hands the
// audio session back to the microphone. A shared <audio> element is kept as a
// fallback for browsers without AudioContext.

let _audioCtx: AudioContext | null = null;
let _sharedAudio: HTMLAudioElement | null = null;
let _audioUnlocked = false;
let _unlockListenerInstalled = false;

// ── In-app TTS volume (0..1) ──
// iOS plays Web Audio on the ringer/voice stream, so the hardware volume keys
// don't control character speech. This in-app gain does. Synced to localStorage.
const TTS_VOLUME_KEY = "ai_phone_tts_volume_v1";
let _ttsVolume = ((): number => {
    if (typeof window === "undefined") return 1;
    try {
        const raw = window.localStorage.getItem(TTS_VOLUME_KEY);
        const v = raw == null ? 1 : Number(raw);
        return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1;
    } catch { return 1; }
})();
// Live gain node of the currently-playing AudioContext clip, so the slider can
// adjust volume mid-sentence.
let _activeGain: GainNode | null = null;

export function getTtsVolume(): number {
    return _ttsVolume;
}

export function setTtsVolume(volume: number): void {
    _ttsVolume = Math.min(1, Math.max(0, volume));
    try { window.localStorage.setItem(TTS_VOLUME_KEY, String(_ttsVolume)); } catch { /* ignore */ }
    if (_activeGain) { try { _activeGain.gain.value = _ttsVolume; } catch { /* ignore */ } }
    if (_sharedAudio) { try { _sharedAudio.volume = _ttsVolume; } catch { /* ignore */ } }
}

function getAudioContext(): AudioContext | null {
    if (typeof window === "undefined") return null;
    const Ctor = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!Ctor) return null;
    if (!_audioCtx) {
        // 不要钉 sampleRate:部分 iOS 版本上非硬件采样率的 ctx 会"时钟照走、
        // 输出全静音"(比闷更糟)。防发闷靠 TTS 请求参数(44100/256k)兜底。
        try { _audioCtx = new Ctor(); } catch { return null; }
    }
    return _audioCtx;
}

function getSharedAudio(): HTMLAudioElement {
    if (!_sharedAudio) {
        _sharedAudio = new Audio();
        _sharedAudio.setAttribute("playsinline", "");
    }
    return _sharedAudio;
}

function silentWavUrl(): string {
    // A few ms of 8-bit mono PCM silence — a valid source so play() actually
    // starts (and thus unlocks the element) on iOS.
    const numSamples = 16;
    const buffer = new ArrayBuffer(44 + numSamples);
    const view = new DataView(buffer);
    const writeStr = (off: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
    writeStr(0, "RIFF"); view.setUint32(4, 36 + numSamples, true); writeStr(8, "WAVE");
    writeStr(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
    view.setUint16(22, 1, true); view.setUint32(24, 8000, true); view.setUint32(28, 8000, true);
    view.setUint16(32, 1, true); view.setUint16(34, 8, true);
    writeStr(36, "data"); view.setUint32(40, numSamples, true);
    for (let i = 0; i < numSamples; i++) view.setUint8(44 + i, 128); // 8-bit silence = 128
    return URL.createObjectURL(new Blob([buffer], { type: "audio/wav" }));
}

/**
 * Unlock audio playback. Must run inside (or synchronously from) a user gesture.
 * Resumes the AudioContext (primary path) and unlocks the <audio> fallback.
 * Safe to call repeatedly.
 */
export function unlockAudioPlayback(): void {
    if (typeof window === "undefined") return;

    // Primary path: resume the Web Audio context within the gesture. Once
    // resumed under a gesture, subsequent programmatic resume()s are allowed.
    const ctx = getAudioContext();
    if (ctx && ctx.state === "suspended") ctx.resume().catch(() => {});

    // Fallback path: unlock the shared <audio> element once.
    if (_audioUnlocked) return;
    const audio = getSharedAudio();
    const url = silentWavUrl();
    audio.muted = true;
    audio.src = url;
    const finish = () => {
        try { audio.pause(); audio.currentTime = 0; } catch {}
        audio.muted = false;
        URL.revokeObjectURL(url);
        _audioUnlocked = true;
    };
    try {
        const p = audio.play();
        if (p && typeof p.then === "function") {
            p.then(finish).catch(() => { audio.muted = false; URL.revokeObjectURL(url); });
        } else {
            finish();
        }
    } catch {
        audio.muted = false;
        URL.revokeObjectURL(url);
    }
}

function installUnlockListener(): void {
    if (_unlockListenerInstalled || typeof window === "undefined") return;
    _unlockListenerInstalled = true;
    const handler = () => { unlockAudioPlayback(); };
    window.addEventListener("touchend", handler, { passive: true });
    window.addEventListener("pointerdown", handler, { passive: true });
    window.addEventListener("mousedown", handler, { passive: true });
}

// Install the first-gesture unlock as soon as this module loads on the client.
// The call screens import this module statically (via chat-room), so the
// listener is in place well before the user taps the call button.
if (typeof window !== "undefined") installUnlockListener();

function decodeAudio(ctx: AudioContext, data: ArrayBuffer): Promise<AudioBuffer> {
    // Support both the promise and legacy callback forms (older webkitAudioContext).
    return new Promise((resolve, reject) => {
        const ret = ctx.decodeAudioData(data, resolve, reject);
        if (ret && typeof (ret as Promise<AudioBuffer>).then === "function") {
            (ret as Promise<AudioBuffer>).then(resolve, reject);
        }
    });
}

/**
 * Playback via a shared <audio> element. Used as the fallback when AudioContext
 * is unavailable, and as the PRIMARY path for gesture-less auto-play scenarios
 * (e.g. VN/漫卷 auto voice): a media element that was unlocked once keeps playing
 * programmatically, whereas resuming a suspended AudioContext far from any user
 * gesture is often rejected on Android Chrome/Edge (the "only plays with WeChat
 * keep-alive on" bug — the keep-alive's looping silent <audio> was what kept the
 * context alive). Bonus: media-element playback also obeys hardware volume keys.
 */
export function playAudioBlobViaMediaElement(blob: Blob): { promise: Promise<void>; abort: () => void } {
    return playAudioBlobElement(blob);
}

function playAudioBlobElement(blob: Blob): { promise: Promise<void>; abort: () => void } {
    const url = URL.createObjectURL(blob);
    const audio = getSharedAudio();
    audio.muted = false;
    audio.volume = _ttsVolume;
    audio.src = url;

    let settled = false;
    let resolveFn: () => void = () => {};
    const finalize = () => {
        if (settled) return;
        settled = true;
        audio.onended = null;
        audio.onerror = null;
        URL.revokeObjectURL(url);
        try { audio.pause(); audio.removeAttribute("src"); audio.load(); } catch {}
        resolveFn();
    };
    const promise = new Promise<void>((resolve) => {
        resolveFn = resolve;
        audio.onended = finalize;
        audio.onerror = finalize;
        audio.play().catch(() => {
            finalize();
        });
    });
    return { promise, abort: finalize };
}

/**
 * Play an audio blob through the Web Audio context and resolve when playback
 * ends. After playback the context is suspended so iOS releases the audio
 * session back to the microphone (lets SpeechRecognition restart next turn).
 * Returns an abort function to stop playback early. Playback is sequential.
 */
export function playAudioBlob(blob: Blob): { promise: Promise<void>; abort: () => void } {
    const ctx = getAudioContext();
    if (!ctx) return playAudioBlobElement(blob);

    let settled = false;
    let resolveFn: () => void = () => {};
    let source: AudioBufferSourceNode | null = null;

    let gain: GainNode | null = null;

    const finalize = () => {
        if (settled) return;
        settled = true;
        if (source) {
            source.onended = null;
            try { source.stop(); } catch {}
            try { source.disconnect(); } catch {}
            source = null;
        }
        if (gain) { try { gain.disconnect(); } catch {} }
        if (_activeGain === gain) _activeGain = null;
        gain = null;
        // Suspend so iOS hands the audio session back to the microphone.
        try { ctx.suspend(); } catch {}
        resolveFn();
    };

    const promise = new Promise<void>((resolve) => {
        resolveFn = resolve;
        (async () => {
            try {
                if (ctx.state === "suspended") await ctx.resume();
                const audioBuffer = await decodeAudio(ctx, await blob.arrayBuffer());
                if (settled) return;
                source = ctx.createBufferSource();
                source.buffer = audioBuffer;
                // Route through a gain node so the in-app volume slider applies.
                gain = ctx.createGain();
                gain.gain.value = _ttsVolume;
                source.connect(gain);
                gain.connect(ctx.destination);
                _activeGain = gain;
                source.onended = finalize;
                source.start();
            } catch {
                finalize();
            }
        })();
    });

    return { promise, abort: finalize };
}
