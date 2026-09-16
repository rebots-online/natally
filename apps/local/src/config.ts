// natally — local app configuration hook (T0.10). Thin re-export: feeds the
// Vite `import.meta.env` record into the pure loader in @natally/billing
// (ARCHITECTURE §15). All validation, freezing and derivation live there; the
// app only ever imports the resolved frozen `config`.
import {
  loadConfig,
  type EnvRecord,
  type RuntimeConfig,
} from "@natally/billing/config";

// import.meta.env typing, self-contained so this module needs no additional
// ambient d.ts. Identical to vite/client's declaration, so the two merge
// cleanly once the app scaffold references vite/client types.
declare global {
  interface ImportMetaEnv {
    readonly [key: string]: string | undefined;
  }
  interface ImportMeta {
    readonly env: ImportMetaEnv;
  }
}

export type { EnvRecord, RuntimeConfig } from "@natally/billing/config";
export { ConfigError, PAYMENT_RAIL_ORDER, paymentsAvailable } from "@natally/billing/config";

/** Resolved, deeply frozen app configuration (validated at module load). */
export const config: RuntimeConfig = loadConfig(import.meta.env satisfies EnvRecord);
