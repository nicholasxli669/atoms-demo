/** 内联 SVG 图标集（无外部依赖，随主题变色） */
import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 16, children, ...rest }: P) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const Icon = {
  spark: (p: P) => (
    <Svg {...p}>
      <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z" />
      <path d="M18.5 16.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8.8-2z" />
    </Svg>
  ),
  plus: (p: P) => (
    <Svg {...p}>
      <path d="M12 5v14M5 12h14" />
    </Svg>
  ),
  check: (p: P) => (
    <Svg {...p}>
      <path d="M20 6L9 17l-5-5" />
    </Svg>
  ),
  shield: (p: P) => (
    <Svg {...p}>
      <path d="M12 3l7 3v5c0 4.4-2.9 8.1-7 9.4C7.9 19.1 5 15.4 5 11V6l7-3z" />
      <path d="M9 12l2 2 4-4" />
    </Svg>
  ),
  x: (p: P) => (
    <Svg {...p}>
      <path d="M18 6L6 18M6 6l12 12" />
    </Svg>
  ),
  loader: (p: P) => (
    <Svg {...p}>
      <path d="M12 3a9 9 0 1 0 9 9" />
    </Svg>
  ),
  eye: (p: P) => (
    <Svg {...p}>
      <path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12z" />
      <circle cx="12" cy="12" r="2.6" />
    </Svg>
  ),
  code: (p: P) => (
    <Svg {...p}>
      <path d="M9 18l-6-6 6-6M15 6l6 6-6 6" />
    </Svg>
  ),
  terminal: (p: P) => (
    <Svg {...p}>
      <rect x="2.5" y="4" width="19" height="16" rx="2.5" />
      <path d="M6.5 9.5L9.5 12l-3 2.5M12.5 15h5" />
    </Svg>
  ),
  download: (p: P) => (
    <Svg {...p}>
      <path d="M12 3v12M7 11l5 5 5-5M4 21h16" />
    </Svg>
  ),
  refresh: (p: P) => (
    <Svg {...p}>
      <path d="M21 12a9 9 0 1 1-3.2-6.9" />
      <path d="M21 3v5h-5" />
    </Svg>
  ),
  desktop: (p: P) => (
    <Svg {...p}>
      <rect x="2.5" y="4" width="19" height="12.5" rx="2" />
      <path d="M9 20.5h6M12 16.5v4" />
    </Svg>
  ),
  tablet: (p: P) => (
    <Svg {...p}>
      <rect x="5" y="2.5" width="14" height="19" rx="2.5" />
      <path d="M11 18.5h2" />
    </Svg>
  ),
  mobile: (p: P) => (
    <Svg {...p}>
      <rect x="7" y="2.5" width="10" height="19" rx="2.5" />
      <path d="M11 18.5h2" />
    </Svg>
  ),
  copy: (p: P) => (
    <Svg {...p}>
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15V5a2 2 0 0 1 2-2h8" />
    </Svg>
  ),
  trash: (p: P) => (
    <Svg {...p}>
      <path d="M4 7h16M9 7V4.5h6V7M6 7l1 13h10l1-13" />
    </Svg>
  ),
  clock: (p: P) => (
    <Svg {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5V12l3 2" />
    </Svg>
  ),
  wand: (p: P) => (
    <Svg {...p}>
      <path d="M4 20l9-9M14 4l.9 2.1L17 7l-2.1.9L14 10l-.9-2.1L11 7l2.1-.9L14 4z" />
      <path d="M19 13l.7 1.6 1.6.7-1.6.7L19 17.6l-.7-1.6-1.6-.7 1.6-.7L19 13z" />
    </Svg>
  ),
  stop: (p: P) => (
    <Svg {...p}>
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </Svg>
  ),
  layers: (p: P) => (
    <Svg {...p}>
      <path d="M12 3l9 5-9 5-9-5 9-5z" />
      <path d="M3.5 12.5L12 17l8.5-4.5" />
      <path d="M3.5 16.5L12 21l8.5-4.5" />
    </Svg>
  ),
  arrow: (p: P) => (
    <Svg {...p}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </Svg>
  ),
  bug: (p: P) => (
    <Svg {...p}>
      <rect x="7" y="8" width="10" height="12" rx="5" />
      <path d="M9 4.5L11 7M15 4.5L13 7M3 12h4M17 12h4M3.5 17.5L7 15.5M20.5 17.5L17 15.5M3.5 7L7 8.5M20.5 7L17 8.5" />
    </Svg>
  ),
  menu: (p: P) => (
    <Svg {...p}>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </Svg>
  ),
  chat: (p: P) => (
    <Svg {...p}>
      <path d="M21 12a8 8 0 0 1-8 8H8l-4 3v-6.5A8 8 0 0 1 13 4a8 8 0 0 1 8 8z" />
    </Svg>
  ),
  external: (p: P) => (
    <Svg {...p}>
      <path d="M14 4h6v6M20 4l-8 8M19 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5" />
    </Svg>
  ),
};

export type IconName = keyof typeof Icon;
