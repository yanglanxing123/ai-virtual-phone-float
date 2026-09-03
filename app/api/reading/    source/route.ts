import { NextRequest, NextResponse } from "next/server";
import dns from "node:dns/promises";
import net from "node:net";

export const runtime = "nodejs";

function cleanHeaders(value: unknown) {
  if (!value || typeof value !== "object") return {};
  const output: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (raw == null) continue;
    output[key] = String(raw);
  }
  return output;
}

function makeBody(body: unknown, headers: Record<string, string>) {
  if (body == null) return undefined;
  const contentType = Object.entries(headers).find(([key]) => key.toLowerCase() === "content-type")?.[1] || "";
  if (/application\/json/i.test(contentType)) return typeof body === "string" ? body : JSON.stringify(body);
  if (typeof body === "string") return body;
  if (/application\/x-www-form-urlencoded/i.test(contentType)) {
    return new URLSearchParams(Object.entries(body as Record<string, unknown>).map(([k, v]) => [k, String(v ?? "")]));
  }
  return JSON.stringify(body);
}

function isPrivateIPv4(ip: string) {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a,b] = parts;
  return a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

function isPrivateIPv6(ip: string) {
  const value = ip.toLowerCase();
  return value === "::1" || value.startsWith("fc") || value.startsWith("fd") || value.startsWith("fe80:") || value.startsWith("::ffff:127.");
}

async function assertSafeTarget(url: URL) {
  if (url.username || url.password) throw new Error("URL 不允许携带认证信息");
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) throw new Error("禁止访问本机或本地域名");
  if (net.isIP(host) === 4 && isPrivateIPv4(host)) throw new Error("禁止访问内网地址");
  if (net.isIP(host) === 6 && isPrivateIPv6(host)) throw new Error("禁止访问内网地址");
  if (!net.isIP(host)) {
    const records = await dns.lookup(host, { all: true });
    if (!records.length || records.some((record) => record.family === 4 ? isPrivateIPv4(record.address) : isPrivateIPv6(record.address))) {
      throw new Error("目标域名解析到内网或保留地址，已阻止请求");
    }
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const url = String(body?.url || "").trim();
    if (!url) return NextResponse.json({ ok: false, error: "缺少 URL" }, { status: 400 });

    let target: URL;
    try { target = new URL(url); } catch { return NextResponse.json({ ok: false, error: "URL 无效" }, { status: 400 }); }
    if (!["http:", "https:"].includes(target.protocol)) {
      return NextResponse.json({ ok: false, error: "仅支持 HTTP/HTTPS" }, { status: 400 });
    }

    // 书源封面等二进制资源也统一走服务端代理，避免 iOS Safari/CORS 导致
    // IndexedDB 无法保存跨域图片。只允许图片/字体等小型静态资源。
    if (body?.asset === true) {
      await assertSafeTarget(target);
      const controller = new AbortController();
      const timeoutMs = Math.max(3000, Math.min(20000, Number(body?.timeoutMs) || 12000));
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(target.toString(), {
          method: "GET",
          headers: {
            "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
            "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Safari/605.1.15",
          },
          redirect: "follow",
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) {
          return NextResponse.json({ ok: false, error: `资源返回 HTTP ${response.status}` }, { status: 502 });
        }
        const contentType = response.headers.get("content-type") || "application/octet-stream";
        if (!/^(image\/|font\/|application\/octet-stream)/i.test(contentType)) {
          return NextResponse.json({ ok: false, error: "目标不是可保存的静态资源" }, { status: 415 });
        }
        const buffer = await response.arrayBuffer();
        if (buffer.byteLength > 8 * 1024 * 1024) {
          return NextResponse.json({ ok: false, error: "资源过大，未保存" }, { status: 413 });
        }
        return new NextResponse(buffer, {
          status: 200,
          headers: {
            "Content-Type": contentType,
            "Cache-Control": "public, max-age=3600",
          },
        });
      } finally {
        clearTimeout(timer);
      }
    }

    const method = String(body?.method || "GET").toUpperCase();
    const headers = cleanHeaders(body?.headers);
    if (!headers.Accept) headers.Accept = "text/html,application/json;q=0.9,*/*;q=0.8";
    if (!headers["User-Agent"] && !headers["user-agent"]) {
      headers["User-Agent"] = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Safari/605.1.15";
    }

    const controller = new AbortController();
    const timeoutMs = Math.max(3000, Math.min(30000, Number(body?.timeoutMs) || 15000));
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      let current = target;
      let response: Response | null = null;
      for (let hop = 0; hop < 6; hop++) {
        await assertSafeTarget(current);
        response = await fetch(current.toString(), {
          method,
          headers,
          body: ["GET", "HEAD"].includes(method) ? undefined : makeBody(body?.body, headers),
          redirect: "manual",
          cache: "no-store",
          signal: controller.signal,
        });
        if (![301,302,303,307,308].includes(response.status)) break;
        const location = response.headers.get("location");
        if (!location) break;
        current = new URL(location, current);
      }
      if (!response) throw new Error("请求没有返回响应");
      const text = await response.text();
      if (!response.ok) return NextResponse.json({ ok: false, error: `源站返回 HTTP ${response.status}` }, { status: 502 });
      const getSetCookie = (response.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
      const setCookieValues = typeof getSetCookie === "function" ? getSetCookie.call(response.headers) : [];
      const fallbackCookie = response.headers.get("set-cookie");
      const setCookie = setCookieValues.length ? setCookieValues.join(",") : (fallbackCookie || "");
      return NextResponse.json({ ok: true, url: current.toString(), contentType: response.headers.get("content-type") || "", text, setCookie });
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "请求源站失败";
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
