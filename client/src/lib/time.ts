const pad = (n: number) => String(n).padStart(2, '0');

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

// 今天 HH:mm、昨天「昨天」、今年「M 月 D 日」、跨年「YYYY 年 M 月 D 日」
export function formatTime(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  if (sameDay(d, now)) return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (sameDay(d, yesterday)) return '昨天';
  return formatDate(iso, now);
}

export function formatDate(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const md = `${d.getMonth() + 1} 月 ${d.getDate()} 日`;
  return d.getFullYear() === now.getFullYear() ? md : `${d.getFullYear()} 年 ${md}`;
}

export function isoDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function fullTime(iso: string): string {
  const d = new Date(iso);
  return `${isoDate(iso)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function clock(iso: string): string {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

// 消息区跨天分隔线：今天 / 昨天 / M 月 D 日 · 周几
export function dayLabel(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (sameDay(d, now)) return '今天';
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (sameDay(d, yesterday)) return '昨天';
  return `${formatDate(iso, now)} · ${WEEKDAYS[d.getDay()]}`;
}
