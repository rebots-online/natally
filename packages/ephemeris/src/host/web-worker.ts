import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { SwissephModule } from "sweph-wasm/wasm/swisseph";
import SwissephModuleFactory from "sweph-wasm/wasm/swisseph";
import type { EphemerisEngine } from "../seam";
import { SwephEngine } from "../sweph/engine";
import {
  decodeRequest,
  encodeResponse,
  type HostRequest,
  type HostResponse,
  type InitParams,
  type InitResult,
  makeErrorResponse,
  makeOkResponse,
} from "./protocol";

// # Ephemeris host worker — web leg (task P.3, ARCHITECTURE §4)
//
// Self-contained worker entry: the ephemeris never runs on the UI thread
// (§4). It speaks the JSON protocol of ./protocol.ts — requests in, one
// `{id, ok, result|error}` response per request, correlated by `id`.
//
// On `init` it instantiates the real P.1 SwephEngine in Moshier mode (the
// engine's existing config seam) and then serves position/cusps/aspects
// through it; calling any other op before a completed init is a protocol
// error response, as is any undecodable request.
//
// wasm loading: the pinned sweph-wasm glue cannot fetch its binary under
// node, so this entry reads the package's own swisseph.wasm bytes and injects
// them through the engine's host-injection seam (options.createWasmModule) —
// the established pattern of tests/conformance.test.ts, reused verbatim so
// the worker runs under the vitest web-worker setup. A browser host swaps
// this loader for the §13 sha256-verified fetch through the same seam.

let engine: EphemerisEngine | undefined;
let initPromise: Promise<InitResult> | undefined;

function requireEngine(): EphemerisEngine {
  const current = engine;
  if (current === undefined) {
    throw new Error("host worker not initialized — send { op: 'init' } first");
  }
  return current;
}

/** Byte-injected wasm loader (conformance.test.ts pattern, see header). */
function wasmModuleLoader(): () => Promise<SwissephModule> {
  const require_ = createRequire(import.meta.url);
  const wasmBytes = readFileSync(
    join(dirname(require_.resolve("sweph-wasm")), "wasm", "swisseph.wasm"),
  );
  const wasmBinary = new ArrayBuffer(wasmBytes.byteLength);
  new Uint8Array(wasmBinary).set(wasmBytes);
  return () => SwissephModuleFactory({ wasmBinary });
}

async function bootstrap(params: InitParams): Promise<InitResult> {
  const candidate = new SwephEngine();
  await candidate.init({
    tablesUrl: params.tablesUrl,
    options: {
      mode: params.moshier ? "moshier" : "swieph",
      createWasmModule: wasmModuleLoader(),
    },
  });
  engine = candidate;
  return { engine: candidate.id, moshier: params.moshier };
}

/** Idempotent init: concurrent inits share one bootstrap; a failure may retry. */
function ensureInit(params: InitParams): Promise<InitResult> {
  if (initPromise === undefined) {
    initPromise = bootstrap(params).catch((error: unknown) => {
      initPromise = undefined;
      throw error;
    });
  }
  return initPromise;
}

/** Exhaustive: the protocol's op union is fully handled. */
function dispatch(request: HostRequest): Promise<HostResponse> {
  switch (request.op) {
    case "init":
      return ensureInit(request.params).then((result) =>
        makeOkResponse("init", request.id, result),
      );
    case "position":
      return Promise.resolve(
        makeOkResponse(
          "position",
          request.id,
          requireEngine().position(request.params.body, request.params.ut),
        ),
      );
    case "cusps":
      return Promise.resolve(
        makeOkResponse(
          "cusps",
          request.id,
          requireEngine().cusps(request.params.ut, request.params.place, request.params.system),
        ),
      );
    case "aspects":
      return Promise.resolve(
        makeOkResponse(
          "aspects",
          request.id,
          requireEngine().aspects(request.params.a, request.params.b, request.params.orbs),
        ),
      );
  }
}

/** Echo the request id on protocol-level failures, even undecodable ones. */
function echoId(payload: unknown): string {
  if (typeof payload === "string") {
    try {
      payload = JSON.parse(payload) as unknown;
    } catch {
      return "unknown";
    }
  }
  if (typeof payload === "object" && payload !== null && "id" in payload) {
    const id = (payload as { id: unknown }).id;
    if (typeof id === "string") {
      return id;
    }
  }
  return "unknown";
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Never rejects: every failure path becomes a protocol error response. */
async function serveOne(payload: unknown): Promise<HostResponse> {
  let request: HostRequest;
  try {
    request = decodeRequest(payload);
  } catch (error: unknown) {
    return makeErrorResponse(echoId(payload), describe(error));
  }
  try {
    return await dispatch(request);
  } catch (error: unknown) {
    return makeErrorResponse(request.id, describe(error));
  }
}

/** Minimal dedicated-worker-scope contract (browser module worker or the vitest polyfill). */
interface WorkerScope {
  postMessage(message: unknown): void;
  onmessage: ((event: { readonly data: unknown }) => void) | null;
}

const scope = self as unknown as WorkerScope;

scope.onmessage = (event: { readonly data: unknown }): void => {
  void serveOne(event.data).then((response) => scope.postMessage(encodeResponse(response)));
};
