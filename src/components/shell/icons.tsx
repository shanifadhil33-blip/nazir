export type ShellIconName =
  | 'home'
  | 'checks'
  | 'play'
  | 'pencil'
  | 'more'
  | 'search'
  | 'bell'
  | 'eye'
  | 'clock'
  | 'check'
  | 'alert'
  | 'dot'
  | 'report'
  | 'settings'
  | 'help'
  | 'wrench';

const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

export function ShellIcon({ name, directional = false }: { name: ShellIconName; directional?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={directional ? 'nz-icon-dir' : undefined}>
      {name === 'home' ? <>
        <path {...stroke} d="M4 11.2 12 4l8 7.2" />
        <path {...stroke} d="M7 10.2V20h10v-9.8" />
      </> : null}
      {name === 'checks' ? <>
        <path {...stroke} d="M9 7h10M9 12h10M9 17h10" />
        <path {...stroke} d="m4.2 7.2 1.2 1.2 2-2.2M4.2 12.2l1.2 1.2 2-2.2M4.2 17.2l1.2 1.2 2-2.2" />
      </> : null}
      {name === 'play' ? <path fill="currentColor" stroke="none" d="M9 7.2v9.6l8.2-4.8L9 7.2z" /> : null}
      {name === 'pencil' ? <>
        <path {...stroke} d="M4 20h4L19 9l-4-4L4 16v4z" />
        <path {...stroke} d="m13 7 4 4" />
      </> : null}
      {name === 'more' ? <>
        <circle {...stroke} cx="12" cy="8" r="3" />
        <path {...stroke} d="M5.5 19.2c1.1-2.8 3.2-4.2 6.5-4.2s5.4 1.4 6.5 4.2" />
      </> : null}
      {name === 'search' ? <>
        <circle {...stroke} cx="11" cy="11" r="6" />
        <path {...stroke} d="m16 16 4 4" />
      </> : null}
      {name === 'bell' ? <>
        <path {...stroke} d="M6 16V11a6 6 0 1 1 12 0v5l1.4 2H4.6L6 16z" />
        <path {...stroke} d="M10 18.2a2 2 0 0 0 4 0" />
      </> : null}
      {name === 'eye' ? <>
        <path {...stroke} d="M2.5 12S6 6.8 12 6.8 21.5 12 21.5 12 18 17.2 12 17.2 2.5 12 2.5 12z" />
        <circle {...stroke} cx="12" cy="12" r="2.4" />
      </> : null}
      {name === 'clock' ? <>
        <circle {...stroke} cx="12" cy="12" r="8" />
        <path {...stroke} d="M12 8v4.5l3 2" />
      </> : null}
      {name === 'check' ? <>
        <circle {...stroke} cx="12" cy="12" r="8" />
        <path {...stroke} d="m8.4 12.2 2.3 2.3 4.8-5.2" />
      </> : null}
      {name === 'alert' ? <>
        <circle {...stroke} cx="12" cy="12" r="8" />
        <path {...stroke} d="M12 8v5" />
        <path {...stroke} d="M12 16.2h.01" />
      </> : null}
      {name === 'dot' ? <circle cx="12" cy="12" r="4.5" fill="currentColor" /> : null}
      {name === 'report' ? <path {...stroke} d="M5 19V11M12 19V5M19 19v-7" /> : null}
      {name === 'settings' ? <>
        <circle {...stroke} cx="12" cy="12" r="3" />
        <path {...stroke} d="M12 3.6v2M12 18.4V20.4M3.6 12h2M18.4 12h2M6.1 6.1l1.4 1.4M16.5 16.5l1.4 1.4M17.9 6.1l-1.4 1.4M7.5 16.5l-1.4 1.4" />
      </> : null}
      {name === 'help' ? <>
        <circle {...stroke} cx="12" cy="12" r="8" />
        <path {...stroke} d="M9.8 9.6a2.3 2.3 0 0 1 4.4.9c0 1.5-2.2 1.9-2.2 3.2" />
        <path {...stroke} d="M12 16.6h.01" />
      </> : null}
      {name === 'wrench' ? <path {...stroke} d="M14.5 6.5a4 4 0 0 0 4.9 4.9l-9.4 9.4a2.1 2.1 0 0 1-3-3l9.4-9.4a4 4 0 0 0-1.9-1.9z" /> : null}
    </svg>
  );
}
