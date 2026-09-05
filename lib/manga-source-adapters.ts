import type { ReadingBookSource } from "./reading-source";

export type MangaAction = "search" | "detail" | "catalog" | "content" | "module";

export type MangaSourceAdapterDefinition = {
  id: string;
  label: string;
  match: (source: ReadingBookSource) => boolean;
  endpoint: string;
};

export type MangaSourceAdapter = MangaSourceAdapterDefinition & {
  request: (action: MangaAction, payload?: Record<string, unknown>) => Promise<unknown>;
};

/**
 * 通用漫画源：bookSourceType === 2 即进入漫画适配器。
 * 具体规则全部从 source.raw.mangaAdapter 读取，不再绑定任何站点名称。
 */
const MANGA_SOURCE_ADAPTERS: MangaSourceAdapterDefinition[] = [
  {
    id: "generic-manga",
    label: "通用漫画源",
    match: (source) => Number((source.raw as any)?.bookSourceType) === 2,
    endpoint: "/api/reading/manga",
  },
];

export function getMangaSourceAdapter(source: ReadingBookSource): MangaSourceAdapter | null {
  const definition = MANGA_SOURCE_ADAPTERS.find((item) => item.match(source));
  if (!definition) return null;

  return {
    ...definition,
    request: async (action, payload = {}) => {
      const response = await fetch(definition.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, adapterId: definition.id, sourceUrl: source.url, sourceRaw: source.raw, ...payload }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.ok) {
        throw new Error(data?.error || `${definition.label}请求失败（HTTP ${response.status}）`);
      }
      return data.data;
    },
  };
}

export function listMangaSourceAdapters() {
  return MANGA_SOURCE_ADAPTERS.map(({ id, label, endpoint }) => ({ id, label, endpoint }));
}
