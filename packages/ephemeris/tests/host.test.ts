import { Worker as NodeWorker } from "node:worker_threads";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HostResponse } from "../src/host/protocol.ts";
import { createEphemerisWorker, EphemerisWorkerHost } from "../src/host/web-worker.ts";
import {
  type ChartFacts,
  DEFAULT_ORBS,
  EclipticPositionSchema,
  HouseCuspsSchema,
} from "../src/types.ts";

const assetRoot = new URL("../../../VENDORED/sweph-wasm/dist/", import.meta.url).href;
const runtimeUrl = new URL("../src/host/protocol.ts", import.meta.url).href;
const ut = 2451545;
const place = { lat: 51.5, lon: 0 };
const workers: NodeWorker[] = [];

// Node 24 executes the SAME TypeScript runtime using native type stripping. This
// adapter only bridges worker_threads messages and fetches real local assets;
// it never substitutes the engine, WASM, tables, dispatcher or calculated output.
const moduleWorkerSource = `
  import { parentPort, workerData, threadId, isMainThread } from 'node:worker_threads';
  import { readFile } from 'node:fs/promises';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, options) => {
    const url = new URL(input);
    if (url.protocol !== 'file:') return originalFetch(input, options);
    if (workerData.delay) await new Promise(resolve => setTimeout(resolve, workerData.delay));
    try { return new Response(await readFile(url)); }
    catch (error) {
      if (error.code === 'ENOENT') return new Response(null, { status: 404 });
      throw error;
    }
  };
  const { attachEphemerisWorker } = await import(workerData.runtimeUrl);
  attachEphemerisWorker({
    addEventListener: (_, listener) => parentPort.on('message', data => listener({ data })),
    postMessage: response => parentPort.postMessage(response),
  });
  parentPort.postMessage({ ready: true, threadId, isMainThread });
`;

async function startWorker(delay = 0) {
  const worker = new NodeWorker(
    new URL(`data:text/javascript,${encodeURIComponent(moduleWorkerSource)}`),
    {
      workerData: { runtimeUrl, delay },
    },
  );
  workers.push(worker);
  const ready = await new Promise<{ threadId: number; isMainThread: boolean }>(
    (resolve, reject) => {
      worker.once("message", resolve);
      worker.once("error", reject);
    },
  );
  expect(ready.isMainThread).toBe(false);
  expect(ready.threadId).toBeGreaterThan(0);
  function send(request: {
    id: string | number | null;
    op: string;
    params: unknown;
  }): Promise<HostResponse> {
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        worker.off("message", onMessage);
        worker.off("error", onError);
        worker.off("exit", onExit);
      };
      const onMessage = (response: HostResponse) => {
        if (response.id !== request.id) return;
        cleanup();
        resolve(response);
      };
      const onError = (error: Error) => {
        cleanup();
        reject(error);
      };
      const onExit = (code: number) => onError(new Error(`worker exited before reply: ${code}`));
      worker.on("message", onMessage);
      worker.on("error", onError);
      worker.on("exit", onExit);
      worker.postMessage(request);
    });
  }
  function client(): EphemerisWorkerHost {
    const listeners = new Map<EventListener, (...args: unknown[]) => void>();
    return new EphemerisWorkerHost({
      postMessage: (request: unknown) => worker.postMessage(request),
      addEventListener: (type: string, listener: EventListener) => {
        const wrapped = (data: unknown) =>
          listener((type === "message" ? { data } : data) as Event);
        listeners.set(listener, wrapped);
        worker.on(type, wrapped);
      },
      removeEventListener: (type: string, listener: EventListener) => {
        const wrapped = listeners.get(listener);
        if (wrapped) worker.off(type, wrapped);
        listeners.delete(listener);
      },
      terminate: () => {
        void worker.terminate();
      },
    } as unknown as Worker);
  }
  return { send, client };
}

afterEach(async () => {
  await Promise.all(workers.splice(0).map((worker) => worker.terminate()));
  vi.unstubAllGlobals();
});

