// Types for the Nazir SDK 1.0.0 (nazir.mjs).
export interface NazirTurn { active: boolean; session?: string; mode?: string; reply(text: string): void }
/* eslint-disable @typescript-eslint/no-explicit-any */
export interface ToolOptions<A = any, R = any> {
  action?: string; changesData?: boolean; dryRun?: (...args: never[]) => R | Promise<R>; outsideContent?: boolean; sendsOut?: boolean;
  description?: string; inputSchema?: unknown; map?: (args: A, result: R) => Record<string, unknown>; mcp?: string;
}
export interface Nazir {
  init(options: { key?: string | null; agent?: { name?: string; version?: string }; url?: string; publicKeys?: { kid: string; alg: string; public_key: string }[]; redact?: (span: unknown) => unknown }): Nazir;
  describe(info: Record<string, unknown>): Nazir;
  tool<F extends (...args: never[]) => unknown>(name: string, impl: F, options?: ToolOptions): (...args: Parameters<F>) => Promise<Awaited<ReturnType<F>>>;
  turn<T>(request: unknown, handler: (turn: NazirTurn) => T | Promise<T>): Promise<T>;
  action(type: string, data?: Record<string, unknown>): void;
  wrapOpenAI<C>(client: C): C;
  wrapMcp<C>(client: C, server?: { name?: string; tools?: Record<string, ToolOptions> }): C;
  redact(text: string): string;
  readonly active: boolean;
  readonly VERSION: string;
}
export const VERSION: string;
export function createNazir(options?: Parameters<Nazir['init']>[0]): Nazir;
export function redact(text: string): string;
export const nazir: Nazir;
export default nazir;
