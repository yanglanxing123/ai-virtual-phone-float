"use client";

import { useEffect } from "react";

/**
 * 全局键盘视口处理器
 *
 * 使用 Visual Viewport API 检测键盘高度。
 * phone-shell 高度始终由 CSS 100vh 控制（不随键盘缩小），避免内容压缩到顶部。
 * 键盘弹出时仅设置 --vkbd-height，让 bottom 定位的元素（输入栏等）自动上移。
 *
 * 设置的 CSS 变量：
 * --vkbd-height: 键盘高度（px，无键盘时为 0）
 *
 * 适配策略：
 * - phone-shell 高度 = 100vh（CSS 控制，始终铺满全屏，不缩小）
 * - 键盘出现时 --vkbd-height = 键盘高度，输入栏 bottom: var(--vkbd-height) 上移贴键盘
 * - 顶部保持固定，不因键盘出现而上移
 *
 * 平台差异：
 * - iOS PWA: window.innerHeight = 全屏高度，不随键盘变化
 * - Android: window.innerHeight 可能随键盘减小，用 maxVh 保留无键盘时的最大值
 * - 两种平台 visualViewport.height 始终 = 键盘上方的可视区域高度
 */
export function KeyboardViewportHandler() {
    useEffect(() => {
        if (typeof window === "undefined") return;

        const vv = window.visualViewport;
        if (!vv) return;
        const viewport = vv;

        let ticking = false;
        // 记录无键盘时的全屏高度（用于计算键盘高度）
        // iOS: window.innerHeight 始终 = 全屏高度，可直接作为参考
        // Android: 需要记录历史最大值
        let maxVh = Math.max(viewport.height, window.innerHeight);

        function update() {
            ticking = false;
            const vh = viewport.height;

            // 参考全屏高度 = max(window.innerHeight, maxVh)
            const refHeight = Math.max(window.innerHeight, maxVh);

            // 如果当前可视高度接近参考高度（差值 <= 10px），说明无键盘，更新 maxVh
            if (vh >= refHeight - 10) {
                maxVh = Math.max(maxVh, vh);
            }

            // 键盘高度 = 参考全屏高度 - 当前可视高度
            const kw = Math.max(0, refHeight - vh);

            // 只设置键盘高度变量，不修改 phone-shell 高度
            // phone-shell 始终 = 100vh（CSS 控制），键盘弹出时不缩小
            // 输入栏等 bottom 元素用 bottom: var(--vkbd-height, 0px) 自动上移
            const root = document.documentElement;
            root.style.setProperty("--vkbd-height", `${kw}px`);
        }

        function onResize() {
            if (!ticking) {
                ticking = true;
                requestAnimationFrame(update);
            }
        }

        function onOrientationChange() {
            // 旋转设备时重置最大高度，下一帧重新检测
            maxVh = 0;
            requestAnimationFrame(() => {
                maxVh = Math.max(viewport.height, window.innerHeight);
                update();
            });
        }

        update();
        viewport.addEventListener("resize", onResize);
        window.addEventListener("orientationchange", onOrientationChange);
        window.addEventListener("resize", onResize);

        return () => {
            viewport.removeEventListener("resize", onResize);
            window.removeEventListener("orientationchange", onOrientationChange);
            window.removeEventListener("resize", onResize);
            const root = document.documentElement;
            root.style.removeProperty("--vkbd-height");
        };
    }, []);

    return null;
}
