type IconProps = { size?: number };

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
});

export const LogoIcon = ({ size = 24 }: IconProps) => (
  <svg {...base(size)} strokeWidth={1.7}>
    <path d="M12 6.2C10 4.7 7.4 4.2 4 4.2v13.6c3.4 0 6 .5 8 2 2-1.5 4.6-2 8-2V4.2c-3.4 0-6 .5-8 2Z" />
    <path d="M12 6.2v13.6" />
  </svg>
);

export const NoteIcon = ({ size = 22 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M6 3.5h9l3.5 3.5v13.5H6z" />
    <path d="M15 3.5V7h3.5" />
    <path d="M9 11.5h6M9 15h6" />
  </svg>
);

export const UserIcon = ({ size = 22 }: IconProps) => (
  <svg {...base(size)}>
    <circle cx="12" cy="8" r="3.5" />
    <path d="M5 19.5c.9-3.6 3.6-5.5 7-5.5s6.1 1.9 7 5.5" />
  </svg>
);

export const PanelLeftIcon = ({ size = 18 }: IconProps) => (
  <svg {...base(size)}>
    <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
    <path d="M9.5 4.5v15" />
    <path d="m14.5 9.5-2.5 2.5 2.5 2.5" />
  </svg>
);

export const TalkIcon = ({ size = 22 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M4.5 5.5h15v10h-8l-4.5 3.5v-3.5H4.5z" />
    <path d="M8.5 10.5h.01M12 10.5h.01M15.5 10.5h.01" />
  </svg>
);

export const FriendsIcon = ({ size = 22 }: IconProps) => (
  <svg {...base(size)}>
    <circle cx="9" cy="8.5" r="3" />
    <path d="M3.5 19c.6-3 2.8-4.8 5.5-4.8s4.9 1.8 5.5 4.8" />
    <path d="M15.5 6a3 3 0 0 1 0 5.6M17.5 14.6c1.6.6 2.7 2.1 3 4.4" />
  </svg>
);

export const GearIcon = ({ size = 22 }: IconProps) => (
  <svg {...base(size)}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 3.5v2.2M12 18.3v2.2M3.5 12h2.2M18.3 12h2.2M6 6l1.6 1.6M16.4 16.4 18 18M6 18l1.6-1.6M16.4 7.6 18 6" />
  </svg>
);

export const SearchIcon = ({ size = 18 }: IconProps) => (
  <svg {...base(size)}>
    <circle cx="10.5" cy="10.5" r="6" />
    <path d="m15 15 5 5" />
  </svg>
);

export const PlusIcon = ({ size = 18 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const BackIcon = ({ size = 18 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M14.5 5.5 8 12l6.5 6.5" />
  </svg>
);

export const ChevronIcon = ({ size = 16 }: IconProps) => (
  <svg {...base(size)}>
    <path d="m9 6 6 6-6 6" />
  </svg>
);

export const RefineIcon = ({ size = 22 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M5 4.5h14M12 20V9M7.5 13.5 12 9l4.5 4.5" />
  </svg>
);

export const SupplementIcon = ({ size = 22 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14" />
  </svg>
);

export const MountIcon = ({ size = 16 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
    <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
  </svg>
);

export const UnmountIcon = ({ size = 16 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M8.5 12.5 6 15a3 3 0 0 0 4.2 4.2l2.3-2.5M15.5 11.5 18 9a3 3 0 0 0-4.2-4.2l-2.3 2.5" />
    <path d="M4.5 4.5 7 7M19.5 19.5 17 17" />
  </svg>
);

export const TrashIcon = ({ size = 16 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 12.5h9l1-12.5" />
    <path d="M10 11v5M14 11v5" />
  </svg>
);

export const PenIcon = ({ size = 16 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M4.5 19.5 5.5 15 15.5 5a2.1 2.1 0 0 1 3 3l-10 10z" />
    <path d="m13.5 7 3 3" />
  </svg>
);

export const MoreIcon = ({ size = 16 }: IconProps) => (
  <svg {...base(size)}>
    <circle cx="12" cy="5.5" r="0.9" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="0.9" fill="currentColor" stroke="none" />
    <circle cx="12" cy="18.5" r="0.9" fill="currentColor" stroke="none" />
  </svg>
);

export const XIcon = ({ size = 14 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
);

