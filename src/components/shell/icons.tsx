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
  | 'wrench'
  | 'tick'
  | 'cross'
  | 'ring'
  | 'up'
  | 'down'
  | 'chevron'
  | 'download'
  | 'share'
  | 'globe'
  | 'chat'
  | 'people'
  | 'refresh'
  | 'robot';

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
      {name === 'tick' ? <path {...stroke} d="m6 12.4 4 4 8-8.6" /> : null}
      {name === 'cross' ? <path {...stroke} d="m7 7 10 10M17 7 7 17" /> : null}
      {name === 'ring' ? <circle {...stroke} cx="12" cy="12" r="4" /> : null}
      {name === 'up' ? <path {...stroke} d="M12 18V6M7 11l5-5 5 5" /> : null}
      {name === 'down' ? <path {...stroke} d="M12 6v12M7 13l5 5 5-5" /> : null}
      {name === 'chevron' ? <path {...stroke} d="m9.5 6 6 6-6 6" /> : null}
      {name === 'download' ? <>
        <path {...stroke} d="M12 4.5v10M7.8 10.6l4.2 4.2 4.2-4.2" />
        <path {...stroke} d="M5 19h14" />
      </> : null}
      {name === 'share' ? <>
        <circle {...stroke} cx="17" cy="6.5" r="2.3" />
        <circle {...stroke} cx="7" cy="12" r="2.3" />
        <circle {...stroke} cx="17" cy="17.5" r="2.3" />
        <path {...stroke} d="m9 10.9 6-3.3M9 13.1l6 3.3" />
      </> : null}
      {name === 'globe' ? <>
        <circle {...stroke} cx="12" cy="12" r="8" />
        <path {...stroke} d="M4 12h16M12 4c2.4 2.2 3.6 4.9 3.6 8s-1.2 5.8-3.6 8c-2.4-2.2-3.6-4.9-3.6-8S9.6 6.2 12 4z" />
      </> : null}
      {name === 'chat' ? <path {...stroke} d="M5 6h14v9.5H10L6.5 19v-3.5H5V6z" /> : null}
      {name === 'people' ? <>
        <circle {...stroke} cx="9" cy="9" r="3" />
        <path {...stroke} d="M3.5 19c.8-2.8 2.7-4.2 5.5-4.2s4.7 1.4 5.5 4.2" />
        <path {...stroke} d="M15.5 6.4a3 3 0 0 1 0 5.2M17 14.9c1.6.5 2.7 1.8 3.2 4" />
      </> : null}
      {name === 'refresh' ? <>
        <path {...stroke} d="M19 12a7 7 0 1 1-2.1-5" />
        <path {...stroke} d="M19 4.8v3.6h-3.6" />
      </> : null}
      {name === 'robot' ? <>
        <rect {...stroke} x="5" y="8" width="14" height="10" rx="3" />
        <path {...stroke} d="M12 8V5M9.5 12.5h.01M14.5 12.5h.01M9.5 15.5h5" />
      </> : null}
      {name === 'wrench' ? <path {...stroke} d="M14.5 6.5a4 4 0 0 0 4.9 4.9l-9.4 9.4a2.1 2.1 0 0 1-3-3l9.4-9.4a4 4 0 0 0-1.9-1.9z" /> : null}
    </svg>
  );
}
