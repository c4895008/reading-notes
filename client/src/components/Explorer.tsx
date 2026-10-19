import { createContext, useContext, useEffect, type ReactNode } from 'react';

type ExplorerSetter = (key: string, node: ReactNode | null) => void;

const ExplorerContext = createContext<ExplorerSetter>(() => {});

export function ExplorerProvider({ setter, children }: { setter: ExplorerSetter; children: ReactNode }) {
  return <ExplorerContext.Provider value={setter}>{children}</ExplorerContext.Provider>;
}

/**
 * 页面用它把自己的浏览面板内容注册到外壳的 Explorer 面板。
 * 同一时刻只保留最后一个注册的 key；页面卸载时自动清空。
 * 面板组件应自行管理数据，node 只需在 key 变化时提供一次。
 */
export function useExplorerContent(key: string, node: ReactNode) {
  const set = useContext(ExplorerContext);
  useEffect(() => {
    set(key, node);
    return () => set(key, null);
  }, [set, key]);
}
