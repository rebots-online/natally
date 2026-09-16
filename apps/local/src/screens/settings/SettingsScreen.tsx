// natally — U.5: the settings screen. SCREEN.md screen-settings is normative:
// six sections in one scroll — House system (12 chips) · Model (catalogue rows
// with size, real download progress, storage used, remove; the designated
// trial model is flagged, every other row locks behind the unlock while
// unlicensed — §9.1, D11) · Voice (Kokoro picker, preview, mute; identical on
// web, where Kokoro runs in-browser via onnxruntime-web per D7a) · License
// (`[trial …]` / `[unlimited]` status, Restore purchases, Enter a code) ·
// Data (export JSON incl. lore, import, delete everything, Lore · what she
// remembers: `[turns · nodes · runtime]`) · About link.
//
// All deps are injected (structural shapes in ./types.ts): the M.1 catalogue,
// the B.1 gate + B.3 license read, the B.5c restore, the V.1/V.2 voice
// controls, the X.1 export/import seams, the X.2 destroy-everything seam (the
// screen supplies its confirm plate — resolving `false` aborts with nothing
// touched, §8.4), and the L.5 stats provider. ./index.ts is the route module
// with the documented default bindings.
//
// INC-19: every value below is an authored-static label, a computed fact
// rendered in Plex Mono with data-provenance="computed", or a labelled honest
// absence — no canned interpretation, no invented progress.

import { HOUSE_SYSTEM_NAMES, HOUSE_SYSTEMS } from "@natally/ephemeris/types";
import { type ChangeEvent, type ReactElement, type ReactNode, useEffect, useState } from "react";
import type { CatalogueRow } from "../../mirror/catalogue";
import { Button, Chip, TopBar } from "../../ui/primitives";
import type {
  DestroyReportView,
  GateView,
  ImportSummaryView,
  LoreStatsView,
  RestoreOutcomeView,
  SettingsScreenProps,
} from "./types";

// ---------------------------------------------------------------------------
// Frozen type ramp fragments (TOKENS.md text styles)
// ---------------------------------------------------------------------------

const MONO_MICRO = [
  "font-[family-name:'IBM_Plex_Mono',ui-monospace,monospace]",
  "text-[12px] leading-[16px]",
].join(" ");
const MONO_INLINE = "font-[family-name:'IBM_Plex_Mono',ui-monospace,monospace] text-[14px]";
const MONO_MUTED = `m-0 ${MONO_MICRO} text-[var(--color-vellum-muted)]`;
const ASIDE = [
  "font-[family-name:'Fraunces',serif] italic text-[16px] leading-[24px]",
  "text-[var(--color-vellum)]",
].join(" ");
const SECTION_TITLE =
  "m-0 font-[family-name:'Nunito_Sans',ui-sans-serif,sans-serif] text-[16px] leading-[24px] font-semibold text-[var(--color-vellum)]";
/** Unstyled tap target wrapping a Chip (the chip is the frozen visual). */
const CHIP_TARGET = [
  "inline-flex cursor-pointer items-center border-0 bg-transparent p-0",
  "focus-visible:outline focus-visible:outline-[color:var(--color-orbglow)]",
].join(" ");

// ---------------------------------------------------------------------------
// Computed-fact formatters (INC-19: rendered in Plex Mono at the call site)
// ---------------------------------------------------------------------------

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/** Local `YYYY-MM-DD` for the license payload's `iat` (epoch seconds). */
function formatDate(epochSeconds: number): string {
  const at = new Date(epochSeconds * 1000);
  return `${at.getFullYear()}-${pad2(at.getMonth() + 1)}-${pad2(at.getDate())}`;
}

/** Local `YYYY-MM-DD · HH:MM` for the rate gate's next-reading instant (§9.2). */
function formatInstant(epochMs: number): string {
  const at = new Date(epochMs);
  return `${formatDate(at.getTime() / 1000)} · ${pad2(at.getHours())}:${pad2(at.getMinutes())}`;
}

