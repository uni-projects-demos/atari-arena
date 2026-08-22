import type { ReactNode } from "react";

interface IconProps {
  children: ReactNode;
  filled?: boolean;
}

function Icon({ children, filled = false }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke={filled ? undefined : "currentColor"}
      strokeWidth={filled ? undefined : 1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

export function HeaderIcon({ children }: { children: ReactNode }) {
  return (
    <span className="header-action-icon" aria-hidden="true">
      {children}
    </span>
  );
}

export function SunIcon() {
  return (
    <Icon>
      <circle cx={12} cy={12} r={3.5} />

      <path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.65 17.65l1.42 1.42M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.65 6.35l1.42-1.42" />
    </Icon>
  );
}

export function MoonIcon() {
  return (
    <Icon>
      <path d="M20.5 14.2A8.4 8.4 0 0 1 9.8 3.5 8.6 8.6 0 1 0 20.5 14.2Z" />
    </Icon>
  );
}

export function GlobeIcon() {
  return (
    <Icon>
      <circle cx={12} cy={12} r={9} />

      <path d="M3 12h18M12 3c2.2 2.5 3.3 5.5 3.3 9S14.2 18.5 12 21M12 3C9.8 5.5 8.7 8.5 8.7 12S9.8 18.5 12 21" />
    </Icon>
  );
}

export function GitHubMarkIcon() {
  return (
    <Icon filled>
      <path d="M12 .7C5.73.7.65 5.78.65 12.05c0 5.01 3.24 9.26 7.74 10.76.57.1.78-.25.78-.55 0-.27-.01-1.15-.02-2.09-3.15.69-3.81-1.34-3.81-1.34-.52-1.32-1.28-1.67-1.28-1.67-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.71 1.26 3.37.96.1-.75.4-1.26.72-1.55-2.51-.29-5.15-1.26-5.15-5.59 0-1.24.44-2.25 1.16-3.04-.12-.29-.5-1.44.11-2.99 0 0 .95-.3 3.1 1.16a10.8 10.8 0 0 1 2.82-.38c.96 0 1.92.13 2.82.38 2.15-1.46 3.1-1.16 3.1-1.16.61 1.55.23 2.7.11 2.99.72.79 1.16 1.8 1.16 3.04 0 4.34-2.64 5.3-5.16 5.58.41.35.77 1.04.77 2.1 0 1.52-.01 2.74-.01 3.11 0 .3.21.65.78.54a11.36 11.36 0 0 0 7.75-10.76C23.35 5.78 18.27.7 12 .7Z" />
    </Icon>
  );
}
