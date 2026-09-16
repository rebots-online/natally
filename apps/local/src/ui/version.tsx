// natally — the version stamp (U.1, TOKENS.md `data/micro`, DESIGN.md
// "Accessibility floor": the version stamp is selectable). Bottom-right on
// every surface; the shell mounts it outside the routed component so no
// screen can omit it.
//
// Version source, chosen and documented: a direct `version.json` import
// (resolveJsonModule is on in tsconfig.base.json; Vite inlines JSON in dev,
// build and vitest alike). This beats a `__NATALLY_VERSION__` define — it
// needs no vite.config change (not owned by this task), no `import.meta.env`
// typing, and the stamp cannot drift from the stamped artifact version.
// `data/micro` = IBM Plex Mono Regular 11/14 — the one sanctioned sub-12px
// text (the 12px floor applies to "any other text").

import type { ReactElement } from "react";
import versionJson from "../../../../version.json";

export const NATALLY_VERSION: string = versionJson.version;

export type VersionStampProps = {
  /** Override for tests; production renders the stamped artifact version. */
  readonly version?: string;
};

export function VersionStamp({ version = NATALLY_VERSION }: VersionStampProps): ReactElement {
  return (
    <span
      // `data/micro` wiring: the frozen text style carried as data so tests
      // and future CSS can key off it without a second navigation-ish system.
      data-micro="version"
      className="pointer-events-auto fixed right-2 bottom-1 z-50 font-mono text-[11px] leading-[14px] text-[color:var(--color-vellum-muted)] select-text"
    >
      {version}
    </span>
  );
}