/** Byte count as `B` / `KB` / `MB` / `GB`, one decimal above 1024 B. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const kb = bytes / 1024;
  if (kb < 1024) {
    return `${kb.toFixed(1)} KB`;
  }
  const mb = kb / 1024;
  if (mb < 1024) {
    return `${mb.toFixed(1)} MB`;
  }
  return `${(mb / 1024).toFixed(1)} GB`;
}

/** Integer 0–100 percent from the row's real bytes (guarded against 0 total). */
function formatPercent(bytesDone: number, bytesTotal: number): string {
  if (bytesTotal <= 0) {
    return "0";
  }
  const pct = Math.min(100, Math.max(0, Math.floor((bytesDone / bytesTotal) * 100)));
  return String(pct);
}

/** The real reason from a rejected seam, or the honest "unknown failure". */
function detailOf(error: unknown): string {
  return error instanceof Error ? error.message : "unknown failure";
}

/** Read an import file as text via FileReader (safe on every webview floor). */
function readFileText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve(String(reader.result));
    };
    reader.onerror = () => {
      reject(reader.error ?? new Error("the file could not be read"));
    };
    reader.readAsText(file);
  });
}

/** The trial side of the License status line from the B.1 gate (§9.2). */
function trialStatusLine(gate: GateView): string {
  if (gate.remaining !== undefined) {
    return `[trial · ${gate.remaining} readings left]`;
  }
  if (gate.nextReadingAt !== undefined) {
    return `[trial · next reading ${formatInstant(gate.nextReadingAt)}]`;
  }
  if (gate.state === "trial-exhausted") {
    return "[trial · readings used]";
  }
  return "[trial]";
}

function describeDestroy(report: DestroyReportView): string {
  if (report.aborted) {
    return "declined — nothing was deleted";
  }
  return `deleted ${report.tablesCleared.length} tables · ${report.filesDeleted.length} files · license token ${report.tokenCleared ? "cleared" : "kept"}`;
}

// ---------------------------------------------------------------------------
// Section shell (the six SCREEN.md sections share one anatomy)
// ---------------------------------------------------------------------------