describe("actual module worker protocol", () => {
  it("host: init→cusps roundtrip via protocol OK", async () => {
    const { send } = await startWorker();
    expect(await send({ id: "init", op: "init", params: { assetRoot } })).toEqual({
      id: "init",
      ok: true,
      result: null,
    });
    const response = await send({ id: 0, op: "cusps", params: { ut, place, system: "P" } });
    expect(response.ok).toBe(true);
    if (!response.ok) throw new Error(response.error.message);
    const houses = HouseCuspsSchema.parse(response.result);
    // J2000 noon UT, Greenwich/51.5N: actual Swiss Ephemeris angles, not a stub.
    expect(houses.asc).toBeCloseTo(24.287305, 4);
    expect(houses.mc).toBeCloseTo(279.611088, 4);
    expect(houses.cusps[0]).toBeCloseTo(houses.asc, 8);
    expect(houses.cusps[9]).toBeCloseTo(houses.mc, 8);
    console.log("host: init→cusps roundtrip via protocol OK");
  }, 15000);

  it("queues calculations behind asynchronous init and preserves concurrent IDs", async () => {
    const { send } = await startWorker(30);
    const initializing = send({ id: 1, op: "init", params: { assetRoot } });
    const sun = send({ id: "sun", op: "position", params: { body: "sun", ut } });
    const moon = send({ id: "moon", op: "position", params: { body: "moon", ut } });
    expect((await initializing).ok).toBe(true);
    const [sunReply, moonReply] = await Promise.all([sun, moon]);
    expect(sunReply.id).toBe("sun");
    expect(moonReply.id).toBe("moon");
    if (!sunReply.ok || !moonReply.ok) throw new Error("queued calculation failed");
    const sunPosition = EclipticPositionSchema.parse(sunReply.result);
    const moonPosition = EclipticPositionSchema.parse(moonReply.result);
    expect(sunPosition.lon).toBeCloseTo(280.3689, 3);
    expect(moonPosition.lon).toBeCloseTo(223.3238, 3);
    expect(sunPosition.lon).not.toBe(moonPosition.lon);
  }, 15000);

  it("serializes init errors, fails queued calculations, and permits a real retry", async () => {
    const { send } = await startWorker();
    const failed = send({ id: 2, op: "init", params: {} });
    const queued = send({ id: 3, op: "cusps", params: { ut, place, system: "P" } });
    expect(await failed).toEqual({
      id: 2,
      ok: false,
      error: { name: "TypeError", message: "sweph init requires an explicit assetRoot URL" },
    });
    expect(await queued).toMatchObject({
      id: 3,
      ok: false,
      error: { message: expect.stringContaining("not initialized") },
    });
    expect((await send({ id: 4, op: "init", params: { assetRoot } })).ok).toBe(true);
    expect((await send({ id: 5, op: "cusps", params: { ut, place, system: "W" } })).ok).toBe(true);
    expect(
      (
        await send({
          id: "reinit",
          op: "init",
          params: { assetRoot: new URL("other/", assetRoot).href },
        })
      ).ok,
    ).toBe(false);
    expect(
      await send({ id: "after-reinit", op: "position", params: { body: "sun", ut } }),
    ).toMatchObject({ ok: false, error: { message: expect.stringContaining("not initialized") } });
    expect((await send({ id: "retry", op: "init", params: { assetRoot } })).ok).toBe(true);
  }, 15000);

  it("reports missing actual assets instead of acknowledging a fictional init", async () => {
    const { send } = await startWorker();
    const response = await send({
      id: 6,
      op: "init",
      params: { assetRoot: new URL("missing-host-test-assets/", assetRoot).href },
    });
    expect(response).toMatchObject({
      id: 6,
      ok: false,
      error: { name: "Error", message: expect.stringContaining("HTTP 404") },
    });
  });

  it("rejects invalid operations and params without poisoning the worker", async () => {
    const { send } = await startWorker();
    expect(await send({ id: "unknown", op: "delete", params: {} })).toMatchObject({
      id: "unknown",
      ok: false,
    });
    expect(await send({ id: null, op: "init", params: {} })).toMatchObject({ id: null, ok: false });
    expect((await send({ id: 7, op: "init", params: { assetRoot } })).ok).toBe(true);
    expect(await send({ id: 8, op: "position", params: { body: "earth", ut } })).toMatchObject({
      id: 8,
      ok: false,
    });
    expect(
      await send({ id: 9, op: "cusps", params: { ut, place: { lat: 91, lon: 0 }, system: "P" } }),
    ).toMatchObject({ id: 9, ok: false });
    expect(await send({ id: 10, op: "position", params: { body: "sun", ut: 0 } })).toMatchObject({
      id: 10,
      ok: false,
      error: { name: "RangeError" },
    });
    expect((await send({ id: 11, op: "position", params: { body: "sun", ut } })).ok).toBe(true);
  }, 15000);

  it("preserves engine cross-chart aspect pairs even when chart IDs match", async () => {
    const { send } = await startWorker();
    expect((await send({ id: 12, op: "init", params: { assetRoot } })).ok).toBe(true);
    const chart = {
      id: "host-aspect-fixture",
      inputs: { ut: [ut], place, system: "P" },
      positions: [
        { body: "sun", lon: 0, lat: 0, speed: 1 },
        { body: "moon", lon: 89, lat: 0, speed: 13 },
      ],
      aspects: [],
    };
    expect(await send({ id: 13, op: "aspects", params: { a: chart, b: chart, orbs: {} } })).toEqual(
      {
        id: 13,
        ok: true,
        result: [
          { a: "sun", b: "sun", type: "conjunction", orb: 0, applying: false },
          { a: "sun", b: "moon", type: "square", orb: 1, applying: true },
          { a: "moon", b: "sun", type: "square", orb: 1, applying: true },
          { a: "moon", b: "moon", type: "conjunction", orb: 0, applying: false },
        ],
      },
    );
  }, 15000);

  it("exposes the async FactsEngine surface over the real worker", async () => {
    const host = (await startWorker()).client();
    expect(host.id).toBe("sweph-wasm@2.6.9");
    await expect(host.init({ assetRoot })).resolves.toBeUndefined();
    const [sun, chiron, houses] = await Promise.all([
      host.position("sun", ut),
      host.chiron(ut),
      host.cusps(ut, place, "P"),
    ]);
    expect(sun.lon).toBeCloseTo(280.3689, 3);
    expect(chiron).toEqual(await host.position("chiron", ut));
    expect(HouseCuspsSchema.safeParse(houses).success).toBe(true);
    const chart: ChartFacts = {
      id: "worker-facts",
      inputs: { ut: [ut], place, system: "P" },
      positions: [{ body: "sun", ...sun }],
      aspects: [],
    };
    expect(await host.aspects(chart, chart, DEFAULT_ORBS)).toEqual([
      { a: "sun", b: "sun", type: "conjunction", orb: 0, applying: false },
    ]);
    host.close();
  }, 15000);
});

