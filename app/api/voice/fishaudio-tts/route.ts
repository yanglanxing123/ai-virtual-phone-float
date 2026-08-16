import { NextResponse } from "next/server";
import { proxyFetch } from "@/lib/proxy-fetch";

export const runtime = "nodejs";
export const maxDuration = 25;

const FISH_UPSTREAM = "https://api.fish.audio/v1/tts";
const DEFAULT_FISH_MODEL = "s2.1-pro";

/**
 * 鱼声 Fish Audio TTS 服务端代理。
 *
 * 鱼声 (api.fish.audio) 不发 ACAO 头，浏览器直连会被 CORS 挡。
 * 这个路由做纯透传：接收前端 POST → 转发到上游 → 原样回传二进制音频。
 *
 * 不读不存 API Key 的持久态，Key 每次请求由前端 Authorization 头传入。
 * model 通过自定义头 x-fish-model 传入（避免在 CORS 预检里暴露自定义 model 头）。
 */
export async function POST(request: Request) {
    try {
        const authHeader = request.headers.get("authorization");
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return NextResponse.json(
                { error: "missing_api_key", message: "缺少 Fish Audio API Key" },
                { status: 400 },
            );
        }

        const model = request.headers.get("x-fish-model") || DEFAULT_FISH_MODEL;
        const body = await request.text();

        const upstream = await proxyFetch(FISH_UPSTREAM, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: authHeader,
                model,
            },
            body,
        });

        const contentType = upstream.headers.get("content-type") || "audio/mpeg";

        if (!upstream.ok) {
            const errText = await upstream.text().catch(() => "");
            return NextResponse.json(
                { error: "fish_tts_failed", message: errText.slice(0, 500) || `HTTP ${upstream.status}` },
                { status: upstream.status },
            );
        }

        // 原样回传二进制音频
        const arrayBuffer = await upstream.arrayBuffer();
        return new Response(arrayBuffer, {
            status: 200,
            headers: {
                "Content-Type": contentType,
                "Cache-Control": "no-store",
            },
        });
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return NextResponse.json(
            { error: "fish_tts_proxy_failed", message: message.slice(0, 500) },
            { status: 502 },
        );
    }
}

export async function OPTIONS() {
    return new Response(null, {
        status: 204,
        headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST,OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type,Authorization,x-fish-model",
        },
    });
}
