// @vitest-environment jsdom
// natally — C.3 tool suite tests (ARCHITECTURE §7.3, TEST_RUBRIC TR-9).
// jsdom for the live-DOM legs (per-file pragma; apps/local default env is node).
// The no-network leg greps the FILE TEXT of src/companion/tools.ts — by-construction
// proof that the tool suite imports and references no network primitive.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { DomWriteOp, Turn } from "@natally/lore/types";
import { expect, test } from "vitest";
import { type CompanionToolDeps, createCompanionTools, type DomSnapshotNode } from "./tools";

/** Stub deps: confirm-allow default, in-memory turn sink (stands in for the X.1 repo + lore sink). */
const makeDeps = (overrides: Partial<CompanionToolDeps> = {}) => {
  const turns: Turn[] = [];
  const deps: CompanionToolDeps = {
    requestConfirm: async () => true,
    appendToolTurn: (turn) => {
      turns.push(turn);
    },
    sessionId: "sess-tools-test",
    ...overrides,
  };
  return { deps, turns };
};

const flatten = (node: DomSnapshotNode): DomSnapshotNode[] => [
  node,
  ...(node.children ?? []).flatMap(flatten),
];

test("tools: read masks secrets, write records turn, no-network grep clean", async () => {
  // --- dom.read masks secrets -------------------------------------------
  document.body.innerHTML = `
    <form id="license-form">
      <input id="pw" type="password" value="hunter2" aria-label="License key">
      <input id="cc" autocomplete="cc-number" value="4111111111111111" aria-label="Card">
      <div data-secret><span>TOPSECRET</span></div>
      <input id="plain" value="Robin" aria-label="Display name">
      <p id="note">sky notes</p>
    </form>`;
  const { deps, turns } = makeDeps();
  const { runTool } = createCompanionTools(deps);

  const read = await runTool({ tool: "dom.read", selector: "#license-form", depth: 6 });
  expect(read.tool).toBe("dom.read");
  if (read.tool !== "dom.read" || read.snapshot === null) throw new Error("expected a snapshot");
  const json = JSON.stringify(read.snapshot);
  expect(json).not.toContain("hunter2");
  expect(json).not.toContain("4111111111111111");
  expect(json).not.toContain("TOPSECRET");
  expect(json).toContain("•••");
  expect(json).toContain("sky notes"); // mundane text survives

  const nodes = flatten(read.snapshot);
  const passwordNode = nodes.find((n) => n.name === "License key");
  expect(passwordNode?.masked).toBe(true);
  const cardNode = nodes.find((n) => n.name === "Card");
  expect(cardNode?.masked).toBe(true); // autocomplete cc-* keychain hint
  const secretSubtree = nodes.find((n) => n.role === "span");
  expect(secretSubtree?.masked).toBe(true); // data-secret masks descendants too
  const plainNode = nodes.find((n) => n.name === "Display name");
  expect(plainNode?.text).toBe("•••"); // every input value masked, secret or not
  expect(turns).toHaveLength(1); // every invocation appends a tool turn
  expect(turns[0]?.role).toBe("tool");

  // --- dom.read honors the depth cap ------------------------------------
  document.body.innerHTML =
    '<div id="l0"><div><div><div><div><div id="bottom">BOTTOMTEXT</div></div></div></div></div></div>';
  const capped = await runTool({ tool: "dom.read", selector: "#l0", depth: 2 });
  if (capped.tool !== "dom.read" || capped.snapshot === null)
    throw new Error("expected a snapshot");
  const cappedJson = JSON.stringify(capped.snapshot);
  expect(cappedJson).not.toContain("BOTTOMTEXT"); // below the cap, never walked
  expect(turns).toHaveLength(2);

  // --- dom.write: confirm-deny ⇒ no DOM change, turn still recorded ------
  document.body.innerHTML = '<p id="target">before</p>';
  const denyOps: DomWriteOp[] = [{ selector: "#target", op: "text", value: "after" }];
  let confirmPrompt = "";
  const { deps: denyDeps, turns: denyTurns } = makeDeps({
    requestConfirm: async (description) => {
      confirmPrompt = description;
      return false;
    },
  });
  const denied = await createCompanionTools(denyDeps).runTool({ tool: "dom.write", ops: denyOps });
  expect(document.getElementById("target")?.textContent).toBe("before"); // no write
  expect(confirmPrompt).toContain("dom.write"); // the same confirm affordance UI uses
  expect(denied).toMatchObject({ tool: "dom.write", denied: true, applied: 0 });
  expect(denyTurns).toHaveLength(1); // unconditional append, even on deny
  expect(denyTurns[0]?.role).toBe("tool");
  expect(denyTurns[0]?.toolOps).toEqual(denyOps);
  expect(denyTurns[0]?.text).toContain("denied");

  // --- dom.write: confirm-allow ⇒ ops applied, turn recorded -------------
  document.body.innerHTML = '<p id="target">before</p><p id="other">untouched</p>';
  const allowOps: DomWriteOp[] = [
    { selector: "#target", op: "text", value: "after" },
    { selector: "#target", op: "setattr", value: "data-kind=revised" },
    { selector: "#target", op: "class", value: "applied extra" },
    { selector: "#target", op: "focus", value: "" },
    { selector: "#nope", op: "text", value: "x" }, // selector miss → recorded failure
  ];
  const { deps: allowDeps, turns: allowTurns } = makeDeps();
  const applied = await createCompanionTools(allowDeps).runTool({
    tool: "dom.write",
    ops: allowOps,
  });
  const target = document.getElementById("target");
  expect(target?.textContent).toBe("after");
  expect(target?.getAttribute("data-kind")).toBe("revised");
  expect(target?.classList.contains("applied")).toBe(true);
  expect(document.getElementById("other")?.textContent).toBe("untouched");
  expect(applied).toMatchObject({ tool: "dom.write", denied: false, applied: 4, failed: 1 });
  expect(allowTurns).toHaveLength(1);
  expect(allowTurns[0]?.toolOps).toEqual(allowOps);
  expect(allowTurns[0]?.text).toContain("4/5");

  // --- delegated tools record turns; unwired tools record honest absence -
  const presented: string[] = [];
  const { deps: wiredDeps, turns: wiredTurns } = makeDeps({
    presentPlate: (plateId) => {
      presented.push(plateId);
    },
    computeChart: async (query) => ({ id: "chart-1", personIds: query.personIds }),
    recall: async (query) => [{ sourceTurnId: "turn-9", summary: `about ${query}` }],
  });
  const wired = createCompanionTools(wiredDeps).runTool;
  const plate = await wired({ tool: "chart.open", plateId: "natal-main" });
  expect(plate).toMatchObject({ tool: "chart.open", presented: true });
  expect(presented).toEqual(["natal-main"]);

  const computed = await wired({
    tool: "chart.compute",
    query: { personIds: ["p1"], ut: "2000-01-01T12:00:00Z", place: { lat: 52.52, lon: 13.4 } },
  });
  if (computed.tool !== "chart.compute") throw new Error("expected chart.compute result");
  expect(computed.facts?.id).toBe("chart-1"); // facts flow through from the host

  const recalled = await wired({ tool: "lore.recall", query: "sister", personId: "p1" });
  if (recalled.tool !== "lore.recall") throw new Error("expected lore.recall result");
  expect(recalled.fragments).toEqual([{ sourceTurnId: "turn-9", summary: "about sister" }]);

  expect(wiredTurns).toHaveLength(3);
  expect(wiredTurns.every((t) => t.role === "tool")).toBe(true);
  expect(wiredTurns[1]?.text).toContain("chart-1");
  expect(wiredTurns[2]?.text).toContain("for p1");

  const { deps: bareDeps, turns: bareTurns } = makeDeps();
  await createCompanionTools(bareDeps).runTool({ tool: "lore.recall", query: "x" });
  expect(bareTurns).toHaveLength(1); // honest absence is still a recorded tool turn
  expect(bareTurns[0]?.text).toContain("unavailable");

  // --- no-network by construction (TR-9) ---------------------------------
  // (jsdom's import.meta.url is an http-scheme URL, so anchor on the real dir.)
  const dir = import.meta.dirname ?? process.cwd();
  const source = readFileSync(resolve(dir, "tools.ts"), "utf8");
  expect(/fetch|WebSocket|open\(/.exec(source)).toBeNull();
});
