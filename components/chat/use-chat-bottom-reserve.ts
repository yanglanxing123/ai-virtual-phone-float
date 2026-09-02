"use client";

import { useLayoutEffect, type RefObject } from "react";

const CHAT_BOTTOM_RESERVE_CSS_VAR = "--chat-bottom-reserve";
const STICK_TO_BOTTOM_THRESHOLD = 120;
const KEYBOARD_OPEN_THRESHOLD = 40;

function findBottomOverlay(wrapper: HTMLElement): HTMLElement | null {
    for (const child of Array.from(wrapper.children)) {
        if (!(child instanceof HTMLElement)) continue;
        const ui = child.dataset.ui;
        if (ui === "input" || ui === "multi-select") return child;
    }
    return null;
}

function isEditableElement(value: Element | null): value is HTMLInputElement | HTMLTextAreaElement {
    return value instanceof HTMLInputElement || value instanceof HTMLTextAreaElement;
}

export function useChatBottomReserve<TWrapper extends HTMLElement, TScroll extends HTMLElement>(
    wrapperRef: RefObject<TWrapper | null>,
    scrollRef: RefObject<TScroll | null>,
    refreshKey: string,
) {
    useLayoutEffect(() => {
        if (typeof window === "undefined" || typeof document === "undefined") return;
        const wrapper = wrapperRef.current;
        if (!wrapper) return;

        let frame = 0;
        let bottomScrollFrame = 0;
        let delayedBottomTimer = 0;
        let observer: ResizeObserver | null = null;

        const isKeyboardOpen = () => {
            const viewport = window.visualViewport;
            if (!viewport) return false;
            // Safari keeps the layout viewport large while the visual viewport
            // shrinks when the software keyboard is shown.
            return viewport.height < window.innerHeight - KEYBOARD_OPEN_THRESHOLD;
        };

        const inputFocused = () => {
            const active = document.activeElement;
            return isEditableElement(active) && wrapper.contains(active);
        };

        const stickToBottom = (extraDelay = false) => {
            if (bottomScrollFrame) window.cancelAnimationFrame(bottomScrollFrame);
            if (delayedBottomTimer) window.clearTimeout(delayedBottomTimer);

            const run = () => {
                bottomScrollFrame = window.requestAnimationFrame(() => {
                    bottomScrollFrame = 0;
                    const el = scrollRef.current;
                    if (!el) return;
                    // Use the explicit maximum rather than scrollIntoView():
                    // scrollIntoView() can make Safari scroll the outer phone
                    // document instead of this message container.
                    el.scrollTop = Math.max(0, el.scrollHeight - el.clientHeight);
                });
            };

            // iOS can dispatch visualViewport.resize before its final geometry
            // and before --vkbd-height has been applied. A second/third paint
            // puts the message pane at the final keyboard-adjusted height.
            run();
            window.requestAnimationFrame(run);
            if (extraDelay) {
                delayedBottomTimer = window.setTimeout(run, 80);
            }
        };

        const scheduleStickToBottom = () => stickToBottom(false);

        const measure = () => {
            frame = 0;
            const overlay = findBottomOverlay(wrapper);
            if (!overlay) {
                wrapper.style.removeProperty(CHAT_BOTTOM_RESERVE_CSS_VAR);
                return;
            }

            const el = scrollRef.current;
            const wasNearBottom = el
                ? el.scrollHeight - el.scrollTop - el.clientHeight < STICK_TO_BOTTOM_THRESHOLD
                : false;
            const height = Math.ceil(overlay.getBoundingClientRect().height);

            if (height > 0) {
                // The composer itself is moved upward by --vkbd-height on iOS.
                // The message viewport must end at the composer's TOP, not at
                // the composer's bottom. Therefore reserve BOTH the composer
                // height and the keyboard height.
                wrapper.style.setProperty(
                    CHAT_BOTTOM_RESERVE_CSS_VAR,
                    `calc(${height}px + var(--vkbd-height, 0px))`,
                );
            } else {
                wrapper.style.removeProperty(CHAT_BOTTOM_RESERVE_CSS_VAR);
            }

            // Normal behavior: preserve the user's bottom anchor only when
            // they were already near it. Keyboard behavior is different: the
            // viewport itself just changed, so force the latest-message anchor
            // while this Chat input owns focus.
            if (wasNearBottom || (inputFocused() && isKeyboardOpen())) {
                stickToBottom(inputFocused() && isKeyboardOpen());
            }
        };

        const requestMeasure = () => {
            if (frame) window.cancelAnimationFrame(frame);
            frame = window.requestAnimationFrame(measure);
        };

        const handleFocusIn = (event: FocusEvent) => {
            if (!isEditableElement(event.target as Element | null)) return;
            if (!wrapper.contains(event.target as Node)) return;
            // Let Safari finish opening the keyboard first, then anchor the
            // message list to its latest message.
            stickToBottom(true);
        };

        const handleViewportResize = () => {
            requestMeasure();
            if (inputFocused() && isKeyboardOpen()) {
                // Run after the keyboard CSS variable/layout has settled.
                stickToBottom(true);
            }
        };

        const overlay = findBottomOverlay(wrapper);
        if (overlay && typeof ResizeObserver !== "undefined") {
            observer = new ResizeObserver(requestMeasure);
            observer.observe(overlay);
        }

        measure();
        document.addEventListener("focusin", handleFocusIn, true);
        window.addEventListener("resize", requestMeasure);
        window.visualViewport?.addEventListener("resize", handleViewportResize);

        return () => {
            if (frame) window.cancelAnimationFrame(frame);
            if (bottomScrollFrame) window.cancelAnimationFrame(bottomScrollFrame);
            if (delayedBottomTimer) window.clearTimeout(delayedBottomTimer);
            observer?.disconnect();
            document.removeEventListener("focusin", handleFocusIn, true);
            window.removeEventListener("resize", requestMeasure);
            window.visualViewport?.removeEventListener("resize", handleViewportResize);
        };
    }, [wrapperRef, scrollRef, refreshKey]);
}
