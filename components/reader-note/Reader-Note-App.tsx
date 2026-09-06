"use client";

import { useCallback, useRef } from "react";

type ReaderNoteAppProps = {
  onClose: () => void;
};

export function ReaderNoteApp({ onClose }: ReaderNoteAppProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        width: "100%",
        background: "#f5f2ed",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          padding: "8px 12px",
          background: "rgba(245,242,237,.96)",
          borderBottom: "1px solid #e5dfd5",
          flexShrink: 0,
        }}
      >
        <button
          onClick={handleClose}
          aria-label="返回"
          style={{
            border: "1px solid #e5dfd5",
            background: "#fffdf9",
            borderRadius: "10px",
            padding: "4px 12px",
            fontSize: "16px",
            color: "#29251f",
            cursor: "pointer",
            lineHeight: 1,
          }}
        >
          ←
        </button>
        <span style={{ fontWeight: 800, fontSize: "16px", color: "#292722" }}>
          阅记
        </span>
      </div>
      <iframe
        ref={iframeRef}
        src="/reader-note/index.html"
        title="阅记"
        style={{
          flex: 1,
          width: "100%",
          border: "0",
          background: "#f5f2ed",
        }}
        sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-modals"
      />
    </div>
  );
}
