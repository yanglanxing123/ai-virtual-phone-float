import { NextRequest, NextResponse } from "next/server";
import { getMangaServerAdapter } from "@/lib/manga-source-server-adapters";

export const runtime = "nodejs";

/**
 * 统一漫画源服务端入口。
 * 这里不再写任何具体漫画站点逻辑；具体站点由 adapterId 对应的服务端适配器负责。
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const action = String(body?.action || "").trim();
    const adapterId = String(body?.adapterId || "").trim();

    if (!adapterId) {
      return NextResponse.json({ ok: false, error: "缺少漫画源适配器 adapterId" }, { status: 400 });
    }
    if (!action) {
      return NextResponse.json({ ok: false, error: "缺少 action" }, { status: 400 });
    }

    const adapter = getMangaServerAdapter(adapterId);
    if (!adapter) {
      return NextResponse.json({ ok: false, error: `暂未注册漫画源适配器：${adapterId}` }, { status: 400 });
    }

    const data = await adapter.handle(action as any, body);
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "漫画源请求失败" },
      { status: 502 },
    );
  }
}
