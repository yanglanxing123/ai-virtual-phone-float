"use client";

import { useState, useEffect, useCallback } from "react";
import type { RaidDungeon, RaidTheme } from "./raid-types";
import { THEME_LABELS } from "./raid-types";
import { loadDungeons, deleteDungeon, updateDungeon, findDungeon } from "./raid-storage";
import { RaidSetup } from "./raid-setup";
import { RaidStory } from "./raid-story";

type RaidView = "home" | "setup" | "story" | "settings";

type RaidAppProps = {
    onClose: () => void;
    onNotice?: (msg: string) => void;
};

export function RaidApp({ onClose, onNotice }: RaidAppProps) {
    const [view, setView] = useState<RaidView>("home");
    const [dungeons, setDungeons] = useState<RaidDungeon[]>([]);
    const [activeDungeonId, setActiveDungeonId] = useState<string | null>(null);
    const [customCss, setCustomCss] = useState("");

    const refresh = useCallback(() => {
        setDungeons(loadDungeons());
    }, []);

    useEffect(() => {
        refresh();
    }, [refresh]);

    const activeDungeon = dungeons.find((d) => d.id === activeDungeonId) || null;

    function handleStartNew() {
        setActiveDungeonId(null);
        setView("setup");
    }

    function handleDungeonCreated(dungeon: RaidDungeon) {
        setActiveDungeonId(dungeon.id);
        setView("story");
        refresh();
    }

    function handleContinue(id: string) {
        setActiveDungeonId(id);
        setView("story");
    }

    function handleDelete(id: string) {
        deleteDungeon(id);
        refresh();
        onNotice?.("副本已删除");
    }

    function handleSettings(id: string) {
        const d = findDungeon(id);
        setActiveDungeonId(id);
        setCustomCss(d?.customCss || "");
        setView("settings");
    }

    function handleSaveCss() {
        if (!activeDungeonId) return;
        updateDungeon(activeDungeonId, { customCss });
        refresh();
        onNotice?.("自定义 CSS 已保存");
    }

    function handleBack() {
        if (view === "story" || view === "setup" || view === "settings") {
            setView("home");
            setActiveDungeonId(null);
            refresh();
        } else {
            onClose();
        }
    }

    // ── Story view ──
    if (view === "story" && activeDungeon) {
        return (
            <div className={`raid-app raid-theme-${activeDungeon.theme}`}>
                {activeDungeon.customCss && (
                    <style dangerouslySetInnerHTML={{ __html: activeDungeon.customCss }} />
                )}
                <RaidStory
                    dungeon={activeDungeon}
                    onBack={handleBack}
                    onNotice={onNotice}
                    onUpdate={() => refresh()}
                />
            </div>
        );
    }

    // ── Setup view ──
    if (view === "setup") {
        return (
            <div className="raid-app raid-theme-modern">
                <RaidSetup
                    onBack={handleBack}
                    onCreated={handleDungeonCreated}
                    onNotice={onNotice}
                />
            </div>
        );
    }

    // ── Settings view ──
    if (view === "settings" && activeDungeon) {
        return (
            <div className="raid-app raid-theme-modern">
                {customCss && (
                    <style dangerouslySetInnerHTML={{ __html: customCss }} />
                )}
                <header className="raid-header">
                    <button className="raid-back-btn" onClick={handleBack} aria-label="返回">
                        ←
                    </button>
                    <div className="raid-header-title">
                        <h1>自定义样式</h1>
                        <span className="raid-header-sub">{activeDungeon.name}</span>
                    </div>
                    <span className="raid-header-spacer" />
                </header>

                <main className="raid-body">
                    <div className="raid-settings">
                        <p className="raid-settings-hint">
                            在此输入自定义 CSS，样式会应用到当前攻略副本 APP。建议以{" "}
                            <code>.raid-app</code> 作为选择器前缀，避免影响其他界面。
                        </p>
                        <textarea
                            className="raid-css-textarea"
                            value={customCss}
                            onChange={(e) => setCustomCss(e.target.value)}
                            placeholder={"/* 示例：*/\n.raid-app {\n  --raid-accent: #e91e63;\n}\n.raid-app .raid-header h1 {\n  color: var(--raid-accent);\n}"}
                            rows={14}
                            spellCheck={false}
                        />
                        <div className="raid-settings-actions">
                            <button
                                className="raid-btn raid-btn--primary"
                                onClick={handleSaveCss}
                            >
                                保存
                            </button>
                            <button
                                className="raid-btn"
                                onClick={() => setCustomCss(activeDungeon.customCss || "")}
                            >
                                重置
                            </button>
                        </div>
                    </div>
                </main>
            </div>
        );
    }

    // ── Home view ──
    return (
        <div className="raid-app raid-theme-modern">
            <header className="raid-header">
                <button className="raid-back-btn" onClick={onClose} aria-label="返回">
                    ←
                </button>
                <div className="raid-header-title">
                    <h1>攻略副本</h1>
                    <span className="raid-header-sub">RAID DUNGEON</span>
                </div>
                <button
                    className="raid-new-btn"
                    onClick={handleStartNew}
                    aria-label="新建副本"
                    title="新建副本"
                >
                    +
                </button>
            </header>

            <main className="raid-body">
                {dungeons.length === 0 ? (
                    <div className="raid-empty-state">
                        <div className="raid-empty-icon">📜</div>
                        <p className="raid-empty-title">还没有副本记录</p>
                        <p className="raid-empty-desc">点击右上角 + 开始你的第一场攻略</p>
                        <button className="raid-btn raid-btn--primary" onClick={handleStartNew}>
                            创建副本
                        </button>
                    </div>
                ) : (
                    <div className="raid-dungeon-list">
                        {dungeons.map((d) => (
                            <DungeonCard
                                key={d.id}
                                dungeon={d}
                                onContinue={() => handleContinue(d.id)}
                                onDelete={() => handleDelete(d.id)}
                                onSettings={() => handleSettings(d.id)}
                            />
                        ))}
                    </div>
                )}
            </main>
        </div>
    );
}

