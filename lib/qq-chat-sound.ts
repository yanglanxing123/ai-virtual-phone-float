// lib/qq-chat-sound.ts
// QQ 风格聊天提示音：普通消息=三全音，特别关心=甘露。
// 两个 MP3 是项目内置默认提示音；用户在设置里绑定自定义音频后仍优先使用自定义音频。

import { loadChatSoundSettings, unlockChatSound as unlockBaseChatSound } from "@/lib/chat-sound";

const DEFAULT_NORMAL_SOUND_URL = "/chat-sounds/qq-three-tone.mp3";
const DEFAULT_SPECIAL_SOUND_URL = "/chat-sounds/qq-ganlu.mp3";

const audioCache = new Map<string, HTMLAudioElement>();

function getAudio(url: string): HTMLAudioElement | null {
  if (typeof window === "undefined" || !url) return null;
  let audio = audioCache.get(url);
  if (!audio) {
    audio = new Audio(url);
    audio.preload = "auto";
    audioCache.set(url, audio);
  }
  return audio;
}

function playAudio(url: string, volumePercent: number): void {
  const audio = getAudio(url);
  if (!audio) return;

  const volume = Math.max(0, Math.min(1, volumePercent / 100));
  if (volume <= 0) return;

  audio.volume = volume;
  try { audio.currentTime = 0; } catch {}
  void audio.play().catch(() => {});
}

export function playChatMessageSound(isSpecial?: boolean): void {
  try {
    const settings = loadChatSoundSettings();
    const customUrl = isSpecial
      ? settings.specialCustomSoundUrl
      : settings.normalCustomSoundUrl;
    const bundledUrl = isSpecial
      ? DEFAULT_SPECIAL_SOUND_URL
      : DEFAULT_NORMAL_SOUND_URL;
    const volume = isSpecial ? settings.specialVolume : settings.normalVolume;

    // 有自定义音频时保持原有设置；没有自定义音频时直接使用项目内置 QQ MP3。
    playAudio(customUrl || bundledUrl, volume);
  } catch {
    // 提示音异常不能影响聊天功能。
  }
}

export function unlockChatSound(): void {
  // 保留原 AudioContext 解锁逻辑。
  unlockBaseChatSound();

  // iOS/Safari 对 HTMLAudio 的自动播放限制：在用户第一次点击时
  // 提前触碰两个默认音频元素，后续收到消息时才能正常播放。
  if (typeof window === "undefined") return;
  for (const url of [DEFAULT_NORMAL_SOUND_URL, DEFAULT_SPECIAL_SOUND_URL]) {
    const audio = getAudio(url);
    if (!audio) continue;
    const oldVolume = audio.volume;
    audio.volume = 0;
    try { audio.currentTime = 0; } catch {}
    void audio.play().then(() => {
      audio.pause();
      try { audio.currentTime = 0; } catch {}
      audio.volume = oldVolume;
    }).catch(() => {
      audio.volume = oldVolume;
    });
  }
}
