/** The SDK files customers download, with the SHA256 shown next to each link. A test keeps these in sync. */
export const SDK_VERSION = '1.0.1';
export const SDK_FILES = [
  { lang: 'node', path: '/sdk/1.0.1/nazir.mjs', name: 'nazir.mjs', sha256: 'e8e5fffcbf506b550949774aa53854cc0520645a3208e90940271fc3e9a77606' },
  { lang: 'python', path: '/sdk/1.0.1/nazir.py', name: 'nazir.py', sha256: 'b781a3e572f7ac8d353c0f155f84d9d620516eb56d13f72d26c0bcedd664d2c0' },
] as const;


/** Older wrappers cannot promise that undeclared connected-tool writes stay in test mode. */
export function supportsMcpSafety(version: string | null | undefined) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version ?? '');
  if (!match) return false;
  const [major, minor, patch] = match.slice(1).map(Number) as [number, number, number];
  return major > 1 || (major === 1 && (minor > 0 || patch >= 1));
}