// ── 副本卡片 ──
function DungeonCard({
    dungeon,
    onContinue,
    onDelete,
    onSettings,
}: {
    dungeon: RaidDungeon;
    onContinue: () => void;
    onDelete: () => void;
    onSettings: () => void;
}) {
    const statusLabel =
        dungeon.status === "cleared" ? "已通关" :
        dungeon.status === "failed" ? "攻略失败" :
        dungeon.status === "setup" ? "未开始" : "进行中";

    const statusClass =
        dungeon.status === "cleared" ? "raid-status--cleared" :
        dungeon.status === "failed" ? "raid-status--failed" :
        dungeon.status === "setup" ? "raid-status--idle" : "raid-status--playing";

    return (
        <div className="raid-dungeon-card" onClick={onContinue}>
            <div className="raid-dungeon-card-actions">
                <button
                    className="raid-dungeon-card-settings"
                    onClick={(e) => {
                        e.stopPropagation();
                        onSettings();
                    }}
                    aria-label="自定义样式"
                    title="自定义样式"
                >
                    ⚙
                </button>
                <button
                    className="raid-dungeon-card-delete"
                    onClick={(e) => {
                        e.stopPropagation();
                        onDelete();
                    }}
                    aria-label="删除"
                >
                    ×
                </button>
            </div>
            <div className={`raid-dungeon-card-theme raid-theme-dot raid-theme-${dungeon.theme}`}>
                {THEME_LABELS[dungeon.theme]}
            </div>
            <div className="raid-dungeon-card-body">
                <h3 className="raid-dungeon-card-name">{dungeon.name}</h3>
                <div className="raid-dungeon-card-meta">
                    <span>{dungeon.currentChapter > 0 ? `第${dungeon.currentChapter}章` : "未开始"}</span>
                    <span>·</span>
                    <span>{dungeon.npcs.length} 位角色</span>
                    {dungeon.deathCount > 0 && (
                        <>
                            <span>·</span>
                            <span className="raid-death-count">死亡 {dungeon.deathCount} 次</span>
                        </>
                    )}
                </div>
                <span className={`raid-dungeon-card-status ${statusClass}`}>{statusLabel}</span>
            </div>
        </div>
    );
}
