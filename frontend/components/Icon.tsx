/** Tiny inline SVG icon set (no icon font, no network): crisp on any screen, ~0 KB over the wire. */
const PATHS: Record<string, React.ReactNode> = {
  speaker: (<><path d="M11 5 6 9H3v6h3l5 4V5z" /><path d="M15.5 8.5a5 5 0 0 1 0 7" /><path d="M18.5 5.5a9 9 0 0 1 0 13" /></>),
  mic: (<><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0" /><path d="M12 18v3" /></>),
  stop: <rect x="6" y="6" width="12" height="12" rx="2" />,
  home: (<><path d="M3 11 12 4l9 7" /><path d="M5 10v10h14V10" /><path d="M10 20v-6h4v6" /></>),
  back: (<><path d="M15 6l-6 6 6 6" /></>),
  forward: (<><path d="M9 6l6 6-6 6" /></>),
  eye: (<><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>),
  eyeOff: (<><path d="M3 3l18 18" /><path d="M10.6 5.1A10.8 10.8 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.1" /><path d="M6.6 6.6C3.7 8.4 2 12 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" /></>),
  check: <path d="M4 12.5l5 5L20 6.5" />,
  checkCircle: (<><circle cx="12" cy="12" r="9" /><path d="M8 12.5l3 3 5-6" /></>),
  alert: (<><path d="M12 3 2 20h20L12 3z" /><path d="M12 10v4" /><path d="M12 17.5v.01" /></>),
  info: (<><circle cx="12" cy="12" r="9" /><path d="M12 11v6" /><path d="M12 7.5v.01" /></>),
  x: (<><path d="M6 6l12 12" /><path d="M18 6 6 18" /></>),
  shield: (<><path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6l-8-3z" /><path d="M8.5 12l2.5 2.5 4.5-5" /></>),
  users: (<><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><circle cx="17" cy="9" r="2.5" /><path d="M16 14.2a5 5 0 0 1 5.5 5.8" /></>),
  form: (<><path d="M7 3h7l5 5v13H7z" /><path d="M14 3v5h5" /><path d="M10 13h6" /><path d="M10 17h6" /></>),
  receipt: (<><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" /><path d="M9 8h6" /><path d="M9 12h6" /></>),
  search: (<><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></>),
  wifi: (<><path d="M2 9a15 15 0 0 1 20 0" /><path d="M5.5 12.5a10 10 0 0 1 13 0" /><path d="M9 16a5 5 0 0 1 6 0" /><path d="M12 19.5v.01" /></>),
  wifiOff: (<><path d="M3 3l18 18" /><path d="M9 16a5 5 0 0 1 6 0" /><path d="M5.5 12.5a10 10 0 0 1 4-2.3" /><path d="M2 9a15 15 0 0 1 5-3.2" /><path d="M14.5 10.3a10 10 0 0 1 4 2.2" /><path d="M12 19.5v.01" /></>),
  lock: (<><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></>),
  camera: (<><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></>),
  clipboard: (<><rect x="6" y="4" width="12" height="17" rx="2" /><path d="M9 4h6v3H9z" /></>),
  login: (<><path d="M14 4h5v16h-5" /><path d="M10 8l4 4-4 4" /><path d="M14 12H3" /></>),
  logout: (<><path d="M10 4H5v16h5" /><path d="M14 8l4 4-4 4" /><path d="M18 12H8" /></>),
  sync: (<><path d="M4 12a8 8 0 0 1 14-5.3L20 9" /><path d="M20 4v5h-5" /><path d="M20 12a8 8 0 0 1-14 5.3L4 15" /><path d="M4 20v-5h5" /></>),
  hand: (<><path d="M7 11V6a1.5 1.5 0 0 1 3 0v4" /><path d="M10 10V4.5a1.5 1.5 0 0 1 3 0V10" /><path d="M13 10V5.5a1.5 1.5 0 0 1 3 0V12" /><path d="M16 9.5a1.5 1.5 0 0 1 3 0V14a7 7 0 0 1-7 7h-.5a6 6 0 0 1-5-2.7L4 14.5a1.6 1.6 0 0 1 2.6-1.8L8 14V11" /></>),
  print: (<><path d="M7 9V3h10v6" /><rect x="3" y="9" width="18" height="8" rx="2" /><path d="M7 14h10v7H7z" /></>),
  keypad: (<><circle cx="6" cy="6" r="1.2" /><circle cx="12" cy="6" r="1.2" /><circle cx="18" cy="6" r="1.2" /><circle cx="6" cy="12" r="1.2" /><circle cx="12" cy="12" r="1.2" /><circle cx="18" cy="12" r="1.2" /><circle cx="12" cy="18" r="1.2" /></>),
  backspace: (<><path d="M21 5H8l-6 7 6 7h13z" /><path d="M11 9l6 6" /><path d="M17 9l-6 6" /></>),
  help: (<><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6" /><path d="M12 17v.01" /></>),
  chart: (<><path d="M4 20V4" /><path d="M4 20h16" /><path d="M8 16v-5" /><path d="M12 16V8" /><path d="M16 16v-3" /></>),
  bolt: <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z" />,
  link: (<><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></>),
  paste: (<><rect x="8" y="8" width="12" height="13" rx="2" /><path d="M16 8V5a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h2" /></>),
  layers: (<><path d="M12 3 2 8l10 5 10-5-10-5z" /><path d="M2 13l10 5 10-5" /></>),
  shieldAlert: (<><path d="M12 3 4 6v6c0 5 3.4 8.4 8 9 4.6-.6 8-4 8-9V6l-8-3z" /><path d="M12 8v5" /><path d="M12 16.5h.01" /></>),
  bell: (<><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></>),
};

export type IconName = keyof typeof PATHS;

export default function Icon({ name, size = 24, className = "", strokeWidth = 2 }: { name: IconName; size?: number; className?: string; strokeWidth?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={`shrink-0 ${className}`}
    >
      {PATHS[name]}
    </svg>
  );
}
