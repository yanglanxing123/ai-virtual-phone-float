"use client";

import { useEffect } from "react";

/**
 * 全局键盘视口处理器
 *
 * 使用 Visual Viewport API 检测键盘高度，同时兼容 iOS Safari 和 Android Chrome。
 * 键盘弹出时动态缩小 phone-shell 高度，所有 app 作为 phone-shell 子元素自动跟随。
 *
 * 设置的 CSS 变量：
 * --phone-screen-height: 可视视口高度（键盘弹出时自动缩小）→ phone-shell 用此值作为 height
 * --vkbd-height: 键盘高度（px，无键盘时为 0）→ 供弹窗/浮层等非 phone-shell 子元素使用
 * --vvh: 可视视口高度（与 --phone-screen-height 同步）
 *
 * 平台差异：
 * - iOS Safari: window.innerHeight 不随键盘变化，始终 = 全屏高度
 * - Android Chrome: window.innerHeight 可能也随键盘减小（取决于版本/浏览器）
 * - 两种平台 visualViewport.height 始终 = 键盘上方的可视区域高度
 *
 * 适配策略：
 * - --phone-screen-height 直接用 viewport.height（两平台都正确）
 * - --vkbd-height 用"参考全屏高度 - viewport.height"计算
 *   参考全屏高度 = max(window.innerHeight, maxVh) 兼容两平台
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
            // iOS: window.innerHeight 始终 = 全屏高度，始终是正确参考
            // Android: window.innerHeight 可能随键盘减小，但 maxVh 保留了无键盘时的最大值
            const refHeight = Math.max(window.innerHeight, maxVh);

            // 如果当前可视高度接近参考高度（差值 <= 10px），说明无键盘，更新 maxVh
            if (vh >= refHeight - 10) {
                maxVh = Math.max(maxVh, vh);
            }

            // 键盘高度 = 参考全屏高度 - 当前可视高度
            const kw = Math.max(0, refHeight - vh);

            const root = document.documentElement;
            root.style.setProperty("--phone-screen-height", `${vh}px`);
            root.style.setProperty("--vvh", `${vh}px`);
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
        viewport.addEventListener("scroll", onResize);
        window.addEventListener("orientationchange", onOrientationChange);
        window.addEventListener("resize", onResize);

        return () => {
            viewport.removeEventListener("resize", onResize);
            viewport.removeEventListener("scroll", onResize);
            window.removeEventListener("orientationchange", onOrientationChange);
            window.removeEventListener("resize", onResize);
            const root = document.documentElement;
            root.style.removeProperty("--phone-screen-height");
            root.style.removeProperty("--vvh");
            root.style.removeProperty("--vkbd-height");
        };
    }, []);

    return null;
}
