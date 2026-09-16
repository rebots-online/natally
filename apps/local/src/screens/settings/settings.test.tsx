// @vitest-environment jsdom
// natally — U.5 tests: the settings screen renders the six SCREEN.md sections,
// the house-chip select binds, model rows carry real progress/storage/remove,
// the trial lock routes to /paywall while unlicensed, license states bind,
// the Data delete is confirm-gated, and the Lore line renders the L.5 stats.
// Accept line:
// "settings: 6 sections render; trial-lock and license states bind".
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Catalogue, type CatalogueRow, type KvStore } from "../../mirror/catalogue";
import { SettingsScreen } from "./SettingsScreen";
import type { SettingsScreenProps } from "./types";

const actEnv = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
actEnv.IS_REACT_ACT_ENVIRONMENT = true;

// ---------------------------------------------------------------------------
// Fixtures: a real M.1 Catalogue over an in-memory KV (real instance, not a
// stub of the seam), plus structural fakes for the injected tasks' seams.
// ---------------------------------------------------------------------------

const SHA = "a".repeat(64);

function memoryKv(): KvStore {
  const map = new Map<string, string>();
  return {
    async get(key: string): Promise<string | null> {
      return map.get(key) ?? null;
    },
    async set(key: string, value: string): Promise<void> {
      map.set(key, value);
    },
    async delete(key: string): Promise<void> {
      map.delete(key);
    },
    async keys(): Promise<readonly string[]> {
      return [...map.keys()];
    },
  };
}

function seedRow(kv: KvStore, row: CatalogueRow): void {
  void kv.set(row.asset.id, JSON.stringify(row));
}

function presentRow(id: string, bytes: number, trialEligible: boolean): CatalogueRow {
  return {
    asset: { id, kind: "llm", file: `${id}.gguf`, bytes, sha256: SHA, trialEligible },
    state: "present",
    bytesDone: bytes,
    bytesTotal: bytes,
  };
}

function downloadingRow(id: string, bytesTotal: number, bytesDone: number): CatalogueRow {
  return {
    asset: { id, kind: "llm", file: `${id}.gguf`, bytes: bytesTotal, sha256: SHA },
    state: "downloading",
    bytesDone,
    bytesTotal,
  };
}

interface HarnessCalls {
  house: string[];
  voiceSelect: string[];
  preview: string[];
  mute: boolean[];
  unlock: number;
  enterCode: number;
  about: number;
  destroyStarted: number;
}

function baseProps(kv: KvStore): { props: SettingsScreenProps; calls: HarnessCalls } {
  const calls: HarnessCalls = {
    house: [],
    voiceSelect: [],
    preview: [],
    mute: [],
    unlock: 0,
    enterCode: 0,
    about: 0,
    destroyStarted: 0,
  };
  const props: SettingsScreenProps = {
    catalogue: new Catalogue(kv),
    isLicensed: false,
    gate: { state: "trial-active" },
    restoreLicense: () => Promise.resolve({ status: "absent" }),
    onEnterCode: () => {
      calls.enterCode += 1;
      window.location.hash = "/paywall";
    },
    onUnlock: () => {
      calls.unlock += 1;
      window.location.hash = "/paywall";
    },
    voices: [{ id: "af_heart", name: "Heart" }],
    onVoiceSelect: (voiceId: string) => {
      calls.voiceSelect.push(voiceId);
    },
    onPreview: (voiceId: string) => {
      calls.preview.push(voiceId);
    },
    muted: false,
    onMuteToggle: (muted: boolean) => {
      calls.mute.push(muted);
    },
    exportAll: () => Promise.resolve({ version: "1", people: [] }),
    importDocument: () =>
      Promise.resolve({
        people: 1,
        sessions: 1,
        turns: 2,
        charts: 1,
        consumedCodes: 0,
        loreNodes: 3,
        loreEdges: 2,
      }),
    destroyEverything: (confirm: () => Promise<boolean>) => {
      calls.destroyStarted += 1;
      return Promise.resolve(confirm()).then((accepted) =>
        accepted
          ? {
              aborted: false as const,
              tablesCleared: ["people"],
              filesDeleted: [],
              tokenCleared: true,
            }
          : { aborted: true as const },
      );
    },
    loreStats: () => Promise.resolve({ turns: 42, nodes: 7, edges: 11, runtime: "wa-sqlite/OPFS" }),
    onHouseSystemChange: (system: string) => {
      calls.house.push(system);
    },
    onAbout: () => {
      calls.about += 1;
      window.location.hash = "/about";
    },
  };
  return { props, calls };
}

// ---------------------------------------------------------------------------
// Mount plumbing (stage.test.tsx pattern)
// ---------------------------------------------------------------------------

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  window.location.hash = "";
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  window.location.hash = "";
});

function render(props: SettingsScreenProps): void {
  act(() => {
    root.render(<SettingsScreen {...props} />);
  });
}

