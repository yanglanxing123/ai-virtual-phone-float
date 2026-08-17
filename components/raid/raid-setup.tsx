"use client";

import { useState, useEffect, useCallback } from "react";
import type { Character } from "@/lib/character-types";
import { loadCharacters } from "@/lib/character-storage";
import type {
    RaidTheme,
    NovelType,
    Difficulty,
    StoryMode,
    DungeonNpc,
    RaidDungeon,
} from "./raid-types";
import {
    THEME_LABELS,
    NOVEL_TYPE_LABELS,
    DIFFICULTY_LABELS,
    DIFFICULTY_DESC,
    STORY_MODE_LABELS,
} from "./raid-types";
import {
    DUNGEON_PRESETS,
    getRandomPreset,
    extractBlanks,
    fillTemplate,
} from "./raid-presets";
import { createDungeon } from "./raid-storage";
import { generateNpcs } from "./raid-engine";

type SetupStep = "characters" | "settings" | "worldview" | "mode" | "reference" | "generating";

type RaidSetupProps = {
    onBack: () => void;
    onCreated: (dungeon: RaidDungeon) => void;
    onNotice?: (msg: string) => void;
};

const ALL_THEMES: RaidTheme[] = ["ancient", "modern", "mono", "cyber", "horror", "cozy"];
const ALL_NOVEL_TYPES: NovelType[] = [
    "rebirth", "system", "transmigration", "sweet", "abuse",
    "harem", "undercover", "apocalypse", "campus", "business",
    "immortal", "palace",
];
const ALL_DIFFICULTIES: Difficulty[] = ["easy", "normal", "hard", "hell"];

