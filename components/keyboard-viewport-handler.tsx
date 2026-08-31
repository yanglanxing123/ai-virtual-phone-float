"use client";

import { useEffect } from "react";

/**
 * 全局键盘视口处理器
 *
 * 使用 Visual Viewport API 检测键盘高度，同时兼容 iOS Safari 和 Android Chrome。
 * 键盘弹出时动态缩小 phone-shell 高度，所有 app 作为 phone-shell 子元素自动跟随。
 *
 * 设置的 CSS 变量：
 * --phone-screen-height: phone-shell 高度（无键盘=全屏高度，有键盘=可视区域高度）
 * --vkbd-height: 键盘高度（px，无键盘时为 0）→ 供弹窗/浮层等非 phone-shell 子元素使用
 * --vvh: 与 --phone-screen-height 同步
 *
 * 平台差异：
 * - iOS Safari: window.innerHeight 不随键盘变化，始终 = 全屏高度（含 Safari 工具栏后方区域）
 * - Android Chrome: window.innerHeight 可能也随键盘减小（取决于版本/浏览器）
 * - 两种平台 visualViewport.height 始终 = 键盘上方的可视区域高度
 *
 * 适配策略：
 * - 无键盘时：--phone-screen-height = window.innerHeight（含 Safari 工具栏后方区域），消除底部空白
 * - 有键盘时：--phone-screen-height = visualViewport.height（键盘上方区域），输入栏贴键盘
 * - 用阈值 100px 区分 Safari 工具栏（~49px）和真实键盘（~250px+）
 * - 键盘出现时重置 visualViewport 滚动偏移，防止 iOS Safari 自动滚动导致布局偏移
 */
export function KeyboardViewportHandler() {
    useEffect(() => {
        if (typeof window === "undefined") return;

        const vv = window.visualViewport;
        if (!vv) return;
        const viewport = vv;

        let ticking = false;
        // 防止 scrollTo 触发 scroll 事件后递归调用
        let resettingScroll = false;
        // 记录无键盘时的全屏高度（用于计算键盘高度）
        // iOS: window.innerHeight 始终 = 全屏高度，可直接作为参考
        // Android: 需要记录历史最大值
        let maxVh = Math.max(viewport.height, window.innerHeight);

        // 区分 Safari 工具栏（~49px）和真实键盘（~250px+）的阈值
        const KEYBOARD_THRESHOLD = 100;

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

            if (kw >= KEYBOARD_THRESHOLD) {
                // 键盘出现：用 visualViewport.height（键盘上方区域）
                // phone-shell 高度缩小到键盘上方，输入栏 bottom:0 自动贴键盘
                root.style.setProperty("--phone-screen-height", `${vh}px`);
                root.style.setProperty("--vvh", `${vh}px`);
                root.style.setProperty("--vkbd-height", `${kw}px`);

                // 重置 iOS Safari 自动滚动偏移
                // iOS 在输入框聚焦时会自动滚动页面，导致整个布局上移
                // 通过 scrollTo(0,0) 将视口重置到顶部，配合 app-root 的 position:fixed 防止偏移
                if ((viewport.offsetTop > 0 || viewport.pageTop > 0) && !resettingScroll) {
                    resettingScroll = true;
                    try { viewport.scrollTo({ left: 0, top: 0 }); } catch { /* 部分浏览器不支持 */ }
                    requestAnimationFrame(() => { resettingScroll = false; });
                }
            } else {
                // 无键盘（或仅有 Safari 工具栏）：
                // 用 window.innerHeight（含 Safari 工具栏后方区域），phone-shell 铺满整屏
                // Safari 工具栏半透明覆盖在 phone-shell 底部，消除底部空白
                const fullHeight = Math.max(window.innerHeight, maxVh);
                root.style.setProperty("--phone-screen-height", `${fullHeight}px`);
                root.style.setProperty("--vvh", `${fullHeight}px`);
                root.style.setProperty("--vkbd-height", `0px`);
            }
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
