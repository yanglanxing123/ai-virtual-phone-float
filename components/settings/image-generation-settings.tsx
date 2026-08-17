"use client";

import { useCallback, useEffect, useMemo, useState, useContext, type CSSProperties } from "react";
import { AlertCircle, Camera, ChevronDown, Image, RefreshCw, Sparkles, Trash2, Upload, Plus, FileEdit, X, Check } from "lucide-react";
import type { ImageGenerationSettings as ImageGenerationSettingsType, ImageApiConfig } from "@/lib/settings-types";
import {
    DEFAULT_IMAGE_GENERATION_SETTINGS,
    loadImageGenerationSettings,
    saveImageGenerationSettings,
    createDefaultImageApiConfig,
    getActiveImageApiConfig,
} from "@/lib/settings-storage";
import { loadCharacters } from "@/lib/character-storage";
import type { Character } from "@/lib/character-types";
import { getChatImageFromIndexedDB, saveChatImageToIndexedDB } from "@/lib/chat-asset-storage";
import {
    fetchImageGenerationModels,
    filterLikelyImageModels,
    generateImageFromConfiguredApi,
} from "@/lib/image-generation-service";
import { Alert } from "@/components/ui/feedback";
import { Input, Select, Textarea, Toggle } from "@/components/ui/form";
import { ConfirmDialog } from "@/components/ui/modal";
import { SettingsContext } from "../phone-settings-app";

const SIZE_OPTIONS = ["auto", "1024x1024", "1024x1536", "1536x1024"];
const QUALITY_OPTIONS = ["auto", "low", "medium", "high"];

// Some relay APIs (e.g. dzzi 的 gpt-image-2) ignore the `size` param and pick
// their own aspect ratio. As a fallback we append a natural-language ratio hint
// to the prompt, which these models DO respect. The marker lets us replace the
// previously-appended hint instead of stacking them when the size changes.
const RATIO_HINT_MARKER = "【画面比例】";
const SIZE_RATIO_HINTS: Record<string, string> = {
    "1024x1024": "正方形 1:1 构图，square 1:1 composition",
    "1024x1536": "竖向 2:3 构图，vertical portrait composition",
    "1536x1024": "横向 3:2 构图，horizontal landscape composition",
};

// Remove any auto-appended ratio hint line(s), preserving the user's own text.
function stripRatioHint(text: string): string {
    return text.replace(new RegExp(`\\s*${RATIO_HINT_MARKER}[^\\n]*`, "g"), "").replace(/\s+$/, "");
}

// Return the prompt with the ratio hint for `size` appended (replacing any
// previous hint). `auto` strips the hint entirely.
function withRatioHint(extraPrompt: string, size: string): string {
    const base = stripRatioHint(extraPrompt);
    const hint = SIZE_RATIO_HINTS[size];
    if (!hint) return base;
    return base ? `${base}\n${RATIO_HINT_MARKER}${hint}` : `${RATIO_HINT_MARKER}${hint}`;
}

const IMAGE_HOSTING_PROVIDER_OPTIONS = [
    { value: "none", label: "不使用图床" },
    { value: "imgbb", label: "ImgBB" },
] as const;
const imageGenerationIconStyle = { "--icon-color": "#0EA5E9" } as CSSProperties;
const ACTIVE_CARD_RING = "0 8px 24px rgba(0,0,0,0.025), inset 0 1px 0 rgba(255,255,255,0.2), 0 0 0 2px #0EA5E9";

type Status = { success: boolean; message: string };

