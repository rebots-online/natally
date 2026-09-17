// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCompanionBus, type StageSignal } from "../../companion/bus.js";
import { ConversationScreen, ConversationContextChip, type ConversationPlate, type ConversationScreenProps, type ConversationServices, type GateResult, type TrialPolicy, type Turn } from "./index.js";

const sessionId = "conversation-test";
const policy: TrialPolicy = { mode: "count", readings: 3, trialModel: "manifest-model" };
// Scripted data is confined to this jsdom suite. Production has no fixture import or default turns.
const userTurn: Turn = { id: "user-1", sessionId, role: "you", text: "Read the supplied chart.", ts: 100 };
const reply: Turn = { id: "her-1", sessionId, role: "her", text: "Published response from the scripted service.", ts: 102 };
const plate: ConversationPlate = {
  id: "chart-1", sessionId, ts: 101, title: "Natal · Fixture person", provenance: "Placidus · fixture inputs",
  content: [
    { kind: "computed", text: "Sun 12°04′ · H9" },
    { kind: "authored-static", label: "What it is", text: "A house is a division of the chart." },
    { kind: "absence", text: "Birth time is unknown." },
  ],
};
let wide = false;
let mediaListeners: Set<() => void>;
let frames: Map<number, FrameRequestCallback>;
let nextFrame: number;

