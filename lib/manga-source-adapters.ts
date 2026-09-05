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
 * 漫画源统一适配层。
 *
 * 新增漫画源时，优先在这里增加一个 adapter：
 * 1. match：判断这个书源是否属于该适配器；
 * 2. endpoint：对应的服务端漫画接口；
 * 3. 如果服务端返回结构不同，再在对应 route 做解析。
 *
 * 阅读器本身不再直接判断“是不是读漫屋”。
 */
const MANGA_SOURCE_ADAPTERS: MangaSourceAdapterDefinition[] = [
  {
    id: "dumanwu",
    label: "读漫屋",
    match: (source) => /读漫屋|dumanwu/i.test(`${source.name} ${source.url}`),
    endpoint: "/api/reading/manga",
  },
];

/**
 * 根据书源返回一个绑定了 sourceUrl 的漫画适配器。
 * 这样业务层只关心 search/detail/catalog/content/module，不关心具体站点。
 */
export function getMangaSourceAdapter(source: ReadingBookSource): MangaSourceAdapter | null {
  const definition = MANGA_SOURCE_ADAPTERS.find((item) => item.match(source));
  if (!definition) return null;

  return {
    ...definition,
    request: async (action, payload = {}) => {
      const response = await fetch(definition.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          adapterId: definition.id,
          sourceUrl: source.url,
          ...payload,
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.ok) {
        throw new Error(data?.error || `${definition.label}接口请求失败（HTTP ${response.status}）`);
      }
      return data.data;
    },
  };
}

/**
 * 给调试/设置页面使用：列出当前已经注册的漫画适配器。
 */
export function listMangaSourceAdapters() {
  return MANGA_SOURCE_ADAPTERS.map(({ id, label, endpoint }) => ({ id, label, endpoint }));
}
