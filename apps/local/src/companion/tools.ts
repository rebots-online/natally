// natally — companion tool suite (ARCHITECTURE §7.3, standard full DOM read/write). C.3.
//
// Injected deps are structural seams bound by C-phase wiring:
//   - requestConfirm renders the same confirm plate UI actions use; dom.write batches
//     are gated behind it (deny ⇒ no DOM change, but the turn is still recorded).
//   - appendToolTurn lands every invocation as a Turn(role="tool") in the X.1
//     transcript repo, which also feeds the lore pipeline (§8.3 write-every-turn).
//     The append is unconditional — deny, failure, and honest absence all record.
//   - presentPlate / computeChart / recall delegate to the P.4 chart host and the
//     L.4 lore retrieval (their real types are structurally assignable to the
//     minimal slices declared here).
//   - sessionId / turnId / now exist so this module can build complete Turn objects
//     (§5) before handing them to appendToolTurn; wiring supplies X.1's active
//     session and id source.
//
// §7.3 law encoded here: snapshots mask input values, [data-secret] material and
// keychain-style fields at the bridge (never serialized raw); tools have no network
// access — this module has zero runtime imports and must stay clean under the TR-9
// banned-token grep (enforced by tools.test.ts against this file's text).
import type { DomWriteOp, GeoPlace, Turn } from "@natally/lore/types";

// ---------------------------------------------------------------------------
// Contracts (§7.3 CompanionTool union, verbatim shape)
// ---------------------------------------------------------------------------

/** §7.3 tool union — the companion's entire actuator surface. */
export type CompanionTool =
  | { tool: "dom.read"; selector: string; depth?: number }
  | { tool: "dom.write"; ops: DomWriteOp[] }
  | { tool: "chart.open"; plateId: string }
  | { tool: "chart.compute"; query: ComputeQuery }
  | { tool: "lore.recall"; query: string; personId?: string };

/**
 * Chart computation request (§6/§7.3 `ComputeQuery`): ChartInputs (§5) minus the
 * content-addressed id, which the chart host assigns to the produced ChartFacts.
 */
export interface ComputeQuery {
  personIds: string[];
  /** Universal Time instant, ISO-8601 UTC. */
  ut: string;
  place: GeoPlace;
}

/**
 * Minimal structural slice of §5 ChartFacts. The P.4 host's full type (positions,
 * cusps, aspects) is assignable; this suite only records identity/provenance in the
 * tool turn and passes the object through untouched — facts come from the
 * EphemerisEngine only (Tier 1, §7.2).
 */
export interface ChartFacts {
  readonly id: string;
  readonly personIds: readonly string[];
}

/** Minimal structural slice of an §8.4 lore retrieval fragment (L.4). */
export interface LoreFragment {
  readonly sourceTurnId: string;
  readonly summary: string;
}

/** Structural deps — wiring (C-phase) binds the real transcript/lore/chart seams. */
export interface CompanionToolDeps {
  /** Confirm affordance (the real confirm plate). Resolves false ⇒ deny. */
  requestConfirm: (description: string) => Promise<boolean>;
  /** Transcript + lore sink (X.1 repo; lore pipeline ingests every turn, §8.3). */
  appendToolTurn: (turn: Turn) => Promise<void> | void;
  /** P.4 chart host: presents a plate by id (§7.3 chart present). */
  presentPlate?: (plateId: string) => void;
  /** P.4 chart host: computes ChartFacts via the EphemerisEngine (§6). */
  computeChart?: (query: ComputeQuery) => Promise<ChartFacts>;
  /** L.4 lore retrieval, person-scoped. */
  recall?: (query: string, personId?: string) => Promise<LoreFragment[]>;
  /** Session the injected tool turns belong to (Turn.sessionId, §5). */
  sessionId: string;
  /** Turn id source; defaults to a factory-local monotonic counter. */
  turnId?: () => string;
  /** Clock; defaults to Date.now. */
  now?: () => number;
}

// ---------------------------------------------------------------------------
// dom.read — accessibility-style masked snapshot
// ---------------------------------------------------------------------------

/** Mask glyph: the ONLY representation a sensitive value may take (§7.3). */
const MASK = "•••";
/** Default traversal depth when the tool call omits one. */
const DEFAULT_READ_DEPTH = 8;

/** One node of the accessibility-style snapshot. Sensitive content is masked here, never serialized. */
export interface DomSnapshotNode {
  /** ARIA role when present, else the lowercase tag name. */
  role: string;
  /** Accessible-name hints: aria-label, placeholder, alt, name attribute. */
  name: string;
  /** Direct text; the mask glyph when the node (or an ancestor) is sensitive. */
  text?: string;
  /** Present exactly when content was masked (§7.3: never serialize raw values). */
  masked?: boolean;
  children?: DomSnapshotNode[];
}