function Section({
  id,
  title,
  state,
  children,
}: {
  readonly id: string;
  readonly title: string;
  readonly state?: string;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <section
      data-section={id}
      data-testid={`section-${id}`}
      data-state={state}
      className="flex flex-col gap-3"
    >
      <h2 className={SECTION_TITLE}>{title}</h2>
      {children}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Model row (§13: size, real download progress, remove; lock while unlicensed)
// ---------------------------------------------------------------------------

function ModelRow({
  row,
  locked,
  onRemove,
  onUnlock,
}: {
  readonly row: CatalogueRow;
  readonly locked: boolean;
  readonly onRemove: () => void;
  readonly onUnlock: () => void;
}): ReactElement {
  const percent = formatPercent(row.bytesDone, row.bytesTotal);
  return (
    <div
      data-testid="model-row"
      data-asset={row.asset.id}
      data-state={row.state}
      className="flex flex-col gap-1 rounded-[var(--radius-plate)] border-[length:var(--stroke-hairline)] border-[color:var(--color-hairline)] bg-[var(--color-midnight-2)] p-3"
    >
      <div className="flex items-center justify-between gap-2">
        <span data-provenance="computed" className={MONO_INLINE}>
          {row.asset.id}
        </span>
        {locked ? (
          <Button
            variant="secondary"
            data-testid="model-lock"
            data-asset={row.asset.id}
            onClick={onUnlock}
            className="self-start"
          >
            Locked — unlock
          </Button>
        ) : row.state === "present" ? (
          <Button
            variant="quiet"
            data-testid="model-remove"
            data-asset={row.asset.id}
            onClick={onRemove}
            className="self-start"
          >
            Remove
          </Button>
        ) : null}
      </div>
      <p data-provenance="computed" className={MONO_MUTED}>
        {formatBytes(row.asset.bytes)}
        {row.state === "downloading" ? (
          <span data-testid="model-progress" data-percent={percent}>
            {" · "}
            {percent}% · {formatBytes(row.bytesDone)} / {formatBytes(row.bytesTotal)}
          </span>
        ) : null}
        {row.error !== undefined ? (
          <span data-testid="model-error">
            {" · "}
            {row.error}
          </span>
        ) : null}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The screen
// ---------------------------------------------------------------------------

export function SettingsScreen({
  houseSystem,
  onHouseSystemChange,
  catalogue,
  isLicensed,
  gate,
  tokenPayload,
  restoreLicense,
  onEnterCode,
  onUnlock,
  voices,
  voiceId,
  onVoiceSelect,
  onPreview,
  muted,
  onMuteToggle,
  exportAll,
  importDocument,
  destroyEverything,
  loreStats,
  onAbout,
  desktop = false,
}: SettingsScreenProps): ReactElement {
  // Model rows: hydrated once from the catalogue, then fed by its
  // subscription (progress ticks and removes arrive as re-emitted snapshots).
  const [rows, setRows] = useState<readonly CatalogueRow[]>([]);
  useEffect(() => {
    let alive = true;
    void catalogue.list().then((initial) => {
      if (alive) {
        setRows(initial);
      }
    });
    const unsubscribe = catalogue.subscribe((next) => {
      if (alive) {
        setRows(next);
      }
    });
    return () => {
      alive = false;
      unsubscribe();
    };
  }, [catalogue]);

  // Lore summary (§8.4): read once at mount; an unread store renders honest
  // absence, never zeros pretending to be a read.
  const [stats, setStats] = useState<LoreStatsView | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    loreStats().then(
      (next) => {
        if (alive) {
          setStats(next);
        }
      },
      () => {
        if (alive) {
          setStats(undefined);
        }
      },
    );
    return () => {
      alive = false;
    };
  }, [loreStats]);

  // License restore outcome (B.5c).
  const [restore, setRestore] = useState<RestoreOutcomeView | undefined>(undefined);

  // Data outcomes + the delete-everything confirm plate. The plate is U.5's
  // confirm (§8.4): requestDestroy hands the seam a promise resolved by the
  // plate — declining resolves `false`, which aborts with nothing touched.
  const [exportOutcome, setExportOutcome] = useState<string | undefined>(undefined);
  const [importOutcome, setImportOutcome] = useState<string | undefined>(undefined);
  const [deleteOutcome, setDeleteOutcome] = useState<string | undefined>(undefined);
  const [confirmResolve, setConfirmResolve] = useState<((choice: boolean) => void) | undefined>(
    undefined,
  );

  function runRestore(): void {
    void restoreLicense().then(
      (outcome) => {
        setRestore(outcome);
      },
      (error: unknown) => {
        setRestore({ status: "failed", detail: detailOf(error) });
      },
    );
  }

  function runExport(): void {
    void exportAll().then(
      (exported) => {
        const blob = new Blob([JSON.stringify(exported, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const anchor = window.document.createElement("a");
        anchor.href = url;
        anchor.download = "natally-export.json";
        anchor.click();
        URL.revokeObjectURL(url);
        setExportOutcome("exported natally-export.json — plaintext JSON, yours to keep");
      },
      (error: unknown) => {
        setExportOutcome(`export failed — ${detailOf(error)}`);
      },
    );
  }

  function onImportFile(event: ChangeEvent<HTMLInputElement>): void {
    const file = event.target.files?.[0];
    if (file === undefined) {
      return;
    }
    void readFileText(file)
      .then((text) => importDocument(JSON.parse(text)))
      .then((summary: ImportSummaryView) => {
        setImportOutcome(
          `imported ${summary.people} people · ${summary.turns} turns · ${summary.charts} charts · ${summary.loreNodes} lore nodes`,
        );
      })
      .catch((error: unknown) => {
        setImportOutcome(`import failed — ${detailOf(error)}`);
      });
  }

  function requestDestroy(): void {
    setDeleteOutcome(undefined);
    void destroyEverything(
      () =>
        new Promise<boolean>((resolve) => {
          // Function argument = state updater; it stores the plate's resolver.
          setConfirmResolve(() => resolve);
        }),
    ).then(
      (report) => {
        setConfirmResolve(undefined);
        setDeleteOutcome(describeDestroy(report));
      },
      (error: unknown) => {
        setConfirmResolve(undefined);
        setDeleteOutcome(`delete failed — ${detailOf(error)}`);
      },
    );
  }

  function answerDestroy(choice: boolean): void {
    const resolve = confirmResolve;
    setConfirmResolve(undefined);
    resolve?.(choice);
  }

  const storageUsed = rows
    .filter((row) => row.state === "present")
    .reduce((sum, row) => sum + row.bytesTotal, 0);
  const modelState =
    rows.length === 0
      ? "absent"
      : rows.some((row) => row.state === "downloading")
        ? "downloading"
        : "present";

  return (
    <div
      data-screen="settings"
      data-variant={desktop ? "web" : "mobile"}
      className="flex min-h-dvh flex-col bg-[var(--color-midnight)] text-[var(--color-vellum)]"
    >
      <TopBar
        chip={
          <Chip data-testid="license-chip" active={isLicensed}>
            {isLicensed ? "Unlimited" : "Trial"}
          </Chip>
        }
      />
      <main
        className={
          desktop
            ? "mx-auto flex w-full max-w-[1280px] flex-1 flex-col gap-6 px-6 py-4"
            : "flex flex-1 flex-col gap-6 px-4 py-4"
        }
      >
        {/* 1 · House system — the 12 engine codes (§6), chips per TOKENS. */}
        <Section id="house-system" title="House system">
          <div className="flex flex-wrap gap-2">
            {HOUSE_SYSTEMS.map((code) => (
              <button
                key={code}
                type="button"
                data-testid="house-chip"
                data-system={code}
                onClick={() => {
                  onHouseSystemChange(code);
                }}
                className={CHIP_TARGET}
              >
                <Chip active={houseSystem === code}>{HOUSE_SYSTEM_NAMES[code]}</Chip>
              </button>
            ))}
          </div>
        </Section>

        {/* 2 · Model — catalogue rows (M.1), real progress, storage, remove. */}
        <Section id="model" title="Model" state={modelState}>
          {rows.length === 0 ? (
            <p data-absence="model-absent" className={`m-0 ${ASIDE}`}>
              no models on this device yet.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {rows.map((row) => (
                <ModelRow
                  key={row.asset.id}
                  row={row}
                  locked={!isLicensed && row.asset.trialEligible !== true}
                  onRemove={() => {
                    void catalogue.remove(row.asset.id);
                  }}
                  onUnlock={onUnlock}
                />
              ))}
            </div>
          )}
          <p data-testid="storage-used" data-provenance="computed" className={MONO_MUTED}>
            storage used · {formatBytes(storageUsed)}
          </p>
        </Section>

        {/* 3 · Voice — Kokoro picker, preview, mute (§10; identical on web). */}
        <Section id="voice" title="Voice">
          {voices.length === 0 ? (
            <p data-absence="voices-absent" className={`m-0 ${ASIDE}`}>
              no Kokoro voices on this device yet.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {voices.map((voice) => (
                <button
                  key={voice.id}
                  type="button"
                  data-testid="voice-option"
                  data-voice-id={voice.id}
                  data-selected={voiceId === voice.id ? "true" : "false"}
                  onClick={() => {
                    onVoiceSelect(voice.id);
                  }}
                  className={CHIP_TARGET}
                >
                  <Chip active={voiceId === voice.id}>{voice.name}</Chip>
                </button>
              ))}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              data-testid="voice-preview"
              disabled={voiceId === undefined}
              onClick={() => {
                if (voiceId !== undefined) {
                  onPreview(voiceId);
                }
              }}
            >
              Preview
            </Button>
            <Button
              variant="secondary"
              data-testid="voice-mute"
              data-muted={muted ? "true" : "false"}
              onClick={() => {
                onMuteToggle(!muted);
              }}
            >
              {muted ? "Unmute her voice" : "Mute her voice"}
            </Button>
          </div>
        </Section>

        {/* 4 · License — §9.1/§9.3 status, Restore (B.5c), Enter a code. */}
        <Section id="license" title="License" state={isLicensed ? "licensed" : "trial"}>
          <p
            data-testid="license-status"
            data-provenance="computed"
            className={`m-0 ${MONO_INLINE}`}
          >
            {isLicensed ? "[unlimited]" : trialStatusLine(gate)}
          </p>
          {isLicensed && tokenPayload !== undefined ? (
            <p data-testid="license-unlocked" data-provenance="computed" className={MONO_MUTED}>
              unlocked {formatDate(tokenPayload.iat)}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" data-testid="restore" onClick={runRestore}>
              Restore purchases
            </Button>
            <Button
              variant="quiet"
              data-testid="enter-code"
              onClick={() => {
                onEnterCode();
              }}
            >
              Enter a code
            </Button>
          </div>
          {restore !== undefined ? (
            <p data-testid="restore-outcome" data-provenance="computed" className={MONO_MUTED}>
              {restore.status === "restored"
                ? "purchases restored"
                : restore.status === "absent"
                  ? "no purchases found on this device"
                  : `restore failed${restore.detail === undefined ? "" : ` — ${restore.detail}`}`}
            </p>
          ) : null}
        </Section>

        {/* 5 · Data — export (J8), import, delete everything, Lore (§8.4). */}
        <Section id="data" title="Data">
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" data-testid="export" onClick={runExport}>
              Export everything
            </Button>
            <Button variant="secondary" data-testid="delete-everything" onClick={requestDestroy}>
              Delete everything
            </Button>
          </div>
          <p data-provenance="computed" className={MONO_MUTED}>
            the export is plaintext JSON — yours to keep
          </p>
          <label
            className={`flex items-center gap-2 text-[var(--color-vellum-muted)] ${MONO_MICRO}`}
          >
            <span>Import a JSON export</span>
            <input
              type="file"
              accept="application/json,.json"
              data-testid="import"
              onChange={onImportFile}
            />
          </label>
          <div className="flex flex-col gap-1">
            <p data-testid="lore-label" className={MONO_MUTED}>
              Lore · what she remembers
            </p>
            {stats === undefined ? (
              <p data-absence="lore-stats-unavailable" className={MONO_MUTED}>
                lore memory not yet read
              </p>
            ) : (
              <p data-testid="lore-line" data-provenance="computed" className={MONO_MUTED}>
                [{stats.turns} · {stats.nodes} · {stats.runtime}]
              </p>
            )}
            <p className={`m-0 ${ASIDE}`}>Delete everything removes her memory of you, too.</p>
          </div>
          {exportOutcome !== undefined ? (
            <p data-testid="export-outcome" data-provenance="computed" className={MONO_MUTED}>
              {exportOutcome}
            </p>
          ) : null}
          {importOutcome !== undefined ? (
            <p data-testid="import-outcome" data-provenance="computed" className={MONO_MUTED}>
              {importOutcome}
            </p>
          ) : null}
          {deleteOutcome !== undefined ? (
            <p data-testid="delete-outcome" data-provenance="computed" className={MONO_MUTED}>
              {deleteOutcome}
            </p>
          ) : null}
          {confirmResolve !== undefined ? (
            <div
              data-testid="delete-confirm"
              className="flex flex-col gap-2 rounded-[var(--radius-plate)] border-[length:var(--stroke-hairline)] border-[color:var(--color-ember)] bg-[var(--color-midnight-2)] p-4"
            >
              <p className={`m-0 ${ASIDE}`}>
                This deletes every person, session, turn, chart, and lore memory on this device,
                plus downloaded models and the license token. It cannot be undone.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  data-testid="delete-confirm-yes"
                  onClick={() => {
                    answerDestroy(true);
                  }}
                >
                  Delete everything
                </Button>
                <Button
                  variant="quiet"
                  data-testid="delete-confirm-no"
                  onClick={() => {
                    answerDestroy(false);
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : null}
        </Section>

        {/* 6 · About — the link to the frozen /about route. */}
        <Section id="about" title="About">
          <Button
            variant="quiet"
            data-testid="about-link"
            onClick={() => {
              onAbout();
            }}
          >
            About natally
          </Button>
        </Section>
      </main>
    </div>
  );
}
