import { NextRequest, NextResponse } from "next/server";
import { fetchMangaImage, getMangaServerAdapter } from "@/lib/manga-source-server-adapters";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const image = request.nextUrl.searchParams.get("image");
    if (!image) return NextResponse.json({ ok: false, error: "缺少 image" }, { status: 400 });
    const referer = request.nextUrl.searchParams.get("referer") || undefined;
    const result = await fetchMangaImage(image, referer);
    return new NextResponse(result.response.body, {
      status: 200,
      headers: {
        "Content-Type": result.response.headers.get("content-type") || "image/jpeg",
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "图片请求失败" }, { status: 502 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const action = String(body?.action || "").trim();
    const adapterId = String(body?.adapterId || "").trim();
    if (!adapterId) return NextResponse.json({ ok: false, error: "缺少漫画源适配器 adapterId" }, { status: 400 });
    if (!action) return NextResponse.json({ ok: false, error: "缺少 action" }, { status: 400 });
    const adapter = getMangaServerAdapter(adapterId);
    if (!adapter) return NextResponse.json({ ok: false, error: `暂未注册漫画源适配器：${adapterId}` }, { status: 400 });
    const data = await adapter.handle(action as any, body);
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "漫画源请求失败" }, { status: 502 });
  }
}
