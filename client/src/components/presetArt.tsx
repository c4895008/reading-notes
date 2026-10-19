import type { ReactNode } from 'react';

export const PRESET_NAMES = ['月下猫', '山月', '海浪', '孤灯', '纸窗', '夜航船', '竹影', '雪庐', '萤火', '书与茶'];

const MOON = '#e9e3cf';
const LAMP = '#f0c97a';

// 64 视窗、仅纯色填充（避免渐变 id 在同页多次渲染时冲突）；主体留在半径 29 的圆内
const ART: ReactNode[] = [
  <>
    <rect width="64" height="64" fill="#2f3a44" />
    <circle cx="14" cy="17" r="0.9" fill={MOON} opacity="0.7" />
    <circle cx="22" cy="11" r="0.9" fill={MOON} opacity="0.6" />
    <circle cx="40" cy="20" r="8" fill={MOON} />
    <rect y="50" width="64" height="14" fill="#27313a" />
    <path d="M18 52 C18 42 21 36 26 36 C31 36 34 42 34 52 Z" fill="#161d23" />
    <circle cx="26" cy="31" r="5.5" fill="#161d23" />
    <path d="M21 29.5 L21.6 22.6 L25.2 27 Z M31 29.5 L30.4 22.6 L26.8 27 Z" fill="#161d23" />
    <path d="M33 50.5 C40 50.5 41.5 44.5 37.5 42" stroke="#161d23" strokeWidth="2.6" strokeLinecap="round" fill="none" />
  </>,
  <>
    <rect width="64" height="64" fill="#3a3442" />
    <circle cx="32" cy="25" r="11" fill="#eadfc8" />
    <path d="M0 46 L14 32 L22 39 L32 29 L44 40 L52 34 L64 44 V64 H0 Z" fill="#544a5e" />
    <path d="M0 53 L12 44 L24 50 L38 40 L50 49 L64 45 V64 H0 Z" fill="#26212d" />
  </>,
  <>
    <rect width="64" height="64" fill="#2b3446" />
    <circle cx="22" cy="19" r="5.5" fill="#e3e4d6" />
    <path d="M0 35 Q8 30 16 35 T32 35 T48 35 T64 35 V64 H0 Z" fill="#4a5873" />
    <rect x="18" y="38" width="8" height="1.3" rx="0.6" fill="#e3e4d6" opacity="0.55" />
    <rect x="19.5" y="41" width="5" height="1.2" rx="0.6" fill="#e3e4d6" opacity="0.4" />
    <path d="M0 45 Q8 40 16 45 T32 45 T48 45 T64 45 V64 H0 Z" fill="#36435c" />
    <path d="M0 54 Q8 49 16 54 T32 54 T48 54 T64 54 V64 H0 Z" fill="#232c40" />
    <path d="M10 50.6 Q14 49.6 17 51.4 M38 41.6 Q42 40.6 45 42.4" stroke="#e3e4d6" strokeWidth="1.2" strokeLinecap="round" opacity="0.5" fill="none" />
  </>,
  <>
    <rect width="64" height="64" fill="#41382f" />
    <circle cx="32" cy="27" r="18" fill="#4d4236" />
    <circle cx="32" cy="27" r="11" fill="#5f513f" />
    <path d="M32 18 C35.5 22.5 36.6 26 34.8 29 C34 30.4 30 30.4 29.2 29 C27.4 26 28.5 22.5 32 18 Z" fill={LAMP} />
    <path d="M32 23 C33.6 25.2 34 27 33.2 28.4 C32.8 29 31.2 29 30.8 28.4 C30 27 30.4 25.2 32 23 Z" fill="#fff1cf" />
    <rect y="50" width="64" height="14" fill="#2c251f" />
    <path d="M23 31 H41 L37.5 35 H26.5 Z" fill="#1f1914" />
    <rect x="30.5" y="35" width="3" height="12" fill="#1f1914" />
    <rect x="24" y="46.5" width="16" height="3.5" rx="1.5" fill="#1f1914" />
  </>,
  <>
    <rect width="64" height="64" fill="#3d3a35" />
    <rect x="16" y="14" width="32" height="34" fill="#e6d9b8" />
    <path d="M48 21 C41 23 35 29 27 31.5" stroke="#9c8e70" strokeWidth="1.6" strokeLinecap="round" fill="none" />
    <circle cx="37" cy="26.5" r="1.8" fill="#9c8e70" />
    <circle cx="30.5" cy="30.2" r="1.6" fill="#9c8e70" />
    <circle cx="43" cy="22.6" r="1.7" fill="#9c8e70" />
    <path d="M24 14 V48 M32 14 V48 M40 14 V48 M16 25.3 H48 M16 36.7 H48" stroke="#2a2723" strokeWidth="1.2" />
    <rect x="16" y="14" width="32" height="34" fill="none" stroke="#2a2723" strokeWidth="2.4" />
    <rect x="13" y="48" width="38" height="3" fill="#2a2723" />
  </>,
  <>
    <rect width="64" height="64" fill="#2a3540" />
    <circle cx="20" cy="18" r="5" fill="#e6e2cc" />
    <circle cx="22.6" cy="16.4" r="4.4" fill="#2a3540" />
    <rect y="44" width="64" height="20" fill="#1e2730" />
    <circle cx="46.6" cy="33" r="5.5" fill={LAMP} opacity="0.18" />
    <rect x="46" y="30" width="1.2" height="13" fill="#141b21" />
    <path d="M22 42 C22 35 42 35 42 42 Z" fill="#141b21" />
    <path d="M13 42 H51 L45 48 H19 Z" fill="#141b21" />
    <circle cx="46.6" cy="33.5" r="2.2" fill={LAMP} />
    <rect x="44" y="51" width="5" height="1.1" rx="0.5" fill={LAMP} opacity="0.5" />
    <rect x="45" y="54" width="3" height="1.1" rx="0.5" fill={LAMP} opacity="0.35" />
  </>,
  <>
    <rect width="64" height="64" fill="#2d3d3a" />
    <circle cx="38" cy="22" r="10" fill="#e8e0c6" />
    <rect x="41" width="2.6" height="64" fill="#24322f" />
    <path d="M43.6 34 Q49 30 55 31 Q49 35 43.6 34 Z M43.6 34 Q48.5 38 50 44 Q45 40 43.6 34 Z" fill="#24322f" />
    <rect x="20" width="3.4" height="64" fill="#18221f" />
    <path d="M23.4 18 Q31 15.5 38 18.5 Q30 21 23.4 18 Z M23.4 18 Q30 21 33.5 27.5 Q27 23.5 23.4 18 Z M20 34 Q13 32.5 8 35.5 Q14 37 20 34 Z M23.4 44 Q29 42 34 45 Q28 46.5 23.4 44 Z" fill="#18221f" />
    <path d="M20 18 H23.4 M20 34 H23.4 M20 50 H23.4 M41 26 H43.6 M41 44 H43.6" stroke="#2d3d3a" strokeWidth="1" />
  </>,
  <>
    <rect width="64" height="64" fill="#3a3a44" />
    <rect x="37" y="25" width="3" height="7" fill="#22222a" />
    <rect x="36.4" y="24" width="4.2" height="1.8" rx="0.9" fill="#e8e9ee" />
    <rect x="22" y="36" width="20" height="12" fill="#22222a" />
    <path d="M16.5 37 L32 24.5 L47.5 37 Q46 39 44 37.5 L32 28.5 L20 37.5 Q18 39 16.5 37 Z" fill="#e8e9ee" />
    <path d="M20 37.5 L32 28.5 L44 37.5 Z" fill="#22222a" />
    <rect x="28.5" y="39.5" width="7" height="5" fill={LAMP} />
    <path d="M0 48 Q32 42 64 48 V64 H0 Z" fill="#d9dbe0" />
    <g fill="#e8e9ee">
      <circle cx="14" cy="20" r="1" />
      <circle cx="24" cy="13" r="0.9" />
      <circle cx="44" cy="14" r="1" />
      <circle cx="51" cy="23" r="0.9" />
      <circle cx="17" cy="30" r="0.8" />
      <circle cx="54" cy="32" r="0.9" />
      <circle cx="33" cy="16" r="0.8" />
    </g>
  </>,
  <>
    <rect width="64" height="64" fill="#2e3a33" />
    <g fill="#e6e8a0">
      <g opacity="0.2">
        <circle cx="22" cy="22" r="4.6" />
        <circle cx="39" cy="16" r="4.2" />
        <circle cx="45" cy="30" r="4.6" />
        <circle cx="29" cy="35" r="4" />
        <circle cx="15" cy="40" r="3.8" />
      </g>
      <circle cx="22" cy="22" r="1.9" />
      <circle cx="39" cy="16" r="1.6" />
      <circle cx="45" cy="30" r="1.9" />
      <circle cx="29" cy="35" r="1.5" />
      <circle cx="15" cy="40" r="1.4" />
    </g>
    <path d="M0 64 V56 H64 V64 Z M5 64 L10 44 L13 64 Z M14 64 L20 39 L23 64 Z M24 64 L27 47 L30 64 Z M31 64 L38 41 L39 64 Z M40 64 L44 49 L47 64 Z M46 64 L53 42 L53 64 Z M54 64 L58 49 L61 64 Z" fill="#19221d" />
  </>,
  <>
    <rect width="64" height="64" fill="#3b3039" />
    <path d="M41 32 Q39 29 41 26 Q43 23 41 20 M45.5 32 Q43.5 29 45.5 26 Q47.5 23 45.5 20" stroke="#eadfc8" strokeWidth="1.4" strokeLinecap="round" opacity="0.5" fill="none" />
    <rect y="46" width="64" height="18" fill="#2a2129" />
    <rect x="12" y="40" width="22" height="6" rx="1" fill="#7a4f52" />
    <rect x="14" y="41.4" width="20" height="3.2" fill="#eadfc8" />
    <rect x="14" y="35" width="18" height="5" rx="1" fill="#4f6a6a" />
    <rect x="16" y="36.2" width="16" height="2.6" fill="#eadfc8" />
    <path d="M37 35 H49 V39 Q49 46 43 46 Q37 46 37 39 Z" fill="#d9cbb1" />
    <path d="M49 37.5 Q53.5 37.5 53 40.5 Q52.5 43 48.5 42.5" stroke="#d9cbb1" strokeWidth="1.8" fill="none" />
  </>,
];

export default function PresetArt({ preset }: { preset: number }) {
  const art = ART[Math.max(1, Math.min(ART.length, preset)) - 1] ?? ART[0];
  return (
    <svg viewBox="0 0 64 64" width="100%" height="100%" aria-hidden="true">
      {art}
    </svg>
  );
}
