"use client";

import { useState, useRef, useEffect } from "react";
import { Volume2, VolumeX, Play, Upload, Trash2, Bell, Star, RotateCcw } from "lucide-react";
import {
    loadChatSoundSettings,
    saveChatSoundSettings,
    previewChatSound,
    audioFileToDataUrl,
    type ChatSoundSettings,
} from "@/lib/chat-sound";

/**
 * 提示音设置组件
 * - 普通消息和特别关心消息分别设置音量和自定义提示音
 * - 保留内置提示音作为默认
 * - 支持绑定本地音频文件
 */
export function ChatSoundSettings() {
    const [settings, setSettings] = useState<ChatSoundSettings>(() => loadChatSoundSettings());
    const [uploading, setUploading] = useState<"normal" | "special" | null>(null);
    const [error, setError] = useState<string>("");
    const normalFileRef = useRef<HTMLInputElement>(null);
    const specialFileRef = useRef<HTMLInputElement>(null);

    // 监听外部更新
    useEffect(() => {
        const handler = () => setSettings(loadChatSoundSettings());
        window.addEventListener("chat-sound-settings-updated", handler);
        return () => window.removeEventListener("chat-sound-settings-updated", handler);
    }, []);

    const updateSettings = (patch: Partial<ChatSoundSettings>) => {
        const next = { ...settings, ...patch };
        setSettings(next);
        saveChatSoundSettings(next);
    };

    const handleVolumeChange = (type: "normal" | "special", value: number) => {
        const clamped = Math.max(0, Math.min(200, value));
        if (type === "normal") {
            updateSettings({ normalVolume: clamped });
        } else {
            updateSettings({ specialVolume: clamped });
        }
    };

    const handleFileUpload = async (type: "normal" | "special", file: File) => {
        setUploading(type);
        setError("");
        try {
            const dataUrl = await audioFileToDataUrl(file);
            if (type === "normal") {
                updateSettings({
                    normalCustomSoundUrl: dataUrl,
                    normalCustomSoundName: file.name,
                });
            } else {
                updateSettings({
                    specialCustomSoundUrl: dataUrl,
                    specialCustomSoundName: file.name,
                });
            }
        } catch (e) {
            setError(e instanceof Error ? e.message : "上传失败");
        } finally {
            setUploading(null);
        }
    };

    const handleRemoveCustom = (type: "normal" | "special") => {
        if (type === "normal") {
            updateSettings({
                normalCustomSoundUrl: null,
                normalCustomSoundName: null,
            });
        } else {
            updateSettings({
                specialCustomSoundUrl: null,
                specialCustomSoundName: null,
            });
        }
    };

    const handleReset = () => {
        const defaults: ChatSoundSettings = {
            normalVolume: 100,
            specialVolume: 100,
            normalCustomSoundUrl: null,
            specialCustomSoundUrl: null,
            normalCustomSoundName: null,
            specialCustomSoundName: null,
        };
        setSettings(defaults);
        saveChatSoundSettings(defaults);
    };

    const volumeLabel = (v: number) => {
        if (v === 0) return "静音";
        if (v === 100) return "默认";
        if (v === 200) return "最大";
        return `${v}%`;
    };

    return (
        <div className="chat-sound-settings">
            {/* 普通消息提示音 */}
            <div className="sound-section">
                <div className="sound-section-header">
                    <Bell size={16} color="#6b7280" />
                    <span className="sound-section-title">普通消息提示音</span>
                </div>

                {/* 音量滑块 */}
                <div className="sound-volume-row">
                    <div className="sound-volume-label">
                        {settings.normalVolume === 0 ? <VolumeX size={14} color="#9ca3af" /> : <Volume2 size={14} color="#6b7280" />}
                        <span>音量</span>
                        <span className="sound-volume-value">{volumeLabel(settings.normalVolume)}</span>
                    </div>
                    <input
                        type="range"
                        min={0}
                        max={200}
                        step={10}
                        value={settings.normalVolume}
                        onChange={e => handleVolumeChange("normal", Number(e.target.value))}
                        className="sound-volume-slider"
                    />
                </div>

                {/* 自定义提示音 */}
                <div className="sound-custom-row">
                    <div className="sound-custom-info">
                        <span className="sound-custom-label">自定义提示音</span>
                        <span className="sound-custom-desc">
                            {settings.normalCustomSoundName
                                ? `已绑定：${settings.normalCustomSoundName}`
                                : "未绑定，使用内置提示音"}
                        </span>
                    </div>
                    <div className="sound-custom-actions">
                        <button
                            type="button"
                            className="sound-btn sound-btn-test"
                            onClick={() => previewChatSound(false)}
                        >
                            <Play size={13} /> 试听
                        </button>
                        <button
                            type="button"
                            className="sound-btn sound-btn-upload"
                            onClick={() => normalFileRef.current?.click()}
                            disabled={uploading === "normal"}
                        >
                            <Upload size={13} /> {uploading === "normal" ? "上传中…" : "绑定"}
                        </button>
                        {settings.normalCustomSoundUrl && (
                            <button
                                type="button"
                                className="sound-btn sound-btn-remove"
                                onClick={() => handleRemoveCustom("normal")}
                            >
                                <Trash2 size={13} />
                            </button>
                        )}
                    </div>
                    <input
                        ref={normalFileRef}
                        type="file"
                        accept="audio/*"
                        className="hidden-file-input"
                        onChange={e => {
                            const file = e.target.files?.[0];
                            if (file) handleFileUpload("normal", file);
                            e.target.value = "";
                        }}
                    />
                </div>
            </div>

            {/* 特别关心提示音 */}
            <div className="sound-section sound-section-special">
                <div className="sound-section-header">
                    <Star size={16} color="#f0a020" />
                    <span className="sound-section-title">特别关心提示音</span>
                </div>

                {/* 音量滑块 */}
                <div className="sound-volume-row">
                    <div className="sound-volume-label">
                        {settings.specialVolume === 0 ? <VolumeX size={14} color="#9ca3af" /> : <Volume2 size={14} color="#f0a020" />}
                        <span>音量</span>
                        <span className="sound-volume-value">{volumeLabel(settings.specialVolume)}</span>
                    </div>
                    <input
                        type="range"
                        min={0}
                        max={200}
                        step={10}
                        value={settings.specialVolume}
                        onChange={e => handleVolumeChange("special", Number(e.target.value))}
                        className="sound-volume-slider sound-volume-slider-special"
                    />
                </div>

                {/* 自定义提示音 */}
                <div className="sound-custom-row">
                    <div className="sound-custom-info">
                        <span className="sound-custom-label">自定义提示音</span>
                        <span className="sound-custom-desc">
                            {settings.specialCustomSoundName
                                ? `已绑定：${settings.specialCustomSoundName}`
                                : "未绑定，使用内置提示音"}
                        </span>
                    </div>
                    <div className="sound-custom-actions">
                        <button
                            type="button"
                            className="sound-btn sound-btn-test"
                            onClick={() => previewChatSound(true)}
                        >
                            <Play size={13} /> 试听
                        </button>
                        <button
                            type="button"
                            className="sound-btn sound-btn-upload"
                            onClick={() => specialFileRef.current?.click()}
                            disabled={uploading === "special"}
                        >
                            <Upload size={13} /> {uploading === "special" ? "上传中…" : "绑定"}
                        </button>
                        {settings.specialCustomSoundUrl && (
                            <button
                                type="button"
                                className="sound-btn sound-btn-remove"
                                onClick={() => handleRemoveCustom("special")}
                            >
                                <Trash2 size={13} />
                            </button>
                        )}
                    </div>
                    <input
                        ref={specialFileRef}
                        type="file"
                        accept="audio/*"
                        className="hidden-file-input"
                        onChange={e => {
                            const file = e.target.files?.[0];
                            if (file) handleFileUpload("special", file);
                            e.target.value = "";
                        }}
                    />
                </div>
            </div>

            {/* 错误提示 */}
            {error && <div className="sound-error">{error}</div>}

            {/* 重置按钮 */}
            <div className="sound-reset-row">
                <button type="button" className="sound-btn sound-btn-reset" onClick={handleReset}>
                    <RotateCcw size={13} /> 恢复默认
                </button>
            </div>
        </div>
    );
}