const isFormField = (el: Element): boolean => {
  const tag = el.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select";
};

/**
 * Keychain-style secret hints (§7.3): password inputs and password-manager
 * autofill fields (autocomplete `cc-*` / `current-password`).
 */
const isKeychainField = (el: Element): boolean => {
  if (el.tagName.toLowerCase() !== "input") return false;
  const type = (el.getAttribute("type") ?? "").trim().toLowerCase();
  if (type === "password") return true;
  const autocomplete = (el.getAttribute("autocomplete") ?? "").trim().toLowerCase();
  return autocomplete === "current-password" || autocomplete.startsWith("cc-");
};

const accessibleName = (el: Element): string =>
  el.getAttribute("aria-label") ??
  el.getAttribute("placeholder") ??
  el.getAttribute("alt") ??
  el.getAttribute("name") ??
  "";

/** Text of this element's own text-node children, whitespace-collapsed. */
const directText = (el: Element): string => {
  let out = "";
  for (const child of el.childNodes) {
    if (child.nodeType === 3) out += child.textContent ?? "";
  }
  return out.replace(/\s+/g, " ").trim();
};

const snapshotNode = (
  el: Element,
  depthRemaining: number,
  ancestorMasked: boolean,
): DomSnapshotNode => {
  const selfSensitive = el.hasAttribute("data-secret") || isKeychainField(el);
  const masked = ancestorMasked || selfSensitive;
  const node: DomSnapshotNode = {
    role: el.getAttribute("role") ?? el.tagName.toLowerCase(),
    name: accessibleName(el),
  };
  if (isFormField(el)) {
    // Form values — secret or not — never leave the bridge unmasked (§7.3).
    node.text = MASK;
    node.masked = true;
  } else if (masked) {
    node.text = MASK;
    node.masked = true;
  } else {
    const text = directText(el);
    if (text) node.text = text;
  }
  if (depthRemaining > 0) {
    const children = Array.from(el.children).map((child) =>
      snapshotNode(child, depthRemaining - 1, masked),
    );
    if (children.length > 0) node.children = children;
  }
  return node;
};

const countNodes = (node: DomSnapshotNode): number =>
  1 + (node.children ?? []).reduce((sum, child) => sum + countNodes(child), 0);

// ---------------------------------------------------------------------------
// dom.write — confirm-gated, fully recorded
// ---------------------------------------------------------------------------

/**
 * Applies one write op to the live DOM. Returns an error reason on failure
 * (selector miss, malformed payload, unsupported op on this platform); an empty
 * return means the op was applied. `setattr` encodes its payload as `name=value`
 * (split on the first `=`) — the §7.3 DomWriteOp contract has a single string
 * payload per op.
 */
const applyOp = (op: DomWriteOp): string | undefined => {
  const el = document.querySelector(op.selector);
  if (el === null) return `no match for ${op.selector}`;
  switch (op.op) {
    case "setattr": {
      const eq = op.value.indexOf("=");
      if (eq < 1) return "setattr payload must be name=value";
      el.setAttribute(op.value.slice(0, eq), op.value.slice(eq + 1));
      return undefined;
    }
    case "text":
      el.textContent = op.value;
      return undefined;
    case "class": {
      const tokens = op.value.split(/\s+/).filter(Boolean);
      if (tokens.length === 0) return "class payload must name at least one class";
      el.classList.add(...tokens);
      return undefined;
    }
    case "focus": {
      const focusable = el as HTMLElement;
      if (typeof focusable.focus !== "function") return "focus unsupported here";
      focusable.focus();
      return undefined;
    }
    case "scroll": {
      // jsdom (tests) lacks the scroll primitive; real legs have it. The op is
      // recorded either way — only the platform effect differs.
      if (typeof el.scrollIntoView !== "function") return "scroll unsupported here";
      el.scrollIntoView({ block: "nearest" });
      return undefined;
    }
    default:
      return `unsupported op ${String(op.op)}`;
  }
};

const describeBatch = (ops: DomWriteOp[]): string =>
  ops.map((op) => `${op.op} ${op.selector}`).join("; ");

// ---------------------------------------------------------------------------
// createCompanionTools / runTool
// ---------------------------------------------------------------------------

export type ToolResult =
  | { tool: "dom.read"; matched: boolean; snapshot: DomSnapshotNode | null }
  | { tool: "dom.write"; denied: boolean; applied: number; failed: number }
  | { tool: "chart.open"; presented: boolean }
  | { tool: "chart.compute"; facts: ChartFacts | null }
  | { tool: "lore.recall"; fragments: LoreFragment[] }
  | { tool: "unknown"; reason: string };

