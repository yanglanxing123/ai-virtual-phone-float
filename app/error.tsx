"use client";

import { useEffect } from "react";

/**
 * 全局错误边界
 * 捕获任何未处理的客户端异常，防止白屏 "Application error"。
 * 用户可以点击重试按钮恢复应用。
 */
export default function Error({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    useEffect(() => {
        // 将错误记录到控制台，方便调试
        console.error("[App Error Boundary]", error);
    }, [error]);

    return (
        <div
            style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                minHeight: "100vh",
                padding: "20px",
                background: "#f5f5f5",
                fontFamily: "system-ui, -apple-system, sans-serif",
                color: "#333",
                textAlign: "center",
            }}
        >
            <div
                style={{
                    maxWidth: "400px",
                    padding: "32px 24px",
                    background: "#fff",
                    borderRadius: "16px",
                    boxShadow: "0 2px 12px rgba(0,0,0,0.08)",
                }}
            >
                <div style={{ fontSize: "40px", marginBottom: "12px" }}>😵</div>
                <h2 style={{ fontSize: "18px", fontWeight: 600, marginBottom: "8px" }}>
                    应用出了点小问题
                </h2>
                <p style={{ fontSize: "14px", color: "#888", marginBottom: "20px", lineHeight: 1.5 }}>
                    遇到了一个客户端异常，点击下方按钮重试即可恢复。
                </p>
                <button
                    onClick={reset}
                    style={{
                        padding: "10px 28px",
                        fontSize: "15px",
                        fontWeight: 500,
                        color: "#fff",
                        background: "#5B8DEF",
                        border: "none",
                        borderRadius: "20px",
                        cursor: "pointer",
                    }}
                >
                    重试
                </button>
            </div>
        </div>
    );
}