export function ImageGenerationSettings() {
    const { setSubpageRightAction } = useContext(SettingsContext);
    const [settings, setSettings] = useState<ImageGenerationSettingsType>(DEFAULT_IMAGE_GENERATION_SETTINGS);
    const [characters, setCharacters] = useState<Character[]>([]);
    const [referencePreviews, setReferencePreviews] = useState<Record<string, string>>({});
    const [models, setModels] = useState<string[]>([]);
    const [isFetchingModels, setIsFetchingModels] = useState(false);
    const [isTesting, setIsTesting] = useState(false);
    const [status, setStatus] = useState<Status | null>(null);
    const [testPreviewUrl, setTestPreviewUrl] = useState<string | null>(null);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [isNewConfig, setIsNewConfig] = useState(false);
    const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

    // --- Load on mount ---
    // Sync the ratio hint to the active config's size on load, so the hint is
    // present by default (not only after the user manually switches the size).
    useEffect(() => {
        const loaded = loadImageGenerationSettings();
        const activeCfg = getActiveImageApiConfig(loaded);
        const size = activeCfg?.size ?? "1024x1024";
        const syncedExtra = withRatioHint(loaded.extraPrompt, size);
        if (syncedExtra !== loaded.extraPrompt) {
            const next = { ...loaded, extraPrompt: syncedExtra };
            saveImageGenerationSettings(next);
            setSettings(next);
        } else {
            setSettings(loaded);
        }
        setCharacters(loadCharacters());
    }, []);

    // --- Reference previews ---
    useEffect(() => {
        let cancelled = false;
        const refs = settings.characterReferences || {};
        Promise.all(Object.entries(refs).map(async ([characterId, ref]) => {
            const dataUrl = ref.assetId ? await getChatImageFromIndexedDB(ref.assetId) : null;
            return [characterId, dataUrl] as const;
        })).then(entries => {
            if (cancelled) return;
            const next: Record<string, string> = {};
            for (const [characterId, dataUrl] of entries) {
                if (dataUrl) next[characterId] = dataUrl;
            }
            setReferencePreviews(next);
        });
        return () => { cancelled = true; };
    }, [settings.characterReferences]);

    // --- Cleanup test preview URL ---
    useEffect(() => {
        return () => {
            if (testPreviewUrl) URL.revokeObjectURL(testPreviewUrl);
        };
    }, [testPreviewUrl]);

    const activeConfig = useMemo(() => getActiveImageApiConfig(settings), [settings]);

    const persist = useCallback((next: ImageGenerationSettingsType) => {
        setSettings(next);
        saveImageGenerationSettings(next);
    }, []);

    const updateSettings = useCallback((patch: Partial<ImageGenerationSettingsType>) => {
        persist({ ...settings, ...patch });
    }, [persist, settings]);

    const updateImageHosting = useCallback((patch: Partial<ImageGenerationSettingsType["imageHosting"]>) => {
        persist({
            ...settings,
            imageHosting: {
                ...settings.imageHosting,
                ...patch,
            },
        });
    }, [persist, settings]);

    // --- Config CRUD ---

    const addConfig = useCallback(() => {
        const newConfig = createDefaultImageApiConfig();
        // If there are no existing configs, the new one becomes the active
        // fallback (configs[0]); sync the ratio hint to its size.
        const shouldSyncHint = settings.configs.length === 0;
        persist({
            ...settings,
            configs: [...settings.configs, newConfig],
            extraPrompt: shouldSyncHint
                ? withRatioHint(settings.extraPrompt, newConfig.size)
                : settings.extraPrompt,
        });
        setIsNewConfig(true);
        setEditingId(newConfig.id);
        setModels([]);
        setStatus(null);
    }, [settings, persist]);

    // Register the "新增生图方案" button in the subpage header right slot.
    useEffect(() => {
        setSubpageRightAction("imageGeneration",
            <button
                onClick={addConfig}
                className="inline-flex h-10 items-center justify-center gap-1.5 whitespace-nowrap rounded-[20px] bg-black px-4 text-xs font-bold text-white shadow-sm transition-all hover:bg-gray-800 hover:shadow-md active:scale-95 focus:outline-none"
            >
                <Plus size={15} strokeWidth={1.8} />
                <span>新增生图方案</span>
            </button>
        );
        return () => setSubpageRightAction("imageGeneration", null);
    }, [addConfig, setSubpageRightAction]);

    const updateConfig = useCallback((id: string, updates: Partial<ImageApiConfig>) => {
        const updated = settings.configs.map(c => c.id === id ? { ...c, ...updates } : c);
        const next: ImageGenerationSettingsType = { ...settings, configs: updated };
        // If the updated config is the active one and its size changed, refresh
        // the auto-appended ratio hint in the 补充提示词 box so models that
        // ignore the `size` param still produce the requested orientation.
        if (id === settings.activeConfigId && updates.size !== undefined) {
            next.extraPrompt = withRatioHint(settings.extraPrompt, updates.size);
        }
        persist(next);
    }, [settings, persist]);

    const removeConfig = useCallback((id: string) => {
        const remaining = settings.configs.filter(c => c.id !== id);
        const wasActive = settings.activeConfigId === id;
        const next: ImageGenerationSettingsType = {
            ...settings,
            configs: remaining,
            activeConfigId: wasActive ? "" : settings.activeConfigId,
        };
        // If the active config was deleted, the fallback active config becomes
        // remaining[0]; sync the ratio hint to its size.
        if (wasActive && remaining.length > 0) {
            next.extraPrompt = withRatioHint(settings.extraPrompt, remaining[0].size);
        }
        persist(next);
        if (editingId === id) {
            setEditingId(null);
            setIsNewConfig(false);
        }
    }, [settings, persist, editingId]);

    const activateConfig = useCallback((id: string) => {
        const config = settings.configs.find(c => c.id === id);
        const size = config?.size ?? "1024x1024";
        persist({
            ...settings,
            activeConfigId: id,
            extraPrompt: withRatioHint(settings.extraPrompt, size),
        });
    }, [settings, persist]);

    const likelyModels = useMemo(() => filterLikelyImageModels(models), [models]);

    // --- Fetch models for the config currently being edited in the modal ---
    // fetchImageGenerationModels internally uses getActiveImageApiConfig, so we
    // build a temp settings where the editing config is active.
    const fetchModels = useCallback(async (configId: string) => {
        const config = settings.configs.find(c => c.id === configId);
        if (!config) return;
        if (!config.apiKey.trim() || !config.baseUrl.trim()) {
            setStatus({ success: false, message: "请先填写 Base URL 和 API Key。" });
            return;
        }
        const tempSettings: ImageGenerationSettingsType = {
            ...settings,
            activeConfigId: configId,
            enabled: true,
        };
        setIsFetchingModels(true);
        try {
            const fetched = await fetchImageGenerationModels(tempSettings);
            setModels(fetched);
            setStatus({
                success: true,
                message: fetched.length > 0 ? `已拉取 ${fetched.length} 个模型。` : "接口返回为空，可手动填写模型名。",
            });
        } catch (err) {
            setModels([]);
            setStatus({ success: false, message: err instanceof Error ? err.message : String(err) });
        } finally {
            setIsFetchingModels(false);
        }
    }, [settings]);

    // --- Test generation using the active config ---
    const testGeneration = useCallback(async () => {
        setStatus(null);
        setIsTesting(true);
        try {
            const result = await generateImageFromConfiguredApi({
                description: "一张放在桌面上的白色咖啡杯，柔和自然光，真实照片风格",
                settings: { ...settings, enabled: true },
            });
            if (!result) throw new Error("图像生成未返回结果。");
            if (testPreviewUrl) URL.revokeObjectURL(testPreviewUrl);
            setTestPreviewUrl(URL.createObjectURL(result.blob));
            setStatus({ success: true, message: "测试生图成功。" });
        } catch (err) {
            setStatus({ success: false, message: err instanceof Error ? err.message : String(err) });
        } finally {
            setIsTesting(false);
        }
    }, [settings, testPreviewUrl]);

    const uploadReference = async (characterId: string, file: File) => {
        const assetId = await saveChatImageToIndexedDB(file);
        persist({
            ...settings,
            characterReferences: {
                ...(settings.characterReferences || {}),
                [characterId]: { assetId, updatedAt: Date.now() },
            },
        });
    };

    const removeReference = (characterId: string) => {
        const nextRefs = { ...(settings.characterReferences || {}) };
        delete nextRefs[characterId];
        persist({ ...settings, characterReferences: nextRefs });
        setReferencePreviews(prev => {
            const next = { ...prev };
            delete next[characterId];
            return next;
        });
    };

    // --- Modal helpers ---
    const editingConfig = useMemo(
        () => settings.configs.find(c => c.id === editingId) ?? null,
        [settings.configs, editingId],
    );

    const openEditModal = (id: string) => {
        setEditingId(id);
        setIsNewConfig(false);
        setModels([]);
        setStatus(null);
    };

    const closeModal = () => {
        // Cancelling a newly-created (unsaved) config discards it.
        if (isNewConfig && editingId) {
            removeConfig(editingId);
        }
        setIsNewConfig(false);
        setEditingId(null);
        setModels([]);
        setStatus(null);
    };

    const confirmModal = () => {
        setIsNewConfig(false);
        setEditingId(null);
        setModels([]);
        setStatus(null);
    };

    return (
        <div className="flex flex-col gap-6 pb-8">
            <div className="flex items-center">
                <h2 className="m-0 mx-2 ts-28 font-bold italic leading-none text-black">Image Generation</h2>
            </div>

            {/* --- Enabled toggle --- */}
            <div className="menu-group">
                <div className="menu-item">
                    <span className="card-icon" style={imageGenerationIconStyle}>
                        <Sparkles size={22} strokeWidth={1.75} />
                    </span>
                    <span className="settings-tools-menu-copy">
                        <span className="menu-label appearance-menu-item-label">启用自动生图</span>
                        <span className="menu-desc settings-tools-menu-desc">角色输出照片标签时自动调用图像生成 API。</span>
                    </span>
                    <span className="menu-right settings-tools-menu-toggle">
                        <Toggle checked={settings.enabled} onChange={(enabled) => updateSettings({ enabled })} className="settings-toggle-control" />
                    </span>
                </div>
            </div>

            {/* --- Card grid --- */}
            {settings.configs.length === 0 ? (
                <div className="ui-empty">
                    <div className="ui-icon-circle">
                        <Image size={24} />
                    </div>
                    <span className="menu-label font-semibold">没有生图方案</span>
                    <span className="menu-desc max-w-[240px]">
                        配置图像生成 API 以启用自动生图功能。
                    </span>
                    <button onClick={addConfig} className="ui-btn ui-btn-primary rounded-[20px] mt-2">
                        <Plus size={16} /> 添加生图方案
                    </button>
                </div>
            ) : (
                <div className="grid grid-cols-2 gap-3">
                    {settings.configs.map(config => {
                        const isActive = activeConfig?.id === config.id;
                        return (
                            <div
                                key={config.id}
                                className="ui-config-card min-w-0 cursor-pointer"
                                style={{
                                    aspectRatio: "3 / 2",
                                    padding: "12px",
                                    justifyContent: "space-between",
                                    boxShadow: isActive ? ACTIVE_CARD_RING : undefined,
                                }}
                                role="button"
                                tabIndex={0}
                                aria-label={`编辑 ${config.name || config.model}`}
                                onClick={() => openEditModal(config.id)}
                                onKeyDown={(event) => {
                                    if (event.target !== event.currentTarget) return;
                                    if (event.key === "Enter" || event.key === " ") {
                                        event.preventDefault();
                                        openEditModal(config.id);
                                    }
                                }}
                            >
                                <div className="min-w-0 flex flex-col gap-1">
                                    <span className="truncate text-[calc(14.4px*var(--app-text-scale,1))] font-bold leading-tight text-[var(--c-text-title)]">
                                        {config.name || config.model || "未命名方案"}
                                    </span>
                                    <span className="menu-desc truncate">{config.model || "未设置模型"}</span>
                                    <span className="menu-desc truncate opacity-70">{config.baseUrl || "未设置 Base URL"}</span>
                                </div>
                                <div className="flex items-center justify-between gap-2 shrink-0">
                                    <button
                                        type="button"
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            activateConfig(config.id);
                                        }}
                                        className="inline-flex items-center gap-1 text-[11px] font-semibold"
                                        style={{ color: isActive ? "#0EA5E9" : undefined }}
                                        aria-label={isActive ? "当前使用方案" : "设为当前使用方案"}
                                    >
                                        <span
                                            className="inline-flex h-4 w-4 items-center justify-center rounded-full border"
                                            style={{
                                                borderColor: isActive ? "#0EA5E9" : "var(--c-icon)",
                                                background: isActive ? "#0EA5E9" : "transparent",
                                            }}
                                        >
                                            {isActive && <Check size={10} color="white" strokeWidth={3} />}
                                        </span>
                                        <span>{isActive ? "使用中" : "使用此方案"}</span>
                                    </button>
                                    <div className="flex gap-1">
                                        <button
                                            type="button"
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                openEditModal(config.id);
                                            }}
                                            className="ui-link-btn"
                                            aria-label="编辑方案"
                                        >
                                            <FileEdit size={16} />
                                        </button>
                                        <button
                                            type="button"
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                setConfirmDeleteId(config.id);
                                            }}
                                            className="ui-link-btn"
                                            data-variant="danger"
                                            aria-label="删除方案"
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* --- Extra prompt + test generation (uses active config) --- */}
            <div className="menu-group p-4 flex flex-col gap-4">
                <div className="flex flex-col gap-1">
                    <label className="menu-desc ml-1">补充提示词</label>
                    <Textarea
                        value={settings.extraPrompt}
                        onChange={(event) => updateSettings({ extraPrompt: event.target.value })}
                        placeholder="会和角色输出的图片描述一起发送给生图模型。"
                        rows={4}
                    />
                    <p className="menu-desc ml-1 opacity-70">
                        选择尺寸后会自动在末尾追加一句「{RATIO_HINT_MARKER}…」构图提示，用于纠正部分不认 size 参数的接口（如 gpt-image-2）。可手动修改或删除。当前激活方案尺寸：{activeConfig?.size ?? "未设置"}
                    </p>
                </div>

                <div className="flex gap-3">
                    <button
                        type="button"
                        onClick={testGeneration}
                        disabled={isTesting}
                        className="ui-btn ui-btn-success flex-1"
                    >
                        <Image size={16} />
                        {isTesting ? "测试中..." : "测试生图"}
                    </button>
                </div>

                {status && (
                    <Alert variant={status.success ? "success" : "danger"}>
                        <AlertCircle size={16} className="mt-[2px] shrink-0" />
                        <span className="break-all leading-[1.5]">{status.message}</span>
                    </Alert>
                )}
                {testPreviewUrl && (
                    <img
                        src={testPreviewUrl}
                        alt="测试生图结果"
                        className="max-h-[220px] max-w-full self-start rounded-xl border border-[var(--c-card-border)] object-contain"
                    />
                )}
            </div>

            {/* --- Edit modal --- */}
            {editingId && editingConfig && (
                <div className="modal-overlay modal-overlay-bottom">
                    <div className="modal-sheet" data-ui="modal-sheet">
                        <div className="modal-header" data-ui="modal-header">
                            <button onClick={closeModal} className="modal-header-btn modal-header-btn-muted"><X size={18} /></button>
                            <span className="modal-header-title">{isNewConfig ? "添加生图方案" : "编辑生图方案"}</span>
                            <button onClick={confirmModal} className="modal-header-btn modal-header-btn-action"><Check size={18} /></button>
                        </div>

                        <div className="modal-body hide-scrollbar pb-10" data-ui="modal-body">
                            <div className="flex flex-col gap-4">
                                {/* Name */}
                                <div className="flex flex-col gap-1">
                                    <label className="menu-desc ml-1">方案名称</label>
                                    <Input
                                        type="text"
                                        value={editingConfig.name || ""}
                                        onChange={(event) => updateConfig(editingConfig.id, { name: event.target.value })}
                                        placeholder="例如：默认生图"
                                    />
                                </div>

                                {/* Request mode */}
                                <div className="flex flex-col gap-1">
                                    <label className="menu-desc ml-1">请求方式</label>
                                    <Select
                                        value={editingConfig.requestMode}
                                        onChange={(event) => updateConfig(editingConfig.id, {
                                            requestMode: event.target.value as ImageApiConfig["requestMode"],
                                        })}
                                    >
                                        <option value="server">服务端转发</option>
                                        <option value="direct">浏览器直连</option>
                                    </Select>
                                    <span className="menu-desc ml-1">
                                        浏览器直连会从当前设备直接请求生图 API，可绕开部署平台函数超时；需要接口允许跨域。
                                    </span>
                                </div>

                                {/* Base URL */}
                                <div className="flex flex-col gap-1">
                                    <label className="menu-desc ml-1">Base URL</label>
                                    <Input
                                        type="url"
                                        value={editingConfig.baseUrl}
                                        onChange={(event) => updateConfig(editingConfig.id, { baseUrl: event.target.value })}
                                        placeholder="https://api.example.com/v1"
                                    />
                                </div>

                                {/* API Key */}
                                <div className="flex flex-col gap-1">
                                    <label className="menu-desc ml-1">API Key</label>
                                    <Input
                                        type="password"
                                        value={editingConfig.apiKey}
                                        onChange={(event) => updateConfig(editingConfig.id, { apiKey: event.target.value })}
                                        placeholder="sk-..."
                                    />
                                </div>

                                {/* Model with fetch button */}
                                <div className="flex flex-col gap-1">
                                    <label className="menu-desc ml-1">模型名</label>
                                    <div className="flex gap-2">
                                        {/* 单框合一:可手动输入;拉取到模型后右侧出现下拉箭头,点开原生选择器选中即回填 */}
                                        <div className="relative flex-1">
                                            <Input
                                                type="text"
                                                value={editingConfig.model}
                                                onChange={(event) => updateConfig(editingConfig.id, { model: event.target.value })}
                                                placeholder="gpt-image-2 / image2 / chatgpt-image-latest"
                                                className={likelyModels.length > 0 ? "w-full pr-9" : "w-full"}
                                            />
                                            {likelyModels.length > 0 && (
                                                <>
                                                    <ChevronDown size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 opacity-60" />
                                                    <select
                                                        aria-label="选择拉取到的模型"
                                                        value=""
                                                        onChange={(event) => {
                                                            if (event.target.value) updateConfig(editingConfig.id, { model: event.target.value });
                                                        }}
                                                        className="absolute inset-y-0 right-0 w-10 cursor-pointer opacity-0"
                                                    >
                                                        <option value="">选择拉取到的模型...</option>
                                                        {likelyModels.map(model => <option key={model} value={model}>{model}</option>)}
                                                    </select>
                                                </>
                                            )}
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => fetchModels(editingConfig.id)}
                                            disabled={isFetchingModels}
                                            className="ui-btn ui-btn-soft-action shrink-0"
                                        >
                                            <RefreshCw size={16} className={isFetchingModels ? "animate-spin" : ""} />
                                            {isFetchingModels ? "拉取中" : "拉取模型"}
                                        </button>
                                    </div>
                                </div>

                                {/* Size & Quality */}
                                <div className="grid grid-cols-2 gap-3">
                                    <div className="flex flex-col gap-1">
                                        <label className="menu-desc ml-1">尺寸</label>
                                        <Select
                                            value={editingConfig.size}
                                            onChange={(event) => updateConfig(editingConfig.id, { size: event.target.value })}
                                        >
                                            {SIZE_OPTIONS.map(option => <option key={option} value={option}>{option}</option>)}
                                        </Select>
                                    </div>
                                    <div className="flex flex-col gap-1">
                                        <label className="menu-desc ml-1">质量</label>
                                        <Select
                                            value={editingConfig.quality}
                                            onChange={(event) => updateConfig(editingConfig.id, { quality: event.target.value })}
                                        >
                                            {QUALITY_OPTIONS.map(option => <option key={option} value={option}>{option}</option>)}
                                        </Select>
                                    </div>
                                </div>

                                {/* Status (fetch results) */}
                                {status && (
                                    <Alert variant={status.success ? "success" : "danger"}>
                                        <AlertCircle size={16} className="mt-[2px] shrink-0" />
                                        <span className="break-all leading-[1.5]">{status.message}</span>
                                    </Alert>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* --- Delete confirmation --- */}
            {confirmDeleteId && (
                <ConfirmDialog
                    title="确认删除？"
                    message="删除生图方案后无法恢复。是否继续？"
                    icon={AlertCircle}
                    variant="danger"
                    confirmLabel="确认删除"
                    cancelLabel="取消"
                    onConfirm={() => {
                        removeConfig(confirmDeleteId);
                        setConfirmDeleteId(null);
                    }}
                    onCancel={() => setConfirmDeleteId(null)}
                />
            )}

            {/* --- Image Hosting (unchanged) --- */}
            <div className="flex flex-col gap-2">
                <p className="settings-menu-section-title">Image Hosting</p>
                <div className="menu-group">
                    <div className="menu-item">
                        <span className="card-icon" style={imageGenerationIconStyle}>
                            <Upload size={22} strokeWidth={1.75} />
                        </span>
                        <span className="settings-tools-menu-copy">
                            <span className="menu-label appearance-menu-item-label">允许小卷上传图床</span>
                            <span className="menu-desc settings-tools-menu-desc">开启后，小卷的图像处理套件可以把本地素材上传到公开图床并拿 URL 写 CSS。</span>
                        </span>
                        <span className="menu-right settings-tools-menu-toggle">
                            <Toggle
                                checked={settings.imageHosting.allowMascotUpload}
                                onChange={(allowMascotUpload) => updateImageHosting({ allowMascotUpload })}
                                className="settings-toggle-control"
                            />
                        </span>
                    </div>
                </div>

                <div className="menu-group p-4 flex flex-col gap-4">
                    <div className="flex flex-col gap-1">
                        <label className="menu-desc ml-1">图床提供方</label>
                        <Select
                            value={settings.imageHosting.provider}
                            onChange={(event) => updateImageHosting({
                                provider: event.target.value as ImageGenerationSettingsType["imageHosting"]["provider"],
                            })}
                        >
                            {IMAGE_HOSTING_PROVIDER_OPTIONS.map(option => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                        </Select>
                    </div>

                    <div className="flex flex-col gap-1">
                        <label className="menu-desc ml-1">ImgBB API Key</label>
                        <Input
                            type="password"
                            value={settings.imageHosting.imgbbApiKey}
                            onChange={(event) => updateImageHosting({ imgbbApiKey: event.target.value })}
                            placeholder="从 imgbb.com/api/1 获取"
                            disabled={settings.imageHosting.provider !== "imgbb"}
                        />
                        <span className="menu-desc ml-1">Key 只保存在当前项目设置里；小卷工具结果不会显示它。</span>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div className="flex flex-col gap-1">
                            <label className="menu-desc ml-1">默认过期秒数</label>
                            <Input
                                type="number"
                                min={0}
                                max={15552000}
                                value={settings.imageHosting.defaultExpirationSeconds}
                                onChange={(event) => updateImageHosting({
                                    defaultExpirationSeconds: Math.max(0, Number.parseInt(event.target.value, 10) || 0),
                                })}
                                disabled={settings.imageHosting.provider !== "imgbb"}
                            />
                            <span className="menu-desc ml-1">0 表示不过期。</span>
                        </div>
                        <div className="flex flex-col gap-1">
                            <label className="menu-desc ml-1">上传上限 KB</label>
                            <Input
                                type="number"
                                min={64}
                                max={32768}
                                value={Math.round(settings.imageHosting.maxUploadBytes / 1024)}
                                onChange={(event) => updateImageHosting({
                                    maxUploadBytes: Math.max(64, Number.parseInt(event.target.value, 10) || 900) * 1024,
                                })}
                                disabled={settings.imageHosting.provider !== "imgbb"}
                            />
                            <span className="menu-desc ml-1">默认 900KB，适合 CSS 主题素材。</span>
                        </div>
                    </div>

                    <div className="menu-item !px-0 !py-0">
                        <span className="settings-tools-menu-copy">
                            <span className="menu-label appearance-menu-item-label">上传前自动转 WebP</span>
                            <span className="menu-desc settings-tools-menu-desc">减小 PNG/JPEG 体积；GIF 会保留原格式。</span>
                        </span>
                        <span className="menu-right settings-tools-menu-toggle">
                            <Toggle
                                checked={settings.imageHosting.autoConvertToWebp}
                                onChange={(autoConvertToWebp) => updateImageHosting({ autoConvertToWebp })}
                                className="settings-toggle-control"
                                disabled={settings.imageHosting.provider !== "imgbb"}
                            />
                        </span>
                    </div>
                </div>
            </div>

            {/* --- Character References (unchanged) --- */}
            <div className="flex flex-col gap-2">
                <p className="settings-menu-section-title">Character References</p>
                <div className="menu-group">
                    {characters.length === 0 ? (
                        <div className="ui-empty py-8">
                            <Camera size={22} />
                            <span className="menu-desc">暂无角色。</span>
                        </div>
                    ) : characters.map(character => {
                        const preview = referencePreviews[character.id];
                        return (
                            <div key={character.id} className="menu-item">
                                <span className="h-11 w-11 shrink-0 overflow-hidden rounded-xl bg-[var(--c-input)]">
                                    {preview ? (
                                        <img src={preview} alt="" className="h-full w-full object-cover" />
                                    ) : character.avatar ? (
                                        <img src={character.avatar} alt="" className="h-full w-full object-cover" />
                                    ) : (
                                        <span className="flex h-full w-full items-center justify-center ts-13 font-semibold text-[var(--c-icon)]">
                                            {character.name.slice(0, 1)}
                                        </span>
                                    )}
                                </span>
                                <span className="min-w-0 flex flex-1 flex-col">
                                    <span className="menu-label truncate">{character.name}</span>
                                    <span className="menu-desc truncate">{preview ? "已上传参考图" : "未上传参考图"}</span>
                                </span>
                                <span className="menu-right flex gap-2">
                                    <button
                                        type="button"
                                        className="ui-link-btn"
                                        aria-label={`上传 ${character.name} 的参考图`}
                                        onClick={() => {
                                            const input = document.createElement("input");
                                            input.type = "file";
                                            input.accept = "image/*";
                                            input.onchange = async () => {
                                                const file = input.files?.[0];
                                                if (file) await uploadReference(character.id, file);
                                            };
                                            input.click();
                                        }}
                                    >
                                        <Upload size={18} />
                                    </button>
                                    {preview && (
                                        <button
                                            type="button"
                                            className="ui-link-btn"
                                            data-variant="danger"
                                            aria-label={`删除 ${character.name} 的参考图`}
                                            onClick={() => removeReference(character.id)}
                                        >
                                            <Trash2 size={18} />
                                        </button>
                                    )}
                                </span>
                            </div>
                        );
                    })}
                </div>
            </div>

        </div>
    );
}