beforeEach(() => {
  wide = false;
  mediaListeners = new Set();
  frames = new Map();
  nextFrame = 0;
  document.title = "Unrelated shell title";
  vi.stubGlobal("matchMedia", (query: string) => ({
    media: query,
    get matches() { return query === "(min-width: 960px)" ? wide : true; },
    addEventListener: (_name: string, listener: () => void) => mediaListeners.add(listener),
    removeEventListener: (_name: string, listener: () => void) => mediaListeners.delete(listener),
  }));
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.set(++nextFrame, callback); return nextFrame; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function harness(initial: GateResult | null = { state: "licensed" }, present: boolean | null = true) {
  const bus = createCompanionBus();
  if (present !== null) bus.signal({ type: "model-presence", present });
  let gate = initial;
  const accessListeners = new Set<() => void>();
  const services: ConversationServices = {
    bus,
    access: { getSnapshot: () => gate, subscribe: (listener) => { accessListeners.add(listener); return () => { accessListeners.delete(listener); }; } },
    turns: { list: vi.fn(async () => [] as Turn[]) },
    submit: vi.fn(async () => {}),
    plates: { list: vi.fn(async () => [] as ConversationPlate[]), get: vi.fn(async () => plate) },
  };
  const props: ConversationScreenProps = {
    sessionId, services, trialPolicy: policy,
    onUnlock: vi.fn(), onEnterCode: vi.fn(), onOpenPlate: vi.fn(), onRetry: vi.fn(), onDownloadModel: vi.fn(),
    model: { id: "manifest-model", label: "Manifest model", quant: "Q4_K_M", bytes: 123456789 },
  };
  function send(...signals: StageSignal[]) {
    act(() => { for (const signal of signals) {
      if (signal.type === "model-presence" || signal.type === "engine-load" || signal.type === "composer-focus") bus.signal(signal);
      else bus.emit(signal);
    } });
  }
  function setGate(value: GateResult | null, notify = true) {
    gate = value;
    if (notify) act(() => { for (const listener of accessListeners) listener(); });
  }
  return { bus, services, props, send, setGate, accessListeners };
}

async function settled() { await waitFor(() => expect(screen.queryByText("Loading conversation…")).toBeNull()); }
function variant() { return screen.getByRole("region", { name: "Conversation" }).getAttribute("data-conversation-variant"); }
function stageState() { return screen.getByRole("region", { name: "Companion stage" }).getAttribute("data-stage-state"); }
function field() { return screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Ask natally" }); }
function isDisabled(element: HTMLElement) { return (element as HTMLButtonElement).disabled; }
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function frame() {
  act(() => { const callbacks = [...frames.values()]; frames.clear(); for (const callback of callbacks) callback(0); });
}

describe("conversation: 9 variants render against event scripts", () => {
  it("Idle: renders accepted turns, real plate data and provenance with the frozen transcript grammar", async () => {
    const h = harness();
    const { container } = render(<ConversationScreen {...h.props} />);
    await settled();
    expect(screen.getByText("No conversation yet.")).toBeTruthy();
    h.send({ type: "turn", turn: userTurn }, { type: "turn", turn: reply }, { type: "chart-computed", chartId: plate.id });
    await screen.findByRole("button", { name: `Open ${plate.title}` });
    expect(variant()).toBe("Idle");
    expect(stageState()).toBe("Delighted");
    expect(screen.getByText(userTurn.text).classList.contains("ui-turn-you")).toBe(true);
    const generated = screen.getByRole("article", { name: "natally's message" });
    expect(generated.getAttribute("data-provenance")).toBe("generated");
    expect(generated.querySelector(".conversation__glyph svg, svg.conversation__glyph")).not.toBeNull();
    expect(generated.querySelector(".conversation__name")?.textContent).toBe("natally");
    expect(screen.queryByText("Unrelated shell title")).toBeNull();
    expect(screen.getByText("Sun 12°04′ · H9").getAttribute("data-provenance")).toBe("computed");
    expect(screen.getByText("What it is").parentElement?.getAttribute("data-provenance")).toBe("authored-static");
    expect(screen.getByText("Birth time is unknown.").className).toBe("conversation__aside");
    expect(container.querySelector(".ui-plate__provenance")?.textContent).toBe(plate.provenance);
    fireEvent.click(screen.getByRole("button", { name: `Open ${plate.title}` }));
    expect(h.props.onOpenPlate).toHaveBeenCalledWith(plate.id);
    expect([...container.querySelectorAll("[data-turn-id], [data-plate-id]")].map((node) => node.getAttribute("data-turn-id") ?? node.getAttribute("data-plate-id"))).toEqual([userTurn.id, plate.id, reply.id]);
  });

  it("Thinking: shows no reply before produced tokens, then replaces the stream with the published turn", async () => {
    const h = harness();
    render(<ConversationScreen {...h.props} />); await settled();
    h.send({ type: "turn", turn: userTurn });
    expect(variant()).toBe("Thinking"); expect(stageState()).toBe("Thinking");
    expect(screen.queryByRole("article", { name: "natally's message" })).toBeNull();
    expect(screen.getByText("Thinking…")).toBeTruthy();
    h.send({ type: "token", token: "Published " }, { type: "token", token: "words." });
    expect(screen.getByText("Published words.")).toBeTruthy();
    expect(variant()).toBe("Thinking"); expect(stageState()).toBe("Idle");
    expect(screen.getByRole("article", { name: "natally's message" }).getAttribute("aria-busy")).toBe("true");
    h.send({ type: "turn", turn: { ...reply, text: "Published words." } });
    expect(screen.getAllByText("Published words.")).toHaveLength(1);
    expect(variant()).toBe("Idle");
    expect(screen.queryByText("Responding…")).toBeNull();
  });

  it("Speaking: only audio envelope events activate speaking on the real Stage", async () => {
    const h = harness();
    const { container } = render(<ConversationScreen {...h.props} />); await settled();
    h.send({ type: "turn", turn: reply });
    expect(stageState()).toBe("Idle");
    h.send({ type: "envelope-start" }, { type: "envelope-level", level: 0.65 });
    expect(variant()).toBe("Speaking"); expect(stageState()).toBe("Speaking");
    expect(screen.getByText(reply.text)).toBeTruthy();
    expect(container.querySelector("[data-stage-orb]")?.getAttribute("data-envelope")).toBe("0.65");
    h.send({ type: "envelope-end" }); expect(variant()).toBe("Idle");
  });

  it("Asleep: uses observed no-model capability and injected manifest/download without inventing wake success", async () => {
    const h = harness();
    render(<ConversationScreen {...h.props} />); await settled();
    h.send({ type: "model-presence", present: false });
    expect(variant()).toBe("Asleep"); expect(stageState()).toBe("Asleep");
    expect(field().disabled).toBe(true);
    expect(screen.getByText(/Manifest model · Q4_K_M/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Download" }));
    await waitFor(() => expect(h.props.onDownloadModel).toHaveBeenCalledWith("manifest-model"));
    expect(stageState()).toBe("Asleep");
    h.send({ type: "engine-load", fraction: 0.3 }); expect(stageState()).toBe("Waking");
    expect(field().disabled).toBe(true);
    h.send({ type: "engine-load", fraction: 1 }); expect(variant()).toBe("Idle");
  });

  it("Error: preserves repeated real reasons and waits for runtime recovery after Try again", async () => {
    const h = harness();
    const { container } = render(<ConversationScreen {...h.props} />); await settled();
    h.send({ type: "error", message: "Engine failed: missing weights." });
    expect(variant()).toBe("Error"); expect(stageState()).toBe("Error");
    expect(container.querySelector(".conversation__absence-plate--error")?.textContent).toContain("missing weights");
    h.send({ type: "error", message: "Checksum mismatch: model.gguf." });
    expect(screen.getByText("Checksum mismatch: model.gguf.")).toBeTruthy();
    expect(screen.queryByText("Engine failed: missing weights.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(h.props.onRetry).toHaveBeenCalledOnce());
    expect(variant()).toBe("Error");
    h.send({ type: "engine-load", fraction: 1 }); expect(variant()).toBe("Idle");
  });

  it("TrialIdle: derives its chip from the live B.1 access store", async () => {
    const h = harness();
    render(<ConversationScreen {...h.props} />); await settled();
    h.setGate({ state: "trial-active", remaining: 2 });
    expect(variant()).toBe("TrialIdle");
    expect(screen.getByRole("button", { name: "Conversation context" }).textContent).toBe("Trial");
    expect(field().disabled).toBe(false);
    h.setGate({ state: "licensed" });
    expect(variant()).toBe("Idle");
    expect(screen.getByRole("button", { name: "Conversation context" }).textContent).toBe("You");
  });

  it("TrialExhausted: replaces the composer, retains history, and delegates unlock and code actions", async () => {
    const h = harness({ state: "trial-active", remaining: 1 });
    render(<ConversationScreen {...h.props} />); await settled();
    h.send({ type: "turn", turn: reply });
    h.setGate({ state: "trial-exhausted", remaining: 0 });
    expect(variant()).toBe("TrialExhausted");
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button", { name: "Send message" })).toBeNull();
    expect(screen.getByText("Your three trial readings are used.")).toBeTruthy();
    expect(screen.getByText(reply.text)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Unlock natally" }));
    fireEvent.click(screen.getByRole("button", { name: "or enter a code" }));
    expect(h.props.onUnlock).toHaveBeenCalledOnce(); expect(h.props.onEnterCode).toHaveBeenCalledOnce();
    expect(h.services.submit).not.toHaveBeenCalled();
  });

  it("RateLimited: displays the actual runtime date, disables sending, and does not unlock on its own timer", async () => {
    const h = harness();
    const { container } = render(<ConversationScreen {...h.props} />); await settled();
    const nextReadingAt = Date.UTC(2026, 8, 16, 15, 42);
    h.setGate({ state: "rate-limited", nextReadingAt });
    expect(variant()).toBe("RateLimited");
    expect(field().disabled).toBe(true);
    expect(container.querySelector("time")?.dateTime).toBe(new Date(nextReadingAt).toISOString());
    expect(container.querySelector("time")?.textContent).toBe(new Date(nextReadingAt).toLocaleString());
    expect(container.querySelector("time")?.getAttribute("data-provenance")).toBe("computed");
    vi.useFakeTimers();
    act(() => vi.advanceTimersByTime(10 * 86400000));
    expect(variant()).toBe("RateLimited");
    vi.useRealTimers();
    h.setGate({ state: "trial-active" }); expect(variant()).toBe("TrialIdle");
  });

  it("Desktop: composes the supplied People/Sessions and Atlas panels without another router or Stage", async () => {
    const h = harness();
    render(<ConversationScreen {...h.props} peopleAndSessions={<p>Persisted people and sessions</p>} atlas={<p>Opened computed atlas</p>} />);
    await settled();
    act(() => { wide = true; for (const notify of mediaListeners) notify(); });
    h.send({ type: "turn", turn: reply });
    expect(variant()).toBe("Desktop");
    expect(screen.getByRole("complementary", { name: "People and sessions" }).textContent).toContain("Persisted");
    expect(screen.getByRole("complementary", { name: "Atlas" }).textContent).toContain("computed atlas");
    expect(screen.getAllByRole("region", { name: "Companion stage" })).toHaveLength(1);
    expect(screen.queryByRole("navigation")).toBeNull();
  });
});

describe("conversation integration and truthful rendering", () => {
  it("submits once through the injected service, observes focus, and renders only published events", async () => {
    const h = harness();
    const completion = deferred<void>();
    h.services.submit = vi.fn(() => completion.promise);
    render(<ConversationScreen {...h.props} />); await settled();
    fireEvent.focus(field()); expect(stageState()).toBe("Listening");
    fireEvent.change(field(), { target: { value: userTurn.text } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    fireEvent.submit(screen.getByRole("form", { name: "Compose message" }));
    expect(h.services.submit).toHaveBeenCalledTimes(1);
    expect(h.services.submit).toHaveBeenCalledWith(userTurn.text, { sessionId, signal: expect.any(AbortSignal) });
    expect(screen.queryByRole("article", { name: "Your message" })).toBeNull();
    expect(stageState()).toBe("Idle");
    h.send({ type: "turn", turn: userTurn });
    expect(screen.getByRole("article", { name: "Your message" }).textContent).toBe(userTurn.text);
    expect(field().value).toBe("");
    h.send({ type: "turn", turn: reply });
    await act(async () => { completion.resolve(); await completion.promise; });
    expect(field().disabled).toBe(false);
  });

  it("rechecks an access update that has not rendered and never submits a denied request", async () => {
    const h = harness();
    render(<ConversationScreen {...h.props} />); await settled();
    fireEvent.change(field(), { target: { value: "Read" } });
    h.setGate({ state: "trial-exhausted", remaining: 0 }, false);
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    expect(h.services.submit).not.toHaveBeenCalled();
  });

  it("restores history without re-emitting Stage events and lets live rows win the hydration race", async () => {
    const h = harness();
    const history = deferred<readonly Turn[]>();
    h.services.turns.list = vi.fn(() => history.promise);
    const emit = vi.spyOn(h.bus, "emit");
    render(<ConversationScreen {...h.props} />);
    h.send({ type: "turn", turn: reply });
    await act(async () => { history.resolve([userTurn, { ...reply, text: "Older row" }, { ...reply, id: "foreign", sessionId: "other" }]); await history.promise; });
    expect(screen.getByText(userTurn.text)).toBeTruthy();
    expect(screen.getAllByText(reply.text)).toHaveLength(1);
    expect(screen.queryByText("Older row")).toBeNull();
    expect(emit).toHaveBeenCalledTimes(1);
    expect(stageState()).toBe("Idle");
  });

  it("shows storage failures and retries history while preserving observed messages", async () => {
    const h = harness();
    h.services.turns.list = vi.fn().mockRejectedValueOnce(new Error("SQLite read failed: busy")).mockResolvedValue([reply]);
    render(<ConversationScreen {...h.props} />);
    await screen.findByText("SQLite read failed: busy");
    expect(field().disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Try loading again" }));
    await screen.findByText(reply.text);
    expect(screen.queryByText("SQLite read failed: busy")).toBeNull();
    expect(field().disabled).toBe(false);
  });

  it("keeps an unaccepted draft on submission failure and does not invent an engine Error signal", async () => {
    const h = harness();
    h.services.submit = vi.fn(async () => { throw new Error("Persistence write failed"); });
    render(<ConversationScreen {...h.props} />); await settled();
    fireEvent.change(field(), { target: { value: userTurn.text } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await screen.findByText("Persistence write failed");
    expect(field().value).toBe(userTurn.text);
    expect(stageState()).toBe("Idle");
    expect(screen.queryByRole("article", { name: "Your message" })).toBeNull();
  });

  it("cancels in-flight submission on session switch and ignores late history, plates and old bus events", async () => {
    const h = harness();
    const next = harness();
    const history = deferred<readonly Turn[]>();
    const resolvingPlate = deferred<ConversationPlate | null>();
    h.services.plates!.get = () => resolvingPlate.promise;
    const submitted = deferred<void>();
    h.services.submit = vi.fn(() => submitted.promise);
    const { rerender } = render(<ConversationScreen {...h.props} />); await settled();
    fireEvent.change(field(), { target: { value: "Old draft" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    const signal = vi.mocked(h.services.submit).mock.calls[0][1].signal;
    h.services.turns.list = () => history.promise;
    h.send({ type: "chart-computed", chartId: plate.id });
    rerender(<ConversationScreen {...next.props} sessionId="next-session" />); await settled();
    expect(signal.aborted).toBe(true);
    expect(field().value).toBe("");
    h.send({ type: "token", token: "Old stream" }, { type: "turn", turn: reply });
    await act(async () => { history.resolve([reply]); resolvingPlate.resolve(plate); submitted.resolve(); await Promise.all([history.promise, resolvingPlate.promise, submitted.promise]); });
    expect(screen.queryByText(reply.text)).toBeNull();
    expect(screen.queryByText("Old stream")).toBeNull();
    expect(screen.queryByText(plate.title)).toBeNull();
    expect(h.accessListeners.size).toBe(0);
  });

  it("does not mislabel arbitrary tool text as computed facts or generated interpretation", async () => {
    const h = harness();
    render(<ConversationScreen {...h.props} content={[{ kind: "computed", text: "Moon 27°51′" }, { kind: "absence", text: "No house positions without birth time." }]} />); await settled();
    h.send({ type: "turn", turn: { ...reply, role: "tool", text: "Internal DOM operation" } });
    expect(screen.queryByText("Internal DOM operation")).toBeNull();
    expect(screen.getByText("Moon 27°51′").getAttribute("data-provenance")).toBe("computed");
    expect(screen.getByText("No house positions without birth time.").getAttribute("data-provenance")).toBe("absence");
  });

  it("does not claim a three-reading count for a time trial", async () => {
    const h = harness({ state: "trial-exhausted" });
    render(<ConversationScreen {...h.props} trialPolicy={{ mode: "time", days: 7, trialModel: "manifest-model" }} />); await settled();
    expect(screen.getByText("Your trial has ended.")).toBeTruthy();
    expect(screen.queryByText("Your three trial readings are used.")).toBeNull();
  });

  it("keeps unresolved access and model capability honest, including a same-state model observation", async () => {
    const h = harness(null, null);
    const { unmount } = render(<ConversationScreen {...h.props} />); await settled();
    expect(field().disabled).toBe(true);
    expect(screen.getByText("Reading access is unavailable.")).toBeTruthy();
    expect(screen.getByText("Companion availability is not known yet.")).toBeTruthy();
    h.send({ type: "model-presence", present: true }); frame();
    expect(screen.queryByText("Companion availability is not known yet.")).toBeNull();
    h.setGate({ state: "licensed" }); expect(field().disabled).toBe(false);
    unmount(); expect(frames.size).toBe(0); expect(mediaListeners.size).toBe(0);
  });

  it("collapses exactly one Stage into the header on mobile scroll and restores it on desktop", async () => {
    const h = harness();
    const { container } = render(<ConversationScreen {...h.props} renderHeader={(context, avatar) => <header>{avatar}{context}</header>} />); await settled();
    const page = screen.getByLabelText("Conversation page");
    fireEvent.scroll(page, { target: { scrollTop: 220 } });
    expect(container.querySelector("header .conversation__stage--avatar")).not.toBeNull();
    expect(screen.getAllByRole("region", { name: "Companion stage" })).toHaveLength(1);
    act(() => { wide = true; for (const notify of mediaListeners) notify(); });
    expect(container.querySelector(".conversation__stage-space .natally-stage")).not.toBeNull();
    expect(container.querySelector(".conversation__stage--avatar")).toBeNull();
  });

  it("disables unavailable optional controls and delegates supplied voice/attachment actions", async () => {
    const h = harness();
    const { rerender } = render(<ConversationScreen {...h.props} />); await settled();
    expect(isDisabled(screen.getByRole("button", { name: "Voice input" }))).toBe(true);
    expect(isDisabled(screen.getByRole("button", { name: "Add attachment" }))).toBe(true);
    const voice = vi.fn(async () => {});
    const attach = vi.fn(async () => {});
    rerender(<ConversationScreen {...h.props} onVoice={voice} onAttach={attach} voiceActive />);
    fireEvent.click(screen.getByRole("button", { name: "Voice input" }));
    await waitFor(() => expect(voice).toHaveBeenCalledOnce());
    expect(screen.getByRole("button", { name: "Voice input" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Add attachment" }));
    await waitFor(() => expect(attach).toHaveBeenCalledOnce());
    expect(stageState()).toBe("Idle");
  });

  it("reports plate lookup absence/failure without a made-up wheel", async () => {
    const h = harness();
    h.services.plates!.get = vi.fn().mockResolvedValueOnce(null).mockRejectedValueOnce(new Error("Chart read failed"));
    render(<ConversationScreen {...h.props} />); await settled();
    h.send({ type: "chart-computed", chartId: "missing" });
    await screen.findByText("Chart details are unavailable.");
    h.send({ type: "chart-computed", chartId: "failed" });
    await screen.findByText("Chart read failed");
    expect(screen.queryByRole("button", { name: /^Open / })).toBeNull();
  });

  it("exports the context chip for shell integration and reads all frozen variant names", () => {
    render(<ConversationContextChip gate={{ state: "trial-active", remaining: 1 }} onClick={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Conversation context" }).textContent).toBe("Trial");
    let ledger: { screens: Record<string, Record<string, string>> };
    try { ledger = JSON.parse(readFileSync(new URL("../../../../../LIBS/UI/FIGMA/STATE-LEDGER.json", import.meta.url), "utf8")); }
    catch (error) { throw new Error("Frozen conversation ledger could not be read", { cause: error }); }
    expect(Object.keys(ledger.screens["screen-conversation"]).sort()).toEqual(["Idle", "Thinking", "Speaking", "Asleep", "Error", "TrialIdle", "TrialExhausted", "RateLimited", "Desktop"].sort());
  });
});
