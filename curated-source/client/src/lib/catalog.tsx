import { createContext, useContext, type ReactNode } from 'react';
import { useApi } from './hooks';
import type { Category } from './types';

const Ctx = createContext<{ categories: Category[]; reload: () => void }>({ categories: [], reload: () => {} });

export function CatalogProvider({ children }: { children: ReactNode }) {
  const { data, reload } = useApi<{ categories: Category[] }>('/categories');
  return <Ctx.Provider value={{ categories: data?.categories ?? [], reload }}>{children}</Ctx.Provider>;
}

export const useCategories = () => useContext(Ctx);

export function findCategory(tree: Category[], slug: string | null): { node: Category; parent: Category | null } | null {
  if (!slug) return null;
  for (const root of tree) {
    if (root.slug === slug) return { node: root, parent: null };
    const child = root.children.find((c) => c.slug === slug);
    if (child) return { node: child, parent: root };
  }
  return null;
}
