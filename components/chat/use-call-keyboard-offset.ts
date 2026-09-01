"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";

export function useCallKeyboardOffsetStyle(): CSSProperties {
    const [offset, setOffset] = useState(0);

    useEffect(() => {
        if (typeof window === "undefined") return;

        const viewport = window.visualViewport;
        const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
            (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
        const isMobile = window.matchMedia(
            "(max-width: 900px) and (hover: none) and (pointer: coarse)"
        ).matches;

        // Android browsers generally resize the layout viewport when the
        // keyboard opens. Safari/iOS uses visualViewport instead, so only
        // calculate the extra offset where it is actually needed.
        if (!isIOS && !isMobile) {
            setOffset(0);
            return;
        }

        const update = () => {
            if (!viewport) {
                setOffset(0);
                return;
            }

            // The difference between the layout viewport and visual viewport
            // includes the iOS keyboard. Clamp small browser-bar changes so
            // the call screen does not visibly jump while scrolling.
            const keyboardHeight = Math.max(
                0,
                Math.round(window.innerHeight - viewport.height - viewport.offsetTop)
            );
            setOffset(keyboardHeight > 80 ? keyboardHeight : 0);
        };

        update();
        viewport?.addEventListener("resize", update);
        viewport?.addEventListener("scroll", update);
        window.addEventListener("resize", update);

        return () => {
            viewport?.removeEventListener("resize", update);
            viewport?.removeEventListener("scroll", update);
            window.removeEventListener("resize", update);
        };
    }, []);

    return useMemo(() => ({ "--call-keyboard-offset": `${offset}px` } as CSSProperties), [offset]);
}