const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** Builds the five tool handlers over injected deps. Every invocation records a Turn(role="tool"). */
export const createCompanionTools = (deps: CompanionToolDeps) => {
  let turnSeq = 0;
  /** The append is UNCONDITIONAL (§7.3 no hidden writes): deny, failure and honest absence all record. */
  const record = (text: string, toolOps?: DomWriteOp[]): Promise<void> | void => {
    turnSeq += 1;
    const turn: Turn = {
      id: deps.turnId ? deps.turnId() : `tool-${String(turnSeq).padStart(5, "0")}`,
      sessionId: deps.sessionId,
      role: "tool",
      text,
      ts: deps.now ? deps.now() : Date.now(),
      ...(toolOps === undefined ? {} : { toolOps }),
    };
    return deps.appendToolTurn(turn);
  };

  const runTool = async (tool: CompanionTool): Promise<ToolResult> => {
    switch (tool.tool) {
      case "dom.read": {
        const selector = tool.selector.trim();
        const rootEl = selector ? document.querySelector(selector) : document.body;
        if (rootEl === null) {
          await record(`dom.read: no match for ${tool.selector}`);
          return { tool: "dom.read", matched: false, snapshot: null };
        }
        const depth =
          typeof tool.depth === "number" && Number.isFinite(tool.depth) && tool.depth >= 0
            ? Math.floor(tool.depth)
            : DEFAULT_READ_DEPTH;
        const snapshot = snapshotNode(rootEl, depth, false);
        await record(
          `dom.read: ${countNodes(snapshot)} node(s) from ${selector || "document"} (depth ${depth})`,
        );
        return { tool: "dom.read", matched: true, snapshot };
      }

      case "dom.write": {
        const ops = tool.ops;
        if (ops.length === 0) {
          await record("dom.write: 0 op(s) applied");
          return { tool: "dom.write", denied: false, applied: 0, failed: 0 };
        }
        let confirmed = false;
        try {
          confirmed = await deps.requestConfirm(
            `dom.write: ${ops.length} op(s): ${describeBatch(ops)}`,
          );
        } catch {
          confirmed = false; // a broken confirm plate must never become a silent write
        }
        if (!confirmed) {
          await record(`dom.write denied: ${ops.length} op(s) not applied`, ops);
          return { tool: "dom.write", denied: true, applied: 0, failed: 0 };
        }
        let applied = 0;
        const failures: string[] = [];
        for (const op of ops) {
          const failure = applyOp(op);
          if (failure === undefined) applied += 1;
          else failures.push(`${op.op} ${op.selector}: ${failure}`);
        }
        const failed = ops.length - applied;
        const summary =
          failed === 0
            ? `dom.write: ${applied}/${ops.length} op(s) applied`
            : `dom.write partial: ${applied}/${ops.length} applied; failed — ${failures.join("; ")}`;
        await record(summary, ops);
        return { tool: "dom.write", denied: false, applied, failed };
      }

      case "chart.open": {
        if (!deps.presentPlate) {
          await record("chart.open unavailable: no plate presenter wired");
          return { tool: "chart.open", presented: false };
        }
        deps.presentPlate(tool.plateId);
        await record(`chart.open: presented plate ${tool.plateId}`);
        return { tool: "chart.open", presented: true };
      }

      case "chart.compute": {
        if (!deps.computeChart) {
          await record("chart.compute unavailable: no chart host wired");
          return { tool: "chart.compute", facts: null };
        }
        let facts: ChartFacts;
        try {
          facts = await deps.computeChart(tool.query);
        } catch (err) {
          await record(`chart.compute failed: ${errorMessage(err)}`);
          return { tool: "chart.compute", facts: null };
        }
        await record(
          `chart.compute: chart ${facts.id} for person(s) ${facts.personIds.join(", ")}`,
        );
        return { tool: "chart.compute", facts };
      }

      case "lore.recall": {
        if (!deps.recall) {
          await record("lore.recall unavailable: no lore retrieval wired");
          return { tool: "lore.recall", fragments: [] };
        }
        let fragments: LoreFragment[];
        try {
          fragments = await deps.recall(tool.query, tool.personId);
        } catch (err) {
          await record(`lore.recall failed: ${errorMessage(err)}`);
          return { tool: "lore.recall", fragments: [] };
        }
        const scope = tool.personId === undefined ? "" : ` for ${tool.personId}`;
        await record(`lore.recall: ${fragments.length} fragment(s)${scope}`);
        return { tool: "lore.recall", fragments };
      }

      default:
        await record("tool: unsupported invocation rejected");
        return { tool: "unknown", reason: "unsupported tool" };
    }
  };

  return { runTool };
};
