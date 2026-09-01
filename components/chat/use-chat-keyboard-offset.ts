"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";

/**
 * Keeps the chat composer immediately above the on-screen keyboard on iOS
 * Safari without changing the normal Android/desktop layout.
 *
 * Safari may keep the layout viewport at the full screen height while the
 * visual viewport is shortened by the keyboard. A fixed composer therefore
 * needs to be lifted by exactly that difference.
 */
export function useChatKeyboardOffsetStyle(): CSSProperties {
    const [keyboardOffset, setKeyboardOffset] = useState(0);
    const [ios, setIos] = useState(false);

    useEffect(() => {
        if (typeof window === "undefined") return;

        const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
            (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
        setIos(isIOS);

        if (!isIOS) {
            setKeyboardOffset(0);
            return;
        }

        const viewport = window.visualViewport;

        const update = () => {
            if (!viewport) {
                setKeyboardOffset(0);
                return;
            }

            // On iOS Safari, the layout viewport can remain tall while the
            // visual viewport shrinks when the keyboard opens.
            const visibleBottom = viewport.height + viewport.offsetTop;
            const next = Math.max(0, Math.round(window.innerHeight - visibleBottom));

            // Ignore small changes caused by Safari's address/tab bar.
            setKeyboardOffset(next > 80 ? next : 0);
        };

        update();
        viewport?.addEventListener("resize", update);
        viewport?.addEventListener("scroll", update);
        window.addEventListener("resize", update);
        window.addEventListener("orientationchange", update);

        return () => {
            viewport?.removeEventListener("resize", update);
            viewport?.removeEventListener("scroll", update);
            window.removeEventListener("resize", update);
            window.removeEventListener("orientationchange", update);
        };
    }, []);

    return useMemo(() => {
        // Do not change Android/Chrome or desktop positioning at all.
        // Only override the composer while the iOS keyboard is actually open.
        if (!ios || keyboardOffset <= 0) return {};

        return {
            // Override the normal absolute/flow positioning only on mobile.
            // The composer is then anchored to the visible screen and lifted
            // by the keyboard height on iOS Safari.
            position: "fixed",
            left: 0,
            right: 0,
            bottom: `${keyboardOffset}px`,
            width: "100%",
            zIndex: 40,
        } as CSSProperties;
    }, [keyboardOffset, ios]);
}
