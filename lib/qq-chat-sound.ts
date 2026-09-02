// lib/qq-chat-sound.ts
// QQ 风格聊天提示音：普通消息=三全音，特别关心=甘露。
// 优先使用用户在聊天声音设置里绑定的自定义音频；没有自定义音频时使用项目内置 MP3。

import { loadChatSoundSettings, unlockChatSound as unlockBaseChatSound } from "@/lib/chat-sound";

const DEFAULT_NORMAL_SOUND_URL = "/chat-sounds/qq-three-tone.mp3";
const DEFAULT_SPECIAL_SOUND_URL = "/chat-sounds/qq-ganlu.mp3";

const audioCache = new Map<string, HTMLAudioElement>();

function playAudio(url: string, volumePercent: number): void {
  if (typeof window === "undefined" || !url) return;

  const volume = Math.max(0, Math.min(1, volumePercent / 100));
  if (volume <= 0) return;

  let audio = audioCache.get(url);
  if (!audio) {
    audio = new Audio(url);
    audio.preload = "auto";
    audioCache.set(url, audio);
  }

  audio.volume = volume;
  audio.currentTime = 0;
  audio.play().catch(() => {
    // 浏览器自动播放策略阻止时静默失败，不影响消息本身。
  });
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

    playAudio(customUrl || bundledUrl, volume);
  } catch {
    // 提示音异常不能影响聊天功能。
  }
}

export function unlockChatSound(): void {
  unlockBaseChatSound();
}
