// lib/chat-sound.ts
// 仿QQ提示音 — 使用 Web Audio API 程序化生成，无需外部音频文件

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
    // 某些浏览器需要 resume
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
};

/**
 * 播放一组音调序列
 */
function playToneSequence(tones: ToneSpec[]): void {
    const ctx = getAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const masterGain = ctx.createGain();
    masterGain.gain.value = 0.3;
    masterGain.connect(ctx.destination);

    for (const tone of tones) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = tone.type || "sine";
        osc.frequency.value = tone.freq;

        const vol = tone.volume ?? 0.3;
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
function playDefaultMessageSound(): void {
    playToneSequence([
        { freq: 1046.5, duration: 0.12, delay: 0,    type: "sine", volume: 0.25 }, // C6
        { freq: 1318.5, duration: 0.20, delay: 0.10, type: "sine", volume: 0.22 }, // E6
    ]);
}

/**
 * 特别关心提示音 — 三连升调 "叮叮叮"，更醒目
 */
function playSpecialCareSound(): void {
    playToneSequence([
        { freq: 880.0,  duration: 0.10, delay: 0,    type: "sine", volume: 0.22 }, // A5
        { freq: 1108.7, duration: 0.10, delay: 0.09, type: "sine", volume: 0.22 }, // C#6
        { freq: 1318.5, duration: 0.10, delay: 0.18, type: "sine", volume: 0.22 }, // E6
        { freq: 1760.0, duration: 0.28, delay: 0.27, type: "sine", volume: 0.20 }, // A6
    ]);
}

/**
 * 播放聊天消息提示音
 * @param isSpecial 是否特别关心联系人 — 使用不同提示音
 */
export function playChatMessageSound(isSpecial?: boolean): void {
    try {
        if (isSpecial) {
            playSpecialCareSound();
        } else {
            playDefaultMessageSound();
        }
    } catch {
        // 静默失败：不影响消息收发
    }
}

/**
 * 用户首次交互后解锁 AudioContext（部分浏览器要求用户手势触发）
 */
export function unlockChatSound(): void {
    getAudioContext();
}
