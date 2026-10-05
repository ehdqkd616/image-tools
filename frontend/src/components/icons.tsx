import type { ReactNode } from "react";

type IconProps = { className?: string };
const svg = (d: ReactNode) =>
  function Icon({ className }: IconProps) {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
        {d}
      </svg>
    );
  };
export const IconHome = svg(<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />);
export const IconUpscale = svg(
  <>
    <rect x="3" y="3" width="8" height="8" rx="1" />
    <path d="M14 3h7v7M21 3l-8 8M3 14v7h7" />
  </>,
);
export const IconResize = svg(
  <>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M9 3v18M3 9h18" />
  </>,
);
export const IconCompress = svg(<path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7" />);
export const IconHistory = svg(
  <>
    <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
    <path d="M3 3v5h5M12 7v5l3 3" />
  </>,
);
export const IconUser = svg(
  <>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21a8 8 0 0 1 16 0" />
  </>,
);