export function RaidSetup({ onBack, onCreated, onNotice }: RaidSetupProps) {
    const [step, setStep] = useState<SetupStep>("characters");
    const [characters, setCharacters] = useState<Character[]>([]);
    const [selectedCharIds, setSelectedCharIds] = useState<string[]>([]);
    const [novelType, setNovelType] = useState<NovelType>("rebirth");
    const [theme, setTheme] = useState<RaidTheme>("modern");
    const [difficulty, setDifficulty] = useState<Difficulty>("normal");
    const [presetId, setPresetId] = useState<string>("preset_rebirth");
    const [worldviewText, setWorldviewText] = useState("");
    const [blankValues, setBlankValues] = useState<string[]>([]);
    const [mode, setMode] = useState<StoryMode>("novel");
    const [bgmUrl, setBgmUrl] = useState<string | undefined>(undefined);
    const [bgmName, setBgmName] = useState<string | undefined>(undefined);
    const [genError, setGenError] = useState<string | null>(null);
    const [genProgress, setGenProgress] = useState("");
    const [styleReferenceImage, setStyleReferenceImage] = useState<string | undefined>(undefined);
    const [customDungeonName, setCustomDungeonName] = useState<string>("");

    useEffect(() => {
        setCharacters(loadCharacters());
    }, []);

    const preset = DUNGEON_PRESETS.find((p) => p.id === presetId) || DUNGEON_PRESETS[0];
    const blanks = extractBlanks(preset.worldviewTemplate);

    // 切换预设时重置填空
    useEffect(() => {
        setBlankValues(new Array(blanks.length).fill(""));
    }, [presetId]); // eslint-disable-line react-hooks/exhaustive-deps

    function toggleCharacter(id: string) {
        setSelectedCharIds((prev) =>
            prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
        );
    }

    function handlePresetChange(type: NovelType) {
        const p = DUNGEON_PRESETS.find((x) => x.novelType === type);
        if (p) {
            setNovelType(type);
            setPresetId(p.id);
            // 自动推荐画风
            if (p.themes.length > 0) {
                setTheme(p.themes[0]);
            }
        }
    }

    function handleRandomPreset() {
        const p = getRandomPreset();
        setNovelType(p.novelType);
        setPresetId(p.id);
        if (p.themes.length > 0) setTheme(p.themes[0]);
        setBlankValues(new Array(extractBlanks(p.worldviewTemplate).length).fill(""));
        onNotice?.(`随机选择了「${p.name}」`);
    }

    function getFinalWorldview(): string {
        if (worldviewText.trim()) return worldviewText.trim();
        return fillTemplate(preset.worldviewTemplate, blankValues);
    }

    async function handleGenerate() {
        setStep("generating");
        setGenError(null);
        setGenProgress("正在构建世界……");

        const finalWorldview = getFinalWorldview();
        if (!finalWorldview || finalWorldview.trim().length < 10) {
            setGenError("世界观太短了，请至少填写 10 个字");
            setStep("worldview");
            return;
        }

        const targetChars = characters
            .filter((c) => selectedCharIds.includes(c.id))
            .map((c) => ({
                id: c.id,
                name: c.name,
                persona: c.persona || "",
                personality: c.personality || "",
            }));

        try {
            setGenProgress("正在生成角色人设……");
            const npcs = await generateNpcs({
                worldview: finalWorldview,
                novelType,
                theme,
                difficulty,
                targetCharacters: targetChars,
            });

            setGenProgress("正在创建副本……");
            const favor: Record<string, number> = {};
            for (const npc of npcs) {
                favor[npc.id] = npc.initialFavor;
            }

            const dungeon = createDungeon({
                name: customDungeonName.trim() || preset.name,
                theme,
                novelType,
                difficulty,
                worldview: finalWorldview,
                mode,
                targetCharacterIds: selectedCharIds,
                npcs,
                favor,
                bgmUrl,
                bgmName,
                styleReferenceImage,
            });

            onNotice?.("副本创建成功！");
            onCreated(dungeon);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            setGenError(msg);
            setStep("reference");
        }
    }

    function handleBgmImport(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            setBgmUrl(reader.result as string);
            setBgmName(file.name);
            onNotice?.(`配乐已导入：${file.name}`);
        };
        reader.readAsDataURL(file);
    }

    // ── 生成中 ──
    if (step === "generating") {
        return (
            <>
                <header className="raid-header">
                    <button className="raid-back-btn" onClick={onBack}>←</button>
                    <div className="raid-header-title">
                        <h1>构建副本</h1>
                    </div>
                    <div />
                </header>
                <main className="raid-body raid-loading-container">
                    <div className="raid-loading" />
                    <p className="raid-loading-text">{genProgress}</p>
                    {genError && (
                        <div className="raid-gen-error">
                            <p>{genError}</p>
                            <button
                                className="raid-btn raid-btn--primary"
                                onClick={() => setStep("reference")}
                            >
                                返回修改
                            </button>
                        </div>
                    )}
                </main>
            </>
        );
    }

    // ── 步骤 1: 角色选择 ──
    if (step === "characters") {
        return (
            <>
                <header className="raid-header">
                    <button className="raid-back-btn" onClick={onBack}>←</button>
                    <div className="raid-header-title">
                        <h1>选择角色</h1>
                        <span className="raid-header-sub">SELECT CHARACTER</span>
                    </div>
                    <button className="raid-more-btn">···</button>
                </header>
                <main className="raid-body">
                    <p className="raid-step-hint">
                        选择你想攻略的角色（可多选，也可不选让 AI 自创）
                    </p>
                    {characters.length === 0 ? (
                        <div className="raid-empty-state">
                            <p>手机里还没有角色</p>
                            <p className="raid-empty-desc">不选择也可以，AI 会自动生成角色</p>
                        </div>
                    ) : (
                        <div className="raid-char-cards">
                            {characters.map((c, i) => {
                                const selected = selectedCharIds.includes(c.id);
                                return (
                                    <div
                                        key={c.id}
                                        className={`raid-char-card ${selected ? "raid-char-card--active" : ""}`}
                                        style={{ animationDelay: `${i * 0.08}s` }}
                                        onClick={() => toggleCharacter(c.id)}
                                    >
                                        {c.avatar ? (
                                            <img
                                                src={c.avatar}
                                                alt={c.name}
                                                className="raid-char-card-img"
                                            />
                                        ) : (
                                            <div className="raid-char-card-placeholder">
                                                {c.name.charAt(0)}
                                            </div>
                                        )}
                                        <span className="raid-char-card-name">{c.name}</span>
                                        {selected && (
                                            <span className="raid-char-card-check">✓</span>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                    <div className="raid-setup-actions">
                        <button
                            className="raid-btn raid-btn--primary"
                            onClick={() => setStep("settings")}
                        >
                            {selectedCharIds.length > 0
                                ? `已选 ${selectedCharIds.length} 人，下一步`
                                : "不选角色，下一步"}
                        </button>
                    </div>
                </main>
            </>
        );
    }

    // ── 步骤 2: 类型/画风/难度 ──
    if (step === "settings") {
        return (
            <>
                <header className="raid-header">
                    <button className="raid-back-btn" onClick={() => setStep("characters")}>←</button>
                    <div className="raid-header-title">
                        <h1>副本设定</h1>
                        <span className="raid-header-sub">DUNGEON SETUP</span>
                    </div>
                    <div />
                </header>
                <main className="raid-body">
                    {/* 小说类型 */}
                    <section className="raid-setup-section">
                        <label className="raid-setup-label">小说类型</label>
                        <div className="raid-novel-grid">
                            {ALL_NOVEL_TYPES.map((t) => (
                                <button
                                    key={t}
                                    className={`raid-novel-option ${novelType === t ? "raid-novel-option--active" : ""}`}
                                    onClick={() => handlePresetChange(t)}
                                >
                                    {NOVEL_TYPE_LABELS[t]}
                                </button>
                            ))}
                        </div>
                        <p className="raid-setup-desc">{preset.description}</p>
                        <button
                            className="raid-btn raid-btn--ghost raid-random-btn"
                            onClick={handleRandomPreset}
                        >
                            🎲 随机副本
                        </button>
                    </section>

                    {/* 画风 */}
                    <section className="raid-setup-section">
                        <label className="raid-setup-label">画风</label>
                        <div className="raid-theme-grid">
                            {ALL_THEMES.map((t) => (
                                <button
                                    key={t}
                                    className={`raid-theme-option raid-theme-dot raid-theme-${t} ${theme === t ? "raid-theme-option--active" : ""}`}
                                    onClick={() => setTheme(t)}
                                >
                                    {THEME_LABELS[t]}
                                </button>
                            ))}
                        </div>
                    </section>

                    {/* 难度 */}
                    <section className="raid-setup-section">
                        <label className="raid-setup-label">攻略难度</label>
                        <div className="raid-difficulty-grid">
                            {ALL_DIFFICULTIES.map((d) => (
                                <button
                                    key={d}
                                    className={`raid-difficulty-option raid-difficulty--${d} ${difficulty === d ? "raid-difficulty-option--active" : ""}`}
                                    onClick={() => setDifficulty(d)}
                                >
                                    <span className="raid-difficulty-name">{DIFFICULTY_LABELS[d]}</span>
                                </button>
                            ))}
                        </div>
                        <p className="raid-setup-desc">{DIFFICULTY_DESC[difficulty]}</p>
                    </section>

                    <div className="raid-setup-actions">
                        <button
                            className="raid-btn raid-btn--primary"
                            onClick={() => setStep("worldview")}
                        >
                            下一步
                        </button>
                    </div>
                </main>
            </>
        );
    }

    // ── 步骤 3: 世界观 ──
    if (step === "worldview") {
        return (
            <>
                <header className="raid-header">
                    <button className="raid-back-btn" onClick={() => setStep("settings")}>←</button>
                    <div className="raid-header-title">
                        <h1>世界观</h1>
                        <span className="raid-header-sub">WORLDVIEW</span>
                    </div>
                    <div />
                </header>
                <main className="raid-body">
                    <section className="raid-setup-section">
                        <label className="raid-setup-label">
                            世界观设定
                            <span className="raid-setup-label-hint">（填空或自定义）</span>
                        </label>

                        {/* 填空模式 */}
                        <div className="raid-worldview-template">
                            {preset.worldviewTemplate.split(/_{2,}/).map((part, i, arr) => (
                                <span key={i}>
                                    {part}
                                    {i < arr.length - 1 && (
                                        <input
                                            type="text"
                                            className="raid-blank-input"
                                            placeholder={`填空${i + 1}`}
                                            value={blankValues[i] || ""}
                                            onChange={(e) => {
                                                const next = [...blankValues];
                                                next[i] = e.target.value;
                                                setBlankValues(next);
                                            }}
                                        />
                                    )}
                                </span>
                            ))}
                        </div>

                        <div className="raid-worldview-divider">
                            <span>或 自定义世界观</span>
                        </div>

                        <textarea
                            className="raid-worldview-editor"
                            placeholder="直接输入你的世界观设定……（填了这里就用你的，不填用上面的模板）"
                            value={worldviewText}
                            onChange={(e) => setWorldviewText(e.target.value)}
                            rows={6}
                        />
                    </section>

                    <div className="raid-setup-actions">
                        <button
                            className="raid-btn raid-btn--primary"
                            onClick={() => setStep("mode")}
                        >
                            下一步
                        </button>
                    </div>
                </main>
            </>
        );
    }

    // ── 步骤 4: 模式 + 配乐 + 确认 ──
    if (step === "mode") {
        return (
            <>
                <header className="raid-header">
                    <button className="raid-back-btn" onClick={() => setStep("worldview")}>←</button>
                    <div className="raid-header-title">
                        <h1>攻略模式</h1>
                        <span className="raid-header-sub">GAME MODE</span>
                    </div>
                    <div />
                </header>
                <main className="raid-body">
                    {genError && (
                        <div className="raid-gen-error raid-gen-error--inline">
                            <p>{genError}</p>
                            <button
                                className="raid-btn raid-btn--ghost raid-btn-sm"
                                onClick={() => setGenError(null)}
                            >
                                知道了
                            </button>
                        </div>
                    )}
                    <section className="raid-setup-section">
                        <label className="raid-setup-label">副本名称</label>
                        <input
                            type="text"
                            className="raid-dungeon-name-input"
                            placeholder={`自定义副本名称（不填则使用「${preset.name}」）`}
                            value={customDungeonName}
                            onChange={(e) => setCustomDungeonName(e.target.value)}
                            maxLength={30}
                        />
                    </section>

                    <section className="raid-setup-section">
                        <label className="raid-setup-label">显示模式</label>
                        <div className="raid-mode-select">
                            <button
                                className={`raid-mode-option ${mode === "novel" ? "raid-mode-option--active" : ""}`}
                                onClick={() => setMode("novel")}
                            >
                                <div className="raid-mode-icon">📖</div>
                                <div className="raid-mode-name">{STORY_MODE_LABELS.novel}</div>
                                <div className="raid-mode-desc">文字叙事，沉浸阅读</div>
                            </button>
                            <button
                                className={`raid-mode-option ${mode === "portrait" ? "raid-mode-option--active" : ""}`}
                                onClick={() => setMode("portrait")}
                            >
                                <div className="raid-mode-icon">🎭</div>
                                <div className="raid-mode-name">{STORY_MODE_LABELS.portrait}</div>
                                <div className="raid-mode-desc">立绘对话，乙游体验</div>
                            </button>
                        </div>
                    </section>

                    <section className="raid-setup-section">
                        <label className="raid-setup-label">配乐（可选）</label>
                        <div className="raid-bgm-import">
                            {bgmName ? (
                                <div className="raid-bgm-info">
                                    <span className="raid-bgm-name">🎵 {bgmName}</span>
                                    <button
                                        className="raid-btn raid-btn--ghost raid-btn-sm"
                                        onClick={() => { setBgmUrl(undefined); setBgmName(undefined); }}
                                    >
                                        移除
                                    </button>
                                </div>
                            ) : (
                                <label className="raid-bgm-upload">
                                    <input
                                        type="file"
                                        accept="audio/*"
                                        onChange={handleBgmImport}
                                        style={{ display: "none" }}
                                    />
                                    <span>📁 导入本地音乐</span>
                                </label>
                            )}
                        </div>
                    </section>

                    {/* 确认信息 */}
                    <section className="raid-setup-section raid-confirm-summary">
                        <label className="raid-setup-label">确认</label>
                        <div className="raid-confirm-row">
                            <span>类型</span><span>{NOVEL_TYPE_LABELS[novelType]}</span>
                        </div>
                        <div className="raid-confirm-row">
                            <span>画风</span><span>{THEME_LABELS[theme]}</span>
                        </div>
                        <div className="raid-confirm-row">
                            <span>难度</span><span>{DIFFICULTY_LABELS[difficulty]}</span>
                        </div>
                        <div className="raid-confirm-row">
                            <span>模式</span><span>{STORY_MODE_LABELS[mode]}</span>
                        </div>
                        <div className="raid-confirm-row">
                            <span>攻略角色</span>
                            <span>
                                {selectedCharIds.length > 0
                                    ? `${selectedCharIds.length} 人`
                                    : "AI 自动生成"}
                            </span>
                        </div>
                    </section>

                    <div className="raid-setup-actions">
                        <button
                            className="raid-btn raid-btn--primary raid-btn-lg"
                            onClick={() => setStep("reference")}
                        >
                            下一步
                        </button>
                    </div>
                </main>
            </>
        );
    }

    // ── 步骤: 画风参考图上传 ──
    if (step === "reference") {
        function handleReferenceUpload(e: React.ChangeEvent<HTMLInputElement>) {
            const file = e.target.files?.[0];
            if (!file) return;
            if (file.size > 8 * 1024 * 1024) {
                onNotice?.("参考图不能超过 8MB");
                return;
            }
            const reader = new FileReader();
            reader.onload = () => {
                setStyleReferenceImage(reader.result as string);
                onNotice?.("画风参考图已上传");
            };
            reader.readAsDataURL(file);
        }

        return (
            <>
                <header className="raid-header">
                    <button className="raid-back-btn" onClick={() => setStep("mode")}>←</button>
                    <div className="raid-header-title">
                        <h1>画风参考图</h1>
                        <span className="raid-header-sub">STYLE REFERENCE</span>
                    </div>
                    <div />
                </header>
                <main className="raid-body">
                    <p className="raid-step-hint">
                        上传一张画风参考图，AI 会在整个剧本的每次生图时参考这张图的风格（可选，但强烈推荐）
                    </p>

                    <section className="raid-setup-section">
                        {styleReferenceImage ? (
                            <div className="raid-reference-preview">
                                <img
                                    src={styleReferenceImage}
                                    alt="画风参考图"
                                    className="raid-reference-img"
                                />
                                <button
                                    className="raid-btn raid-btn--ghost raid-btn-sm"
                                    onClick={() => setStyleReferenceImage(undefined)}
                                >
                                    移除参考图
                                </button>
                            </div>
                        ) : (
                            <label className="raid-reference-upload">
                                <input
                                    type="file"
                                    accept="image/*"
                                    onChange={handleReferenceUpload}
                                    style={{ display: "none" }}
                                />
                                <div className="raid-reference-upload-placeholder">
                                    <span className="raid-reference-upload-icon">🎨</span>
                                    <span>点击上传画风参考图</span>
                                    <span className="raid-reference-upload-hint">
                                        建议上传与你期望画风一致的插图/立绘，<br />
                                        AI 将在生成所有场景图时参考此图的绘画风格
                                    </span>
                                </div>
                            </label>
                        )}
                    </section>

                    <div className="raid-setup-actions">
                        <button
                            className="raid-btn raid-btn--ghost raid-btn-lg"
                            onClick={handleGenerate}
                        >
                            跳过并开始
                        </button>
                        <button
                            className="raid-btn raid-btn--primary raid-btn-lg"
                            onClick={handleGenerate}
                            disabled={!styleReferenceImage}
                        >
                            开启攻略
                        </button>
                    </div>
                </main>
            </>
        );
    }

    return null;
}
