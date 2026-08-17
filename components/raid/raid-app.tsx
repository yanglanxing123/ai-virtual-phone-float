"use client";

import { useState, useEffect, useCallback } from "react";
import type { RaidDungeon, RaidTheme } from "./raid-types";
import { THEME_LABELS } from "./raid-types";
import { loadDungeons, deleteDungeon } from "./raid-storage";
import { RaidSetup } from "./raid-setup";
import { RaidStory } from "./raid-story";

type RaidView = "home" | "setup" | "story";

type RaidAppProps = {
    onClose: () => void;
    onNotice?: (msg: string) => void;
};

export function RaidApp({ onClose, onNotice }: RaidAppProps) {
    const [view, setView] = useState<RaidView>("home");
    const [dungeons, setDungeons] = useState<RaidDungeon[]>([]);
    const [activeDungeonId, setActiveDungeonId] = useState<string | null>(null);

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

    function handleBack() {
        if (view === "story" || view === "setup") {
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
}: {
    dungeon: RaidDungeon;
    onContinue: () => void;
    onDelete: () => void;
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
    );
}
