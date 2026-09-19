// D20/§18.1: both editions consume the same exported UI source; until W3-S2
// (Stitch v2) lands, the shared surface here is @natally/design-tokens only.
// apps/local's screens are NOT imported (§2 dependency rule holds one way).
import { tokens } from "@natally/design-tokens";
import type { ReactNode } from "react";
import type { HostedBilling, HostedInference, HostedSpeech, HostedVoice } from "./seams";

const SEAMS: readonly { name: string; seam: string; type: string }[] = [
  { name: "HostedInference", seam: "seams.ts", type: "HostedInference" },
  { name: "HostedVoice", seam: "seams.ts", type: "HostedVoice" },
  { name: "HostedSpeech", seam: "seams.ts", type: "HostedSpeech" },
  { name: "HostedBilling", seam: "seams.ts", type: "HostedBilling" },
] as const;

/** Minimal placeholder-free shell: title + the four empty typed service seams (D22). */
export function HostedApp(): ReactNode {
  return (
    <main style={{ fontFamily: "sans-serif", padding: tokens["--spacing-6"] }}>
      <h1>natally — hosted edition</h1>
      <p>
        Same exported UI source, server-side services (D22). Shared design tokens loaded:{" "}
        {Object.keys(tokens).length} variables.
      </p>
      <h2>Service seams (empty — H.2–H.4 fill them)</h2>
      <ul>
        {SEAMS.map((entry) => (
          <li key={entry.name}>
            <code>{entry.type}</code> — typed interface only, no implementation.
          </li>
        ))}
      </ul>
    </main>
  );
}
