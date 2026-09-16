// natally — the About screen (U.7). SCREEN.md screen-about is normative:
// product name, full version, versionCode, build date, copyright, the
// license line, provenance of the ephemeris and of Kokoro, and the frozen
// model mirror. Every surface via menu; the menu seam is injected.
//
// FROZEN-SPEC DRIFT, FIXED HERE (documented per the U.7 amendment): the
// frozen SCREEN.md reads "license line (proprietary)", but D9
// (ARCHITECTURE.md §6, AGENTS.md license note) sets the amended law — the
// repo stays AGPL-3.0-or-later for as long as `sweph-wasm` is in the tree,
// and the proprietary flip happens only when an in-house ephemeris successor
// lands. This screen therefore renders AGPL-3.0-or-later and carries the D9
// note line. The "proprietary" wording is the drift, not the truth.
//
// Content classes (INC-19, ARCHITECTURE.md §5): the version block is
// computed-fact material read verbatim from version.json (U.1's version.tsx
// pattern: direct JSON import, resolveJsonModule) and renders in Plex Mono,
// labelled computed; the copyright, license, provenance and D9 lines are
// authored-static and render as labelled sections. No interpretation, no
// scores — an About page states its build and its inputs.

import type { ReactElement, ReactNode } from "react";
import versionJson from "../../../../../version.json";
import { TopBar } from "../../ui/primitives/top-bar";

export type AboutScreenProps = {
  /** Route params; /about is a static route so none are read. */
  readonly params: Readonly<Record<string, string>>;
  /** Injected menu seam (wiring binds it); absent ⇒ the menu renders disabled. */
  readonly onMenu?: () => void;
};

const BODY =
  "font-[family-name:'Nunito_Sans',ui-sans-serif,sans-serif] text-[14px] leading-[20px] text-[var(--color-vellum)]";
const MONO_MICRO =
  "font-[family-name:'IBM_Plex_Mono',ui-monospace,monospace] text-[12px] leading-[16px]";

function SectionHeading({ children }: { readonly children: ReactNode }): ReactElement {
  return (
    <h2 className="m-0 mb-2 font-[family-name:'Fraunces',serif] text-[18px] leading-[24px] font-semibold text-[var(--color-vellum)]">
      {children}
    </h2>
  );
}

/** The authored-static label treatment (ARCHITECTURE.md §5 renderer law). */
function AuthoredLabel(): ReactElement {
  return (
    <span
      data-provenance="authored"
      className={`${MONO_MICRO} uppercase tracking-[0.08em] text-[var(--color-vellum-muted)]`}
    >
      authored
    </span>
  );
}

/** One authored-static section: labelled, then its body lines. */
function AuthoredSection({
  heading,
  testId,
  children,
}: {
  readonly heading: string;
  readonly testId: string;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <section data-testid={testId} className="mt-6">
      <SectionHeading>{heading}</SectionHeading>
      <div className="mb-2">
        <AuthoredLabel />
      </div>
      <div data-provenance="authored" className={BODY}>
        {children}
      </div>
    </section>
  );
}

/** One computed-fact row of the version block (verbatim from version.json). */
function VersionRow({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string;
}): ReactElement {
  return (
    <p className="m-0 mb-1 flex gap-3">
      <span className={`${MONO_MICRO} text-[var(--color-vellum-muted)] w-24 shrink-0`}>
        {label}
      </span>
      <span
        data-provenance="computed"
        className={`${MONO_MICRO} select-text text-[var(--color-vellum)]`}
      >
        {value}
      </span>
    </p>
  );
}

export function AboutScreen({ onMenu }: AboutScreenProps): ReactElement {
  return (
    <div data-testid="about-screen">
      <TopBar onMenu={onMenu} />
      <main className="px-4 pb-10">
        <header className="pt-5">
          <h1 className="m-0 font-[family-name:'Fraunces',serif] text-[28px] leading-[36px] font-semibold text-[var(--color-vellum)]">
            {versionJson.productName}
          </h1>
          <p
            data-testid="about-copyright"
            className={`${MONO_MICRO} m-0 mt-1 text-[var(--color-vellum-muted)]`}
          >
            © 2026 Robin
          </p>
        </header>

        {/* Computed facts (INC-19 class `computed`): read verbatim from the
            stamped version.json — the same import surface U.1's stamp uses,
            so the About page cannot drift from the stamped artifact. */}
        <section data-testid="about-version" data-provenance="computed" className="mt-6">
          <SectionHeading>Version</SectionHeading>
          <VersionRow label="version" value={versionJson.version} />
          <VersionRow label="versionCode" value={String(versionJson.versionCode)} />
          <VersionRow label="build date" value={versionJson.buildDate} />
        </section>

        <AuthoredSection heading="License" testId="about-license">
          <p className="m-0" data-testid="about-license-line">
            AGPL-3.0-or-later
          </p>
          <p className="m-0" data-testid="about-d9-note">
            License note: natally is AGPL-3.0-or-later while Swiss Ephemeris (sweph-wasm) is in the
            tree; when an in-house ephemeris successor replaces it, the license is revisited (D9).
          </p>
        </AuthoredSection>

        <AuthoredSection heading="Provenance" testId="about-provenance">
          <p className="m-0 mb-1" data-testid="about-provenance-ephemeris">
            Ephemeris: Swiss Ephemeris via sweph-wasm — every position, cusp and aspect is computed
            through the pinned engine seam.
          </p>
          <p className="m-0 mb-1" data-testid="about-provenance-voice">
            Voice: Kokoro, on-device — never WebView audio; the web leg runs Kokoro in-browser via
            onnxruntime-web.
          </p>
          <p className="m-0" data-testid="about-provenance-mirror">
            Model mirror: the frozen mirror at RobinsAIWorld/natally-models.
          </p>
        </AuthoredSection>
      </main>
    </div>
  );
}
