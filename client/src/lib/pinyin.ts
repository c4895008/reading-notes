import { useEffect, useState } from 'react';

export type Pinyin = typeof import('pinyin-pro').pinyin;

let loaded: Pinyin | null = null;

export const squash = (s: string) => s.toLowerCase().replace(/\s+/g, '');

// 原文 + 全拼 + 首字母，拼成一条供包含匹配
export function searchKey(text: string, pinyin: Pinyin | null) {
  if (!pinyin) return squash(text);
  const full = pinyin(text, { toneType: 'none', type: 'array', nonZh: 'consecutive' }).join('');
  const first = pinyin(text, { pattern: 'first', toneType: 'none', type: 'array', nonZh: 'consecutive' }).join('');
  return squash(`${text}|${full}|${first}`);
}

export function usePinyin(enabled: boolean) {
  const [pinyin, setPinyin] = useState<Pinyin | null>(loaded);

  useEffect(() => {
    if (!enabled || pinyin) return;
    let alive = true;
    import('pinyin-pro')
      .then((m) => {
        loaded = m.pinyin;
        if (alive) setPinyin(() => m.pinyin);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [enabled, pinyin]);

  return pinyin;
}
