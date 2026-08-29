"use client";

import { useEffect } from "react";

/**
 * 键盘视口处理器
 *
 * 使用 Visual Viewport API 精确检测键盘高度，
 * 当键盘弹出时动态调整 CSS 变量，防止界面整体上移。
 *
 * 设置的 CSS 变量：
 * --phone-screen-height: 可视视口高度（键盘弹出时自动缩小）
 * --vkbd-height: 键盘高度（px，无键盘时为 0）
 * --vvh: 可视视口高度（与 --phone-screen-height 同步）
 */
export function KeyboardViewportHandler() {
    useEffect(() => {
        if (typeof window === "undefined") return;

        const vv = window.visualViewport;
        if (!vv) return;
        // 捕获非空引用，闭包内安全使用（TypeScript 不会在闭包内保留窄化）
        const viewport = vv;

        let ticking = false;

        function update() {
            ticking = false;
            const vh = viewport.height;
            const kw = window.innerHeight - vh;
            const root = document.documentElement;
            root.style.setProperty("--phone-screen-height", `${vh}px`);
            root.style.setProperty("--vvh", `${vh}px`);
            root.style.setProperty("--vkbd-height", `${Math.max(0, kw)}px`);
        }

        function onResize() {
            if (!ticking) {
                ticking = true;
                requestAnimationFrame(update);
            }
        }

        update();
        viewport.addEventListener("resize", onResize);
        viewport.addEventListener("scroll", onResize);
        window.addEventListener("orientationchange", onResize);
        window.addEventListener("resize", onResize);

        return () => {
            viewport.removeEventListener("resize", onResize);
            viewport.removeEventListener("scroll", onResize);
            window.removeEventListener("orientationchange", onResize);
            window.removeEventListener("resize", onResize);
            const root = document.documentElement;
            root.style.removeProperty("--phone-screen-height");
            root.style.removeProperty("--vvh");
            root.style.removeProperty("--vkbd-height");
        };
    }, []);

    return null;
}
