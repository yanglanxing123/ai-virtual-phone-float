// lib/xiashu-import.ts — 酒馆格式导入器
// 解析 SillyTavern V2/V3 PNG 角色卡，转换为仓库 Character 格式
import type { Character } from "./character-types";
import type { XiashuImportResult, TavernCardV2, TavernWorldBook } from "./xiashu-types";

// ── PNG tEXt chunk 读取 ──────────────────────────────
function readPngTextChunk(u8: Uint8Array, keywords: string[]): string | null {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < 8; i++) {
    if (u8[i] !== sig[i]) return null;
  }
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let offset = 8;
  while (offset + 12 <= u8.length) {
    const length = dv.getUint32(offset);
    const type = String.fromCharCode(
      u8[offset + 4],
      u8[offset + 5],
      u8[offset + 6],
      u8[offset + 7]
    );
    if (type === "tEXt") {
      const data = u8.subarray(offset + 8, offset + 8 + length);
      let sep = -1;
      for (let i = 0; i < data.length; i++) {
        if (data[i] === 0) { sep = i; break; }
      }
      if (sep >= 0) {
        const kw = new TextDecoder().decode(data.subarray(0, sep));
        if (keywords.includes(kw)) {
          return new TextDecoder("latin1").decode(data.subarray(sep + 1));
        }
      }
    } else if (type === "iTXt") {
      const data = u8.subarray(offset + 8, offset + 8 + length);
      let pos = 0;
      while (pos < data.length && data[pos] !== 0) pos++;
      const kw = new TextDecoder().decode(data.subarray(0, pos));
      if (keywords.includes(kw)) {
        pos++; // null sep
        const compressionFlag = data[pos++];
        pos++; // compression method
        while (pos < data.length && data[pos] !== 0) pos++; pos++; // lang tag
        while (pos < data.length && data[pos] !== 0) pos++; pos++; // translated kw
        if (compressionFlag === 0) {
          return new TextDecoder().decode(data.subarray(pos));
        }
      }
    } else if (type === "zTXt") {
      const data = u8.subarray(offset + 8, offset + 8 + length);
      let sep = -1;
      for (let i = 0; i < data.length; i++) {
        if (data[i] === 0) { sep = i; break; }
      }
      if (sep >= 0) {
        const kw = new TextDecoder().decode(data.subarray(0, sep));
        if (keywords.includes(kw)) {
          // zTXt 使用 zlib 压缩，需要 pako 或 DecompressionStream
          // 大多数酒馆卡使用 tEXt（未压缩），zTXt 较少见
          console.warn("[夏书] zTXt 压缩 chunk 需要额外解压支持");
        }
      }
    }
    offset += 12 + length;
    if (type === "IEND") break;
  }
  return null;
}

// ── base64 解码 ──────────────────────────────────────
function decodeBase64Json(b64: string): unknown {
  try {
    const jsonStr = decodeURIComponent(escape(atob(b64)));
    return JSON.parse(jsonStr);
  } catch {
    try {
      return JSON.parse(atob(b64));
    } catch {
      return null;
    }
  }
}

// ── 解析酒馆角色卡 ───────────────────────────────────
export function parseTavernCard(buffer: ArrayBuffer): XiashuImportResult | null {
  const u8 = new Uint8Array(buffer);

  // 尝试 V3 (ccv3) 和 V2 (chara) tEXt chunks
  const rawBase64 = readPngTextChunk(u8, ["ccv3", "chara"]);
  if (!rawBase64) return null;

  const cardData = decodeBase64Json(rawBase64) as TavernCardV2 | null;
  if (!cardData || !cardData.data || !cardData.data.name) return null;

  const data = cardData.data;

  // 提取 PNG 图像为 data URL（用于头像）
  const image = extractPngAsDataUrl(u8);

  return {
    character: {
      name: data.name,
      persona: data.description || "",
      personality: data.personality,
      avatar: image,
      tags: data.tags || [],
      firstMes: data.first_mes,
      scenario: data.scenario,
      mesExample: data.mes_example,
      systemPrompt: data.system_prompt,
      postHistoryInstructions: data.post_history_instructions,
      alternateGreetings: data.alternate_greetings,
      creator: data.creator,
    },
    worldBook: data.character_book || null,
    image,
  };
}

// ── 提取 PNG 为 data URL ─────────────────────────────
function extractPngAsDataUrl(u8: Uint8Array): string | null {
  try {
    let binary = "";
    for (let i = 0; i < u8.length; i++) {
      binary += String.fromCharCode(u8[i]);
    }
    return `data:image/png;base64,${btoa(binary)}`;
  } catch {
    return null;
  }
}

// ── 转换为仓库 Character 格式 ────────────────────────
export function convertToCharacter(
  result: XiashuImportResult,
  existingChars: Character[]
): Character {
  const now = new Date().toISOString();
  const id = `char_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  // 构建完整的 persona：将酒馆字段合并到仓库的 persona 中
  // 仓库的 Character.persona 对应酒馆的 description
  // 额外字段（scenario, mes_example 等）通过预设或额外存储处理
  let persona = result.character.persona || "";
  if (result.character.scenario) {
    persona += `\n\n【场景】\n${result.character.scenario}`;
  }
  if (result.character.mesExample) {
    persona += `\n\n【对话示例】\n${result.character.mesExample}`;
  }
  if (result.character.systemPrompt) {
    persona += `\n\n【系统提示】\n${result.character.systemPrompt}`;
  }
  if (result.character.postHistoryInstructions) {
    persona += `\n\n【后置指令】\n${result.character.postHistoryInstructions}`;
  }

  return {
    id,
    name: result.character.name,
    avatar: result.character.avatar || result.character.image || null,
    persona: persona.trim(),
    personality: result.character.personality,
    tags: ["xiashu", ...(result.character.tags || [])],
    wechatID: generateWechatID(),
    createdAt: now,
    updatedAt: now,
  };
}

function generateWechatID(): string {
  const prefixes = ["138", "139", "150", "151", "158", "159", "170", "176", "186", "188", "199"];
  const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
  const suffix = Math.floor(Math.random() * 100000000).toString().padStart(8, "0");
  return prefix + suffix;
}

// ── 获取角色卡摘要 ───────────────────────────────────
export function getCardSummary(result: XiashuImportResult): { name: string; desc: string } {
  return {
    name: result.character.name,
    desc: (result.character.persona || "").slice(0, 80),
  };
}

// ── 解析 JSON 格式的角色卡 ───────────────────────────
export function parseTavernCardFromJson(text: string): XiashuImportResult | null {
  try {
    const obj = JSON.parse(text);
    // 可能是 V2/V3 格式或简化格式
    const data = obj.data || obj;
    if (!data.name) return null;

    return {
      character: {
        name: data.name,
        persona: data.description || data.persona || "",
        personality: data.personality,
        avatar: null,
        tags: data.tags || [],
        firstMes: data.first_mes,
        scenario: data.scenario,
        mesExample: data.mes_example,
        systemPrompt: data.system_prompt,
        postHistoryInstructions: data.post_history_instructions,
        alternateGreetings: data.alternate_greetings,
        creator: data.creator,
      },
      worldBook: data.character_book || null,
      image: null,
    };
  } catch {
    return null;
  }
}
