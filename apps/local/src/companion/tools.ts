import {
  type ChartInputs,
  ChartInputsSchema,
  type DomWriteOp,
  DomWriteOpSchema,
  type Turn,
} from "../../../../packages/lore/src/types.js";

type Awaitable<T> = T | Promise<T>;
export type ToolName = "dom.read" | "dom.write" | "chart.open" | "chart.compute" | "lore.recall";

export interface DomReadRequest {
  root?: Element;
  selector?: string;
  depth?: number;
}

export interface DomSnapshotNode {
  role: string;
  name?: string;
  text?: string;
  masked?: true;
  truncated?: true;
  children?: DomSnapshotNode[];
}

export interface DomSnapshot {
  /** DOM text is data, including text that looks like tool instructions. */
  trust: "untrusted-dom";
  root: DomSnapshotNode | null;
}

export interface ConfirmDomWrite {
  source: "companion";
  tool: "dom.write";
  ops: readonly Readonly<DomWriteOp>[];
}

export interface ToolDependencies<ChartResult = unknown, RecallResult = unknown> {
  /** Trusted host document. Neither frames nor foreign documents are traversed. */
  document: Document;
  sessionId: string;
  personId?: string;
  /** X.1 adapter: persist in the real store; rejection must propagate. */
  appendTurn: (turn: Turn) => Awaitable<void>;
  /** Feed the persisted turn into the local lore pipeline, including failed calls. */
  ingestTurn: (turn: Turn) => Awaitable<void>;
  /** Render the same confirmation plate used by UI actions; never auto-approve. */
  requestConfirm: (request: ConfirmDomWrite) => Awaitable<boolean>;
  /** Resolve a chart ID through the app router, never as a URL. */
  openChart: (chartId: string) => Awaitable<void>;
  /** P.4 adapter through the P.3 local host. */
  computeChart: (inputs: ChartInputs) => Awaitable<ChartResult>;
  /** L.4 local recall adapter. */
  recallLore: (query: string, limit: number) => Awaitable<RecallResult>;
  createTurnId?: () => string;
  now?: () => number;
}

export class ToolError extends Error {
  constructor(public readonly code: string) {
    super(`Companion tool: ${code}`);
    this.name = "ToolError";
  }
}