/** Flush the catalogue/stats/restore microtasks inside act. */
async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
  });
}

const q = (selector: string): Element | null => container.querySelector(selector);
const qa = (selector: string): Element[] => [...container.querySelectorAll(selector)];
const text = (selector: string): string => q(selector)?.textContent ?? "";

// ---------------------------------------------------------------------------
// Tests — Accept: "settings: 6 sections render; trial-lock and license states bind"
// ---------------------------------------------------------------------------

describe("settings: 6 sections render; trial-lock and license states bind", () => {
  it("renders the six SCREEN.md sections, honest absences, and the Lore stats line", async () => {
    const { props } = baseProps(memoryKv());
    render({ ...props, voices: [] });
    await flush();

    const sections = qa("[data-section]");
    expect(sections.map((section) => section.getAttribute("data-section"))).toEqual([
      "house-system",
      "model",
      "voice",
      "license",
      "data",
      "about",
    ]);
    expect(q('[data-variant="mobile"]')).not.toBeNull();
    expect(text('[data-testid="section-house-system"]')).toContain("House system");
    expect(text('[data-testid="section-model"]')).toContain("Model");
    expect(text('[data-testid="section-voice"]')).toContain("Voice");
    expect(text('[data-testid="section-license"]')).toContain("License");
    expect(text('[data-testid="section-data"]')).toContain("Data");
    expect(text('[data-testid="section-about"]')).toContain("About");

    // Honest absences: no models claimed, no voices claimed.
    expect(q('[data-absence="model-absent"]')).not.toBeNull();
    expect(q('[data-absence="voices-absent"]')).not.toBeNull();
    expect(text('[data-testid="storage-used"]')).toBe("storage used · 0 B");

    // The Lore line renders the L.5 stats: [turns · nodes · runtime].
    expect(text('[data-testid="lore-line"]')).toBe("[42 · 7 · wa-sqlite/OPFS]");
  });

  it("house system: the 12 engine codes render as chips and select binds", async () => {
    const { props, calls } = baseProps(memoryKv());
    render({ ...props, houseSystem: "P" });
    await flush();

    const chips = qa('[data-testid="house-chip"]');
    expect(chips).toHaveLength(12);
    expect(chips.map((chip) => chip.getAttribute("data-system"))).toEqual([
      "P",
      "K",
      "O",
      "R",
      "C",
      "A",
      "W",
      "T",
      "X",
      "B",
      "V",
      "G",
    ]);
    expect(text('[data-testid="house-chip"][data-system="P"]')).toContain("Placidus");
    expect(q('[data-testid="house-chip"][data-system="P"] span')?.getAttribute("data-active")).toBe(
      "true",
    );

    const k = q('[data-testid="house-chip"][data-system="K"]');
    expect(k?.querySelector("span")?.getAttribute("data-active")).toBe("false");
    act(() => {
      k?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(calls.house).toEqual(["K"]);
  });

  it("model rows: real download percent, storage used, remove deletes the row", async () => {
    const kv = memoryKv();
    seedRow(kv, presentRow("trial-llm", 2048, true));
    seedRow(kv, downloadingRow("big-llm", 4096, 1024));
    const { props } = baseProps(kv);
    render(props);
    await flush();

    expect(qa('[data-testid="model-row"]')).toHaveLength(2);
    const progress = q(
      '[data-testid="model-row"][data-asset="big-llm"] [data-testid="model-progress"]',
    );
    expect(progress?.getAttribute("data-percent")).toBe("25");
    expect(progress?.textContent).toContain("25%");
    expect(progress?.textContent).toContain("1.0 KB / 4.0 KB");
    expect(text('[data-testid="storage-used"]')).toBe("storage used · 2.0 KB");

    const remove = q(
      '[data-testid="model-row"][data-asset="trial-llm"] [data-testid="model-remove"]',
    );
    act(() => {
      remove?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();
    expect(qa('[data-testid="model-row"]')).toHaveLength(1);
    expect(q('[data-testid="model-row"][data-asset="trial-llm"]')).toBeNull();
    expect(text('[data-testid="storage-used"]')).toBe("storage used · 0 B");
  });

  it("trial-lock: unlicensed non-trial rows lock and route to /paywall; licensed sees no lock", async () => {
    const kv = memoryKv();
    seedRow(kv, presentRow("trial-llm", 2048, true));
    seedRow(kv, presentRow("paid-llm", 8192, false));
    const { props, calls } = baseProps(kv);

    render(props);
    await flush();
    expect(
      q('[data-testid="model-row"][data-asset="trial-llm"] [data-testid="model-lock"]'),
    ).toBeNull();
    const lock = q('[data-testid="model-row"][data-asset="paid-llm"] [data-testid="model-lock"]');
    expect(lock).not.toBeNull();
    act(() => {
      lock?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(calls.unlock).toBe(1);
    expect(window.location.hash).toBe("#/paywall");

    render({ ...props, isLicensed: true });
    await flush();
    expect(qa('[data-testid="model-lock"]')).toHaveLength(0);
    expect(qa('[data-testid="model-remove"]')).toHaveLength(2);
  });

  it("license states bind: unlimited + unlocked date vs trial counts; restore and enter-code", async () => {
    const kv = memoryKv();
    const { props, calls } = baseProps(kv);

    // Licensed: [unlimited], the computed unlocked date, chip active. `iat`
    // is built from local time so the computed date is TZ-independent.
    render({
      ...props,
      isLicensed: true,
      gate: { state: "licensed" },
      tokenPayload: {
        sub: "app-user",
        tier: "unlimited",
        iat: new Date(2026, 7, 19).getTime() / 1000,
      },
    });
    await flush();
    expect(text('[data-testid="license-status"]')).toBe("[unlimited]");
    expect(text('[data-testid="license-unlocked"]')).toBe("unlocked 2026-08-19");
    expect(q('[data-testid="license-chip"]')?.getAttribute("data-active")).toBe("true");
    expect(text('[data-testid="license-chip"]')).toBe("Unlimited");

    const restore = q('[data-testid="restore"]');
    act(() => {
      restore?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();
    expect(text('[data-testid="restore-outcome"]')).toBe("no purchases found on this device");

    const enterCode = q('[data-testid="enter-code"]');
    act(() => {
      enterCode?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(calls.enterCode).toBe(1);
    expect(window.location.hash).toBe("#/paywall");

    // Unlicensed: the trial status line carries the B.1 gate's real count.
    render({ ...props, gate: { state: "trial-active", remaining: 2 } });
    await flush();
    expect(text('[data-testid="license-status"]')).toBe("[trial · 2 readings left]");
    expect(q('[data-testid="license-unlocked"]')).toBeNull();
    expect(q('[data-testid="license-chip"]')?.getAttribute("data-active")).toBe("false");
  });

  it("data: delete-everything is confirm-gated; lore line, export and import bind", async () => {
    const { props, calls } = baseProps(memoryKv());
    render(props);
    await flush();

    // Decline path: the plate opens, cancel aborts with nothing touched.
    const destroy = q('[data-testid="delete-everything"]');
    act(() => {
      destroy?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(q('[data-testid="delete-confirm"]')).not.toBeNull();
    expect(calls.destroyStarted).toBe(1);
    const cancel = q('[data-testid="delete-confirm-no"]');
    act(() => {
      cancel?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();
    expect(q('[data-testid="delete-confirm"]')).toBeNull();
    expect(text('[data-testid="delete-outcome"]')).toBe("declined — nothing was deleted");

    // Accept path: the plate's confirm drives the honest deletion report.
    act(() => {
      q('[data-testid="delete-everything"]')?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    const confirm = q('[data-testid="delete-confirm-yes"]');
    act(() => {
      confirm?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();
    expect(text('[data-testid="delete-outcome"]')).toBe(
      "deleted 1 tables · 0 files · license token cleared",
    );

    // Export: the X.1 document downloads as plaintext JSON. jsdom cannot
    // navigate blob: URLs (its anchor navigation is a scheduled no-op that
    // logs), so the anchor's click is stubbed for the duration — the real
    // browser behaviour under test is the Blob built from the export.
    const created: (Blob | MediaSource)[] = [];
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    const originalAnchorClick = HTMLAnchorElement.prototype.click;
    URL.createObjectURL = (blob: Blob | MediaSource) => {
      created.push(blob);
      return "blob:mock";
    };
    URL.revokeObjectURL = () => undefined;
    HTMLAnchorElement.prototype.click = function stubbedClick(): void {};
    try {
      act(() => {
        q('[data-testid="export"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      await flush();
      expect(created).toHaveLength(1);
      const blob = created[0];
      expect(blob instanceof Blob).toBe(true);
      const exported = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          resolve(String(reader.result));
        };
        reader.onerror = () => {
          reject(reader.error);
        };
        reader.readAsText(blob as Blob);
      });
      expect(exported).toContain('"version": "1"');
      expect(text('[data-testid="export-outcome"]')).toContain("natally-export.json");
    } finally {
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
      HTMLAnchorElement.prototype.click = originalAnchorClick;
    }

    // Import: one JSON file through the injected X.1 seam → honest summary.
    const file = new File(['{"version":"1"}'], "export.json", { type: "application/json" });
    const input = q('[data-testid="import"]');
    if (input === null) {
      throw new Error("import input missing");
    }
    Object.defineProperty(input, "files", { value: [file] });
    act(() => {
      input?.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await flush();
    expect(text('[data-testid="import-outcome"]')).toBe(
      "imported 1 people · 2 turns · 1 charts · 3 lore nodes",
    );
  });
});