/** Transport double only: real worker and real engine execution are tested above. */
class BrowserWorkerContract {
  readonly listeners = new Map<string, Set<(event: unknown) => void>>();
  readonly postMessage = vi.fn();
  readonly terminate = vi.fn();
  constructor(
    readonly url: URL,
    readonly options: WorkerOptions,
  ) {}
  addEventListener(type: string, listener: (event: unknown) => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
  }
  removeEventListener(type: string, listener: (event: unknown) => void) {
    this.listeners.get(type)?.delete(listener);
  }
  emit(type: string, event: unknown) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

describe("browser constructor and request-ID client contract", () => {
  it("constructs a module Worker from the literal entrypoint URL", () => {
    vi.stubGlobal("Worker", BrowserWorkerContract);
    const worker = createEphemerisWorker() as unknown as BrowserWorkerContract;
    expect(worker.url).toBeInstanceOf(URL);
    expect(worker.url.href).toBe(runtimeUrl);
    expect(worker.options).toEqual({ type: "module" });
    expect(worker.postMessage).not.toHaveBeenCalled();
  });

  it("matches out-of-order replies by ID and sends JSON parameters", async () => {
    const worker = new BrowserWorkerContract(new URL(runtimeUrl), { type: "module" });
    const host = new EphemerisWorkerHost(worker as unknown as Worker);
    const first = host.request("init", { assetRoot });
    const second = host.request("position", { body: "sun", ut });
    expect(worker.postMessage.mock.calls).toEqual([
      [{ id: 0, op: "init", params: { assetRoot } }],
      [{ id: 1, op: "position", params: { body: "sun", ut } }],
    ]);
    worker.emit("message", { data: { id: 1, ok: true, result: { lon: 280, lat: 0, speed: 1 } } });
    worker.emit("message", { data: { id: 0, ok: true, result: null } });
    expect(await first).toBeNull();
    expect(await second).toEqual({ lon: 280, lat: 0, speed: 1 });
    host.close();
  });

  it("rejects serialized init errors and releases the request", async () => {
    const worker = new BrowserWorkerContract(new URL(runtimeUrl), { type: "module" });
    const host = new EphemerisWorkerHost(worker as unknown as Worker);
    const result = host.request("init", {});
    worker.emit("message", {
      data: { id: 0, ok: false, error: { name: "TypeError", message: "missing assets" } },
    });
    await expect(result).rejects.toMatchObject({ name: "TypeError", message: "missing assets" });
    host.close();
  });

  it.each(["error", "messageerror", "close"])(
    "rejects outstanding and future calls on %s",
    async (failure) => {
      const worker = new BrowserWorkerContract(new URL(runtimeUrl), { type: "module" });
      const host = new EphemerisWorkerHost(worker as unknown as Worker);
      const a = host.request("init", { assetRoot });
      const b = host.request("position", { body: "sun", ut });
      if (failure === "close") host.close();
      else worker.emit(failure, { message: "worker crashed" });
      await expect(a).rejects.toThrow();
      await expect(b).rejects.toThrow();
      await expect(host.request("init", { assetRoot })).rejects.toThrow();
      expect(worker.terminate).toHaveBeenCalledOnce();
      expect([...worker.listeners.values()].every((set) => set.size === 0)).toBe(true);
    },
  );

  it("cleans up a failed postMessage without breaking later calls", async () => {
    const worker = new BrowserWorkerContract(new URL(runtimeUrl), { type: "module" });
    worker.postMessage.mockImplementationOnce(() => {
      throw new DOMException("not cloneable", "DataCloneError");
    });
    const host = new EphemerisWorkerHost(worker as unknown as Worker);
    await expect(host.request("init", {})).rejects.toMatchObject({ name: "DataCloneError" });
    const retry = host.request("init", { assetRoot });
    worker.emit("message", { data: { id: 1, ok: true, result: null } });
    expect(await retry).toBeNull();
    host.close();
  });
});