const MASK = "[masked]";
const HTML_NS = "http://www.w3.org/1999/xhtml";
const MAX_DEPTH = 8;
const MAX_NODES = 256;
const MAX_TEXT = 512;
const FORM_TAGS = new Set(["input", "textarea", "select", "option", "output"]);
const INERT_EXCLUSIONS = new Set([
  "script",
  "style",
  "iframe",
  "frame",
  "object",
  "embed",
  "link",
  "meta",
  "base",
  "template",
  "noscript",
]);
const WRITE_TAGS = new Set([
  "a",
  "article",
  "aside",
  "b",
  "blockquote",
  "button",
  "caption",
  "code",
  "dd",
  "details",
  "div",
  "dl",
  "dt",
  "em",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "form",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "i",
  "img",
  "label",
  "legend",
  "li",
  "main",
  "nav",
  "ol",
  "p",
  "pre",
  "section",
  "small",
  "span",
  "strong",
  "summary",
  "table",
  "tbody",
  "td",
  "th",
  "thead",
  "tr",
  "ul",
]);
const SAFE_ATTRIBUTES = new Set([
  "title",
  "aria-label",
  "aria-description",
  "aria-expanded",
  "aria-selected",
  "aria-pressed",
  "aria-current",
  "aria-checked",
  "aria-valuetext",
]);
const ROLES: Readonly<Record<string, string>> = {
  a: "link",
  button: "button",
  img: "img",
  nav: "navigation",
  main: "main",
  aside: "complementary",
  article: "article",
  section: "region",
  ul: "list",
  ol: "list",
  li: "listitem",
  table: "table",
  tr: "row",
  td: "cell",
  th: "columnheader",
  h1: "heading",
  h2: "heading",
  h3: "heading",
  h4: "heading",
  h5: "heading",
  h6: "heading",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sensitive(element: Element): boolean {
  if (FORM_TAGS.has(element.localName) || element.hasAttribute("contenteditable")) return true;
  for (const attribute of element.attributes) {
    if (/^data-(?:secret|keychain)(?:-|$)/i.test(attribute.name)) return true;
  }
  return ["id", "name", "autocomplete", "data-field"].some((name) =>
    /password|passwd|secret|keychain|credential|token|api[-_]?key|private[-_]?key|one-time-code/i.test(
      element.getAttribute(name) ?? "",
    ),
  );
}

function hasSensitiveAncestor(element: Element): boolean {
  for (let current: Element | null = element; current; current = current.parentElement) {
    if (sensitive(current)) return true;
  }
  return false;
}

function excluded(element: Element): boolean {
  return element.namespaceURI !== HTML_NS || INERT_EXCLUSIONS.has(element.localName);
}

function activeElement(element: Element): boolean {
  return excluded(element) || element.localName.includes("-") || element.hasAttribute("is");
}

function omittedFromSnapshot(element: Element): boolean {
  for (let current: Element | null = element; current; current = current.parentElement) {
    if (
      excluded(current) ||
      current.hasAttribute("hidden") ||
      current.getAttribute("aria-hidden") === "true"
    )
      return true;
  }
  return false;
}

/** Never serialize attributes wholesale or aggregate text across a sensitive subtree. */
function secretRedactor(document: Document): (text: string) => string {
  const secrets = new Set<string>();
  for (const element of document.querySelectorAll("*")) {
    if (!hasSensitiveAncestor(element)) continue;
    const attributeValue = element.getAttribute("value");
    if (attributeValue) secrets.add(attributeValue);
    if (FORM_TAGS.has(element.localName)) {
      const value = (element as HTMLInputElement).value;
      if (typeof value === "string" && value) secrets.add(value);
    }
    if (element.textContent) secrets.add(element.textContent);
  }
  const values = [...secrets].sort((a, b) => b.length - a.length);
  return (text) => {
    let result = text;
    for (const value of values) result = result.replaceAll(value, MASK);
    return result;
  };
}

function readDom(document: Document, request: DomReadRequest): DomSnapshot {
  if (typeof request !== "object" || request === null || Array.isArray(request))
    throw new ToolError("invalid-read");
  const depth = request.depth ?? 4;
  if (!Number.isInteger(depth) || depth < 0 || depth > MAX_DEPTH)
    throw new ToolError("invalid-depth");
  const scope = request.root ?? document.body;
  if (!scope || scope.ownerDocument !== document || !document.documentElement.contains(scope)) {
    throw new ToolError("foreign-or-detached-root");
  }
  let root = scope;
  if (request.selector !== undefined) {
    if (
      typeof request.selector !== "string" ||
      !request.selector.trim() ||
      request.selector.length > 2048
    ) {
      throw new ToolError("invalid-selector");
    }
    const selected = scope.matches(request.selector)
      ? scope
      : scope.querySelector(request.selector);
    if (!selected) return { trust: "untrusted-dom", root: null };
    root = selected;
  }
  const redact = secretRedactor(document);
  let remaining = MAX_NODES;
  function visit(element: Element, level: number): DomSnapshotNode | null {
    if (omittedFromSnapshot(element)) return null;
    if (remaining <= 0) return null;
    remaining -= 1;
    if (hasSensitiveAncestor(element)) return { role: "redacted", text: MASK, masked: true };
    const role = element.getAttribute("role");
    const implicitRole = Object.hasOwn(ROLES, element.localName)
      ? ROLES[element.localName]
      : "generic";
    const node: DomSnapshotNode = {
      role: role && /^[a-z]+$/.test(role) ? redact(role) : (implicitRole ?? "generic"),
    };
    const label =
      element.getAttribute("aria-label") ??
      element.getAttribute("alt") ??
      element.getAttribute("title");
    if (label) node.name = redact(label).slice(0, MAX_TEXT);
    const directText = [...element.childNodes]
      .filter((child) => child.nodeType === 3)
      .map((child) => child.nodeValue ?? "")
      .join(" ");
    const text = redact(directText).replace(/\s+/g, " ").trim();
    if (text) node.text = text.slice(0, MAX_TEXT);
    if (level === depth) {
      if (element.children.length) node.truncated = true;
      return node;
    }
    const children: DomSnapshotNode[] = [];
    for (const child of element.children) {
      if (remaining <= 0) {
        node.truncated = true;
        break;
      }
      const snapshot = visit(child, level + 1);
      if (snapshot) children.push(snapshot);
    }
    if (children.length) node.children = children;
    return node;
  }
  return { trust: "untrusted-dom", root: visit(root, 0) };
}

interface PreparedWrite {
  op: Readonly<DomWriteOp>;
  element: HTMLElement;
  attribute?: { name: string; value: string };
}

function prepareWrites(document: Document, ops: readonly DomWriteOp[]): PreparedWrite[] {
  const redact = secretRedactor(document);
  const prepared = ops.map((op): PreparedWrite => {
    if (!op.selector.trim() || op.selector.length > 2048 || op.value.length > 4096)
      throw new ToolError("invalid-write");
    if (redact(op.selector) !== op.selector || redact(op.value) !== op.value)
      throw new ToolError("secret-write");
    const elements = document.querySelectorAll(op.selector);
    if (elements.length !== 1) throw new ToolError("ambiguous-or-missing-target");
    const element = elements[0];
    if (!element || element.ownerDocument !== document || !document.body.contains(element))
      throw new ToolError("foreign-target");
    if (!WRITE_TAGS.has(element.localName) || hasSensitiveAncestor(element))
      throw new ToolError("unsafe-target");
    for (let current: Element | null = element; current; current = current.parentElement) {
      if (activeElement(current)) throw new ToolError("unsafe-target");
    }
    const result: PreparedWrite = { op, element: element as HTMLElement };
    switch (op.op) {
      case "setattr": {
        // DomWriteOp has one string payload: setattr uses JSON {name, value}.
        let parsed: unknown;
        try {
          parsed = JSON.parse(op.value);
        } catch {
          throw new ToolError("invalid-attribute");
        }
        if (
          !isRecord(parsed) ||
          Object.keys(parsed).length !== 2 ||
          typeof parsed.name !== "string" ||
          typeof parsed.value !== "string" ||
          !SAFE_ATTRIBUTES.has(parsed.name)
        ) {
          throw new ToolError("unsafe-attribute");
        }
        if (redact(parsed.value) !== parsed.value) throw new ToolError("secret-write");
        result.attribute = { name: parsed.name, value: parsed.value };
        break;
      }
      case "text":
        if (
          [...element.querySelectorAll("*")].some(
            (child) => sensitive(child) || activeElement(child),
          )
        )
          throw new ToolError("unsafe-target");
        break;
      case "class":
        if (
          op.value &&
          !/^-?[_a-zA-Z][_a-zA-Z0-9-]*(?: +-?[_a-zA-Z][_a-zA-Z0-9-]*)*$/.test(op.value)
        )
          throw new ToolError("invalid-class");
        break;
      case "focus":
      case "scroll":
        if (op.value !== "") throw new ToolError("invalid-write");
        if (typeof result.element[op.op === "focus" ? "focus" : "scrollIntoView"] !== "function")
          throw new ToolError("unsupported-operation");
        break;
    }
    return result;
  });
  for (const write of prepared) {
    if (
      write.op.op === "text" &&
      prepared.some(
        (other) => other.element !== write.element && write.element.contains(other.element),
      )
    ) {
      throw new ToolError("overlapping-targets");
    }
  }
  return prepared;
}

function applyWrite(write: PreparedWrite): void {
  switch (write.op.op) {
    case "setattr":
      if (write.attribute) write.element.setAttribute(write.attribute.name, write.attribute.value);
      break;
    case "text":
      write.element.textContent = write.op.value;
      break;
    case "class":
      write.element.setAttribute("class", write.op.value);
      break;
    case "focus":
      write.element.focus();
      break;
    case "scroll":
      write.element.scrollIntoView({ block: "nearest" });
      break;
  }
}

/** All five entry points share the durable tool-turn and lore ingestion boundary. */
export function createToolSuite<ChartResult = unknown, RecallResult = unknown>(
  dependencies: ToolDependencies<ChartResult, RecallResult>,
) {
  const {
    document,
    sessionId,
    personId,
    appendTurn,
    ingestTurn,
    requestConfirm,
    openChart,
    computeChart,
    recallLore,
  } = dependencies;
  const now = dependencies.now ?? Date.now;
  const createTurnId = dependencies.createTurnId ?? (() => crypto.randomUUID());

  async function invoke<T>(
    name: ToolName,
    action: (applied: DomWriteOp[]) => Awaitable<T>,
  ): Promise<T> {
    const applied: DomWriteOp[] = [];
    let outcome = "completed";
    try {
      return await action(applied);
    } catch (error) {
      outcome = "failed";
      // Never echo selectors, DOM text, callback error messages, or argument values.
      throw new ToolError(error instanceof ToolError ? error.code : "operation-failed");
    } finally {
      const turn: Turn = {
        id: createTurnId(),
        sessionId,
        role: "tool",
        ts: now(),
        ...(personId === undefined ? {} : { personId }),
        text: `${name}: ${outcome}`,
        toolOps: applied.map((op) => ({ ...op })),
      };
      // A storage or ingestion failure rejects the invocation; it cannot report success.
      // Separate copies keep adapter mutation from changing the subsequent pipeline input.
      await appendTurn(structuredClone(turn));
      await ingestTurn(structuredClone(turn));
    }
  }

  return Object.freeze({
    "dom.read": (request: DomReadRequest = {}) =>
      invoke("dom.read", () => readDom(document, request)),
    "dom.write": (ops: readonly DomWriteOp[]) =>
      invoke("dom.write", async (applied) => {
        if (!Array.isArray(ops) || ops.length === 0 || ops.length > 64)
          throw new ToolError("invalid-write");
        const validated = ops.map((op) => {
          const parsed = DomWriteOpSchema.safeParse(op);
          if (!parsed.success) throw new ToolError("invalid-write");
          return Object.freeze(parsed.data);
        });
        const frozen = Object.freeze(validated);
        const before = prepareWrites(document, frozen);
        if (
          (await requestConfirm(
            Object.freeze({ source: "companion", tool: "dom.write", ops: frozen }),
          )) !== true
        ) {
          throw new ToolError("confirmation-declined");
        }
        const after = prepareWrites(document, frozen);
        if (after.some((write, index) => write.element !== before[index]?.element))
          throw new ToolError("target-changed");
        for (const write of after) {
          // Focus handlers can synchronously replace later targets or mark them secret.
          const current = prepareWrites(document, [write.op])[0];
          if (!current || current.element !== write.element) throw new ToolError("target-changed");
          applyWrite(current);
          applied.push({ ...write.op });
        }
        return { applied: applied.length };
      }),
    "chart.open": (chartId: string) =>
      invoke("chart.open", async () => {
        if (typeof chartId !== "string" || !/^[a-zA-Z0-9_-]{1,256}$/.test(chartId))
          throw new ToolError("invalid-chart-id");
        await openChart(chartId);
      }),
    "chart.compute": (inputs: ChartInputs) =>
      invoke("chart.compute", () => {
        const parsed = ChartInputsSchema.safeParse(inputs);
        if (!parsed.success) throw new ToolError("invalid-chart-inputs");
        return computeChart(parsed.data);
      }),
    "lore.recall": (query: string, limit = 5) =>
      invoke("lore.recall", () => {
        if (
          typeof query !== "string" ||
          !query.trim() ||
          query.length > 4096 ||
          !Number.isInteger(limit) ||
          limit < 1 ||
          limit > 50
        )
          throw new ToolError("invalid-recall");
        return recallLore(query, limit);
      }),
  });
}

export type ToolSuite<ChartResult = unknown, RecallResult = unknown> = ReturnType<
  typeof createToolSuite<ChartResult, RecallResult>
>;
