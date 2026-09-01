"use client";

import { useMemo, type CSSProperties } from "react";

/**
 * The chat composer is already positioned by styles/chat.css:
 *
 *   .chat-input-bar {
 *       position: absolute;
 *       bottom: var(--vkbd-height, 0px);
 *   }
 *
 * Do not return position: fixed here.
 *
 * The mobile phone shell contains a transformed ancestor. On iOS/WebKit a
 * fixed descendant inside a transformed containing block can be anchored to
 * that block instead of the browser viewport. That is what makes the
 * composer jump to the top when the keyboard opens.
 *
 * KeyboardViewportHandler supplies --vkbd-height globally, so this hook is
 * intentionally a no-op. Keeping the hook preserves the existing component
 * API and leaves Android/desktop layout untouched.
 */
export function useChatKeyboardOffsetStyle(): CSSProperties {
    return useMemo(() => ({}), []);
}
