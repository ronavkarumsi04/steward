import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Base({ size = 18, children, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const Icon = {
  Overview: (p: IconProps) => (
    <Base {...p}>
      <rect x="3" y="3" width="8" height="8" rx="2" />
      <rect x="13" y="3" width="8" height="5" rx="2" />
      <rect x="13" y="12" width="8" height="9" rx="2" />
      <rect x="3" y="15" width="8" height="6" rx="2" />
    </Base>
  ),
  Chat: (p: IconProps) => (
    <Base {...p}>
      <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 3.5V16H6.5A2.5 2.5 0 0 1 4 13.5z" />
    </Base>
  ),
  Growth: (p: IconProps) => (
    <Base {...p}>
      <path d="M4 19V5M4 19h16" />
      <path d="M7 15l4-4 3 2 5-6" />
      <path d="M16 7h3v3" />
    </Base>
  ),
  Finance: (p: IconProps) => (
    <Base {...p}>
      <rect x="3" y="6" width="18" height="13" rx="2" />
      <path d="M3 9h18" />
      <path d="M15 14h3" />
    </Base>
  ),
  Tasks: (p: IconProps) => (
    <Base {...p}>
      <path d="M4 6h3M4 12h3M4 18h3" />
      <path d="M10 6h10M10 12h10M10 18h10" />
    </Base>
  ),
  Signals: (p: IconProps) => (
    <Base {...p}>
      <path d="M3 12h4l2.2-5 4.2 10 2.2-5H21" />
      <circle cx="12" cy="12" r="9" opacity=".25" />
    </Base>
  ),
  Runs: (p: IconProps) => (
    <Base {...p}>
      <path d="M5 12h3l2-5 4 10 2-5h3" />
    </Base>
  ),
  Activity: (p: IconProps) => (
    <Base {...p}>
      <path d="M3 12h4l2.2-5 4.1 10 2.2-5H21" />
      <path d="M4 5.5h3M17 18.5h3" opacity=".45" />
    </Base>
  ),
  Approvals: (p: IconProps) => (
    <Base {...p}>
      <path d="M12 3l7 3v5c0 4.5-3 8.2-7 10-4-1.8-7-5.5-7-10V6z" />
      <path d="M9 12l2 2 4-4" />
    </Base>
  ),
  Agents: (p: IconProps) => (
    <Base {...p}>
      <circle cx="9" cy="8" r="3" />
      <path d="M3.5 19a5.5 5.5 0 0 1 11 0" />
      <circle cx="17" cy="9" r="2.5" />
      <path d="M15.5 14.5a4.5 4.5 0 0 1 5 4.5" />
    </Base>
  ),
  Knowledge: (p: IconProps) => (
    <Base {...p}>
      <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H10a2 2 0 0 1 2 2v14a2 2 0 0 0-2-2H5.5A1.5 1.5 0 0 1 4 16.5z" />
      <path d="M20 5.5A1.5 1.5 0 0 0 18.5 4H14a2 2 0 0 0-2 2v14a2 2 0 0 1 2-2h4.5a1.5 1.5 0 0 0 1.5-1.5z" />
    </Base>
  ),
  Settings: (p: IconProps) => (
    <Base {...p}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1" />
    </Base>
  ),
  Providers: (p: IconProps) => (
    <Base {...p}>
      <path d="M13 3L5 13h6l-1 8 8-10h-6z" />
    </Base>
  ),
  Integrations: (p: IconProps) => (
    <Base {...p}>
      <path d="M9 3v4M15 3v4M7 7h10v4a5 5 0 0 1-10 0z" />
      <path d="M12 16v5" />
    </Base>
  ),
  Members: (p: IconProps) => (
    <Base {...p}>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20a7 7 0 0 1 14 0" />
    </Base>
  ),
  Plus: (p: IconProps) => (
    <Base {...p}>
      <path d="M12 5v14M5 12h14" />
    </Base>
  ),
  Check: (p: IconProps) => (
    <Base {...p}>
      <path d="M5 12.5l4.5 4.5L19 7" />
    </Base>
  ),
  X: (p: IconProps) => (
    <Base {...p}>
      <path d="M6 6l12 12M18 6L6 18" />
    </Base>
  ),
  ArrowRight: (p: IconProps) => (
    <Base {...p}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </Base>
  ),
  ChevronRight: (p: IconProps) => (
    <Base {...p}>
      <path d="M9 6l6 6-6 6" />
    </Base>
  ),
  Menu: (p: IconProps) => (
    <Base {...p}>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </Base>
  ),
  Company: (p: IconProps) => (
    <Base {...p}>
      <path d="M4 21V5.5A1.5 1.5 0 0 1 5.5 4h7A1.5 1.5 0 0 1 14 5.5V21" />
      <path d="M14 10h4.5A1.5 1.5 0 0 1 20 11.5V21" />
      <path d="M7.5 8h3M7.5 12h3M7.5 16h3M3 21h18" />
    </Base>
  ),
  Lock: (p: IconProps) => (
    <Base {...p}>
      <rect x="5" y="10" width="14" height="10" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </Base>
  ),
  Eye: (p: IconProps) => (
    <Base {...p}>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="3" />
    </Base>
  ),
  Server: (p: IconProps) => (
    <Base {...p}>
      <rect x="4" y="4" width="16" height="6" rx="1.5" />
      <rect x="4" y="14" width="16" height="6" rx="1.5" />
      <path d="M8 7h.01M8 17h.01" />
    </Base>
  ),
  Sparkle: (p: IconProps) => (
    <Base {...p}>
      <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />
    </Base>
  ),
  Logo: (p: IconProps) => (
    <svg width={p.size ?? 20} height={p.size ?? 20} viewBox="0 0 24 24" aria-hidden="true" focusable="false" {...p}>
      <rect x="2" y="2" width="20" height="20" rx="6" fill="currentColor" />
      <path d="M8 15.5c1 1 2.4 1.5 4 1.5 2.3 0 3.8-1.1 3.8-2.7 0-1.7-1.5-2.3-3.7-2.8-1.9-.4-3.1-.8-3.1-2 0-1.1 1.1-1.9 2.9-1.9 1.3 0 2.5.4 3.4 1.2" fill="none" stroke="var(--panel)" strokeWidth="2" strokeLinecap="round" />
    </svg>
  ),
};
