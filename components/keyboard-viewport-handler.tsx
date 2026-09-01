"use client";

import { useEffect } from "react";

/**
 * iOS Safari keyboard viewport bridge.
 *
 * The chat page is intentionally kept at the full layout viewport height.
 * styles/chat.css then uses:
 *
 *   bottom: var(--vkbd-height, 0px)
 *
 * for the composer and the corresponding bottom reserve for the message list.
 *
 * Do NOT move the whole phone or use position: fixed for the composer here.
 * The phone shell has a transformed ancestor on mobile, which makes a
 * position: fixed descendant behave like a fixed element inside that
 * transformed containing block on WebKit.
 */
export function KeyboardViewportHandler() {
    useEffect(() => {
        if (typeof window === "undefined") return;

        const vv = window.visualViewport;
        if (!vv) return;

        const root = document.documentElement;

        // Keep the layout viewport baseline separate from the visual viewport.
        // On iOS Safari the visual viewport can be both shorter AND offset
        // vertically while the keyboard is open.
        let layoutHeight = Math.max(
            document.documentElement.clientHeight,
            window.innerHeight,
            vv.height + vv.offsetTop,
        );

        let raf = 0;

        const measure = () => {
            raf = 0;

            const visibleBottom = vv.offsetTop + vv.height;

            // When the keyboard is closed, visual viewport reaches the layout
            // viewport. Refresh the baseline so rotation/address-bar changes
            // do not become keyboard height.
            if (visibleBottom >= layoutHeight - 16) {
                layoutHeight = Math.max(
                    document.documentElement.clientHeight,
                    window.innerHeight,
                    visibleBottom,
                );
            }

            // IMPORTANT: use visibleBottom, not vv.height alone.
            // Safari may pan the visual viewport when focusing the textarea.
            let keyboardHeight = layoutHeight - visibleBottom;

            // Ignore Safari toolbar/address-bar animation noise.
            if (keyboardHeight < 80) {
                keyboardHeight = 0;
            }

            root.style.setProperty(
                "--vkbd-height",
                `${Math.max(0, Math.round(keyboardHeight))}px`,
            );
        };

        const schedule = () => {
            if (raf) return;
            raf = window.requestAnimationFrame(measure);
        };

        const resetBaseline = () => {
            layoutHeight = Math.max(
                document.documentElement.clientHeight,
                window.innerHeight,
                vv.height + vv.offsetTop,
            );
            schedule();
            window.setTimeout(schedule, 120);
        };

        measure();

        vv.addEventListener("resize", schedule);
        vv.addEventListener("scroll", schedule);
        window.addEventListener("resize", schedule);
        window.addEventListener("orientationchange", resetBaseline);

        return () => {
            if (raf) window.cancelAnimationFrame(raf);

            vv.removeEventListener("resize", schedule);
            vv.removeEventListener("scroll", schedule);
            window.removeEventListener("resize", schedule);
            window.removeEventListener("orientationchange", resetBaseline);

            root.style.removeProperty("--vkbd-height");
        };
    }, []);

    return null;
}
