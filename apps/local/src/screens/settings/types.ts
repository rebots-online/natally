// natally — U.5 injected seams for the settings screen (ARCHITECTURE.md §8.4,
// §9.1–§9.5, §10, §13). Everything the screen needs that another task owns
// arrives as a structural prop: the wiring layer (I.1) binds the real
// instances later, the screen never imports their modules. Shapes are mirrors,
// not re-exports — the owning tasks do not expose these on their public
// surfaces yet. The one non-mirror import is the M.1 `CatalogueRow` type
// (same app, catalogue.ts is this task's documented read).

import type { CatalogueRow } from "../../mirror/catalogue";

// ---------------------------------------------------------------------------
// B.1 trial gate (§9.1/§9.2) — the License section's trial status line
// ---------------------------------------------------------------------------

/**
 * The designed gate states (§9.2), mirrored structurally from B.1's
 * `GateResult`: `remaining` appears only on `trial-active` (count mode:
 * readings left; time mode: days left), `nextReadingAt` only on
 * `rate-limited` (the next-reading instant).
 */
export interface GateView {
  readonly state: "trial-active" | "trial-exhausted" | "rate-limited" | "licensed";
  readonly remaining?: number;
  readonly nextReadingAt?: number;
}

// ---------------------------------------------------------------------------
// B.3 license read (§9.3) — the License section's licensed state
// ---------------------------------------------------------------------------

/**
 * B.3's verified token payload, mirrored (§9.3): `tier` is always
 * `unlimited`; `iat` (epoch seconds) feeds the computed "unlocked" date.
 * Present only when the token verified offline against the baked key.
 */
export interface LicensePayloadView {
  readonly sub: string;
  readonly tier: "unlimited";
  readonly iat: number;
}

// ---------------------------------------------------------------------------
// M.1 catalogue view (§13) — the Model section's rows
// ---------------------------------------------------------------------------

/**
 * The structural subset of the M.1 `Catalogue` the screen consumes. The real
 * instance satisfies it verbatim; `remove` re-emits the row set through
 * `subscribe` when it deletes (so the screen only ever re-renders from the
 * subscription), and `list()` is the initial hydration read.
 */
export interface CatalogueView {
  subscribe(listener: (rows: readonly CatalogueRow[]) => void): () => void;
  list(): Promise<readonly CatalogueRow[]>;
  remove(assetId: string): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// V.1/V.2 voice view (§10) — the Voice section's Kokoro controls
// ---------------------------------------------------------------------------

/** One Kokoro voice in the picker (id + authored display name). */
export interface VoiceOptionView {
  readonly id: string;
  readonly name: string;
}

// ---------------------------------------------------------------------------
// B.5c restore (§9.4) — the License section's Restore purchases
// ---------------------------------------------------------------------------

/**
 * Honest restore outcome: `restored` (a token came back and verified),
 * `absent` (nothing to restore on this install — a fact, not an error), or
 * `failed` with the real reason.
 */
export type RestoreOutcomeView =
  | { readonly status: "restored" }
  | { readonly status: "absent" }
  | { readonly status: "failed"; readonly detail?: string };

// ---------------------------------------------------------------------------
// L.5 stats (§8.4) — the Data section's Lore summary line
// ---------------------------------------------------------------------------

/** LoreStats mirror: `[turns · nodes · runtime]`. */
export interface LoreStatsView {
  readonly turns: number;
  readonly nodes: number;
  readonly edges: number;
  /** Storage/embedding runtime label, e.g. `wa-sqlite/OPFS` or `rusqlite`. */
  readonly runtime: string;
}

// ---------------------------------------------------------------------------
// X.1 import summary (§5) — the Data section's import outcome
// ---------------------------------------------------------------------------

/** Rows actually inserted per table; 0 everywhere for an idempotent re-import. */
export interface ImportSummaryView {
  readonly people: number;
  readonly sessions: number;
  readonly turns: number;
  readonly charts: number;
  readonly consumedCodes: number;
  readonly loreNodes: number;
  readonly loreEdges: number;
}

// ---------------------------------------------------------------------------
// X.2 destroy report (§8.4) — the Data section's delete-everything outcome
// ---------------------------------------------------------------------------

/**
 * Declined confirm ⇒ `{ aborted: true }` and nothing touched; accepted ⇒ the
 * honest deletion report. `delete-everything` includes lore — real deletion,
 * rows + vectors, never soft-hide (§8.4).
 */
export type DestroyReportView =
  | { readonly aborted: true }
  | {
      readonly aborted: false;
      readonly tablesCleared: readonly string[];
      readonly filesDeleted: readonly string[];
      readonly tokenCleared: boolean;
    };

// ---------------------------------------------------------------------------
// Screen props
// ---------------------------------------------------------------------------

export type SettingsScreenProps = {
  /**
   * §6: the persisted house system, the 1-char engine code from the
   * `HOUSE_SYSTEMS` union; `undefined` ⇒ nothing selected yet (no chip is
   * active — honest absence, never a fabricated default).
   */
  readonly houseSystem?: string;
  /** House-system chip select (the settings persistence seam). */
  readonly onHouseSystemChange: (system: string) => void;
  /** The M.1 catalogue (rows, real download progress, remove). */
  readonly catalogue: CatalogueView;
  /**
   * §9.1: license state. Non-trial rows render the lock and route to
   * /paywall only while this is false; a licensed install sees plain rows.
   */
  readonly isLicensed: boolean;
  /** B.1 gate mirror for the License section's trial status line (§9.2). */
  readonly gate: GateView;
  /** B.3 verified payload — present only when licensed (§9.3). */
  readonly tokenPayload?: LicensePayloadView;
  /** B.5c registry restore (§9.4). */
  readonly restoreLicense: () => Promise<RestoreOutcomeView>;
  /** "Enter a code" — routes to /paywall's enter-code state (the wiring). */
  readonly onEnterCode: () => void;
  /** Trial-model lock tap — routes to /paywall (J6 amended, §9.1). */
  readonly onUnlock: () => void;
  /** V.1/V.2 Kokoro picker, preview and mute (§10; identical on web per D7a). */
  readonly voices: readonly VoiceOptionView[];
  readonly voiceId?: string;
  readonly onVoiceSelect: (voiceId: string) => void;
  readonly onPreview: (voiceId: string) => void;
  readonly muted: boolean;
  readonly onMuteToggle: (muted: boolean) => void;
  /**
   * X.1 export (J8): resolves the versioned ExportDocument; the screen
   * serializes and downloads it as plaintext JSON (§13 — "the UI says so").
   */
  readonly exportAll: () => Promise<unknown>;
  /** X.1 import: one parsed ExportDocument → the honest inserted-rows summary. */
  readonly importDocument: (doc: unknown) => Promise<ImportSummaryView>;
  /**
   * X.2 destroy-everything with everything except the confirm pre-bound:
   * the screen supplies its confirm plate (§8.4 — resolving `false` aborts
   * with nothing touched).
   */
  readonly destroyEverything: (confirm: () => Promise<boolean>) => Promise<DestroyReportView>;
  /** L.5 stats provider for the Lore summary line (§8.4). */
  readonly loreStats: () => Promise<LoreStatsView>;
  /** About link (routes to /about — the frozen route set). */
  readonly onAbout: () => void;
  /** The web composition (1280 wide; same rows per SCREEN.md). */
  readonly desktop?: boolean;
};
