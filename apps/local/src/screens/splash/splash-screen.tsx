// natally — the splash (U.8). LIBS/UI/FIGMA/screens/screen-splash/SCREEN.md is
// normative: product name, mark, full version string, copyright, and the REAL
// engine-load progress only. ARCHITECTURE.md §12 + INC-19: progress binds to
// the injected SplashEngineEvents seam and nothing else — no timers, no
// fabricated fractions; a state without a pct renders as indeterminate, and
// before the first event there is no progress at all (labelled honest absence).
//
// Ready routing (task spec): on the terminal `ready` event exactly once —
//   countPeople() === 0 ⇒ onFirstLight()   (J1: nobody home yet)
//   countPeople() >= 1  ⇒ onConversation()
// Version is a computed fact (the stamped artifact version, ui/version);
// the wordmark and copyright are authored-static; the load line and any pct
// are computed facts carried verbatim from the last engine event.
//
// Voice/display wordmark (TOKENS.md): Fraunces SemiBold 28/34 on the midnight
// ground, fallback serif until S.1 ships the woff2 (global.css documents the
// same stack). data-variant carries the frozen desktop frame.

import { type ReactElement, useEffect, useState } from "react";
import iconUrl from "../../assets/mascot/natally-icon-1024-rgba.png";
import { NATALLY_VERSION } from "../../ui/version";
import { createSilentEngineEvents, type SplashEngineEvent, type SplashScreenProps } from "./types";

const NOOP = (): void => {};

/** The one navigation system: hash navigation over the frozen route set. */
function navigateConversation(): void {
  window.location.hash = "/";
}

function clampPct(pct: number): number {
  return Math.min(100, Math.max(0, pct));
}

type LoadState = {
  readonly stage: "mounting" | "mounted" | "ready";
  readonly table?: string;
  readonly pct?: number;
};

export function SplashScreen({
  engineEvents = createSilentEngineEvents(),
  countPeople = (): number => 0,
  onFirstLight = NOOP,
  onConversation = navigateConversation,
  variant = "mobile",
  version = NATALLY_VERSION,
}: SplashScreenProps): ReactElement {
  const [load, setLoad] = useState<LoadState | null>(null);

  useEffect(() => {
    let routed = false;
    const unsubscribe = engineEvents.subscribe((event: SplashEngineEvent) => {
      if (event.stage === "ready") {
        setLoad({ stage: "ready" });
        if (!routed) {
          routed = true;
          if (countPeople() === 0) {
            onFirstLight();
          } else {
            onConversation();
          }
        }
        return;
      }
      setLoad({ stage: event.stage, table: event.table, pct: event.pct });
    });
    return unsubscribe;
  }, [engineEvents, countPeople, onFirstLight, onConversation]);

  const ready = load?.stage === "ready";
  const pct = load?.pct;
  const indeterminate = pct === undefined;
  const desktop = variant === "desktop";

  return (
    <div
      data-screen="splash"
      data-variant={variant}
      data-phase={ready ? "ready" : "loading"}
      className={`flex min-h-dvh flex-col items-center justify-center gap-[var(--spacing-4)] bg-[var(--color-midnight)] text-[var(--color-vellum)] ${
        desktop ? "px-[var(--spacing-8)]" : "px-[var(--spacing-4)]"
      }`}
    >
      <img
        data-testid="splash-mark"
        src={iconUrl}
        alt=""
        aria-hidden="true"
        draggable={false}
        width={desktop ? 96 : 72}
        height={desktop ? 96 : 72}
        className="rounded-[var(--radius-plate)]"
      />
      <h1
        data-testid="splash-wordmark"
        className="m-0 font-[family-name:'Fraunces',Georgia,serif] text-[28px] leading-[34px] font-semibold tracking-[0.08em]"
      >
        natally
      </h1>

      {/* Real engine-load progress only. Indeterminate = no width, no valuenow,
          no pct text — never a fake fraction (§12, INC-19). */}
      <div
        data-testid="splash-progress-track"
        className="h-[3px] w-56 overflow-hidden rounded-full bg-[var(--color-hairline)]"
      >
        <div
          role="progressbar"
          aria-label="engine load"
          data-testid="splash-progress"
          data-indeterminate={indeterminate ? "true" : "false"}
          aria-valuenow={indeterminate ? undefined : Math.round(clampPct(pct))}
          aria-valuemin={indeterminate ? undefined : 0}
          aria-valuemax={indeterminate ? undefined : 100}
          style={{ width: indeterminate ? undefined : `${clampPct(pct)}%` }}
          className="h-full bg-[var(--color-gilt)]"
        />
      </div>
      <p
        data-testid="splash-load"
        className="m-0 font-mono text-[12px] leading-[16px] text-[var(--color-vellum-muted)]"
      >
        {load === null ? (
          <span data-absence="engine-silent">waiting for the engine</span>
        ) : load.table === undefined ? (
          load.stage
        ) : (
          `${load.stage} · ${load.table}`
        )}
      </p>
      {/* pct text renders ONLY when the source provided one. */}
      {pct === undefined ? null : (
        <span
          data-testid="splash-pct"
          className="font-mono text-[12px] leading-[16px] text-[var(--color-vellum)]"
        >
          {Math.round(clampPct(pct))}%
        </span>
      )}

      <footer
        className={`flex items-baseline gap-[var(--spacing-4)] ${
          desktop ? "flex-col" : "flex-row"
        }`}
      >
        <span
          data-testid="splash-version"
          data-micro="version"
          className="font-mono text-[11px] leading-[14px] text-[var(--color-vellum-muted)] select-text"
        >
          {version}
        </span>
        <span
          data-testid="splash-copyright"
          className="font-[family-name:'Nunito_Sans',ui-sans-serif,sans-serif] text-[12px] leading-[16px] text-[var(--color-vellum-muted)]"
        >
          © 2026 Robin
        </span>
      </footer>
    </div>
  );
}

export default SplashScreen;
