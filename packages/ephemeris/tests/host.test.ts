import "@vitest/web-worker";

import { afterAll, expect, it } from "vitest";
import {
  decodeResponse,
  encodeRequest,
  type HostOp,
  type HostReply,
  type HostRequest,
} from "../src/host/protocol";
import { CONFORMANCE_MOMENTS, CONFORMANCE_PLACE } from "./fixtures/conformance";

// # P.3 host roundtrip — the REAL worker entry under the vitest web-worker
// setup. The worker instantiates the real sweph-wasm engine (Moshier fallback,
// wasm bytes injected worker-side per tests/conformance.test.ts) and serves
// the JSON protocol: init → cusps (Placidus at the fixture moment/place) must
// come back ok with 12 ascending cusps plus asc/mc; a bad op comes back as
// {ok:false, error}. No mocks anywhere.

const worker = new Worker(new URL("../src/host/web-worker.ts", import.meta.url), {
  type: "module",
});

afterAll(() => {
  worker.terminate();
});

/** Resolve the worker's next reply as raw wire data. */
function nextReply(): Promise<unknown> {
  return new Promise((resolve) => {
    worker.onmessage = (event: MessageEvent<unknown>) => {
      worker.onmessage = null;
      resolve(event.data);
    };
  });
}

/** Send a typed request; resolve the next reply decoded against its op. */
async function roundtrip<O extends HostOp>(
  op: O,
  request: Extract<HostRequest, { op: O }>,
): Promise<HostReply<O>> {
  const pending = nextReply();
  worker.postMessage(encodeRequest(request));
  return decodeResponse(await pending, op);
}

function fixtureMoment(): (typeof CONFORMANCE_MOMENTS)[number] {
  const moment = CONFORMANCE_MOMENTS[0];
  if (moment === undefined) {
    throw new Error("fixture error: no conformance moments");
  }
  return moment;
}

it("host: init→cusps roundtrip via protocol OK", async () => {
  const moment = fixtureMoment();

  // init — Moshier fallback (no tables at test time; Chiron honestly absent).
  const init = await roundtrip("init", {
    id: "host-init",
    op: "init",
    params: { tablesUrl: "host-test-moshier-no-tables", moshier: true },
  });
  if (!init.ok) {
    throw new Error(`host: init failed: ${init.error}`);
  }
  expect(init.id).toBe("host-init");
  expect(init.result.engine).toBe("sweph-wasm");
  expect(init.result.moshier).toBe(true);

  // cusps — Placidus at the fixture moment (1990-05-02T14:32Z) and place
  // (55.60N 13.00E), through the protocol.
  const reply = await roundtrip("cusps", {
    id: "host-cusps",
    op: "cusps",
    params: { ut: moment.jd, place: CONFORMANCE_PLACE, system: "P" },
  });
  if (!reply.ok) {
    throw new Error(`host: cusps failed: ${reply.error}`);
  }
  expect(reply.id).toBe("host-cusps");
  expect(reply.result.cusps).toHaveLength(12);

  // TR-1 across the protocol boundary: the 12 cusps ascend strictly modulo 360.
  for (let house = 0; house < 12; house++) {
    const current = reply.result.cusps[house];
    const next = reply.result.cusps[(house + 1) % 12];
    if (current === undefined || next === undefined) {
      throw new Error("host error: missing cusp in reply");
    }
    const forward = (((next - current) % 360) + 360) % 360;
    expect(forward).toBeGreaterThan(0);
  }

  // asc/mc ride along, in range, and anchor the quadrant (P: cusp 1 = asc,
  // cusp 10 = mc).
  expect(reply.result.asc).toBeGreaterThanOrEqual(0);
  expect(reply.result.asc).toBeLessThan(360);
  expect(reply.result.mc).toBeGreaterThanOrEqual(0);
  expect(reply.result.mc).toBeLessThan(360);
  expect(reply.result.cusps[0]).toBeCloseTo(reply.result.asc, 6);
  expect(reply.result.cusps[9]).toBeCloseTo(reply.result.mc, 6);
}, 60_000);

it("host: bad op ⇒ {ok:false, error}", async () => {
  const pending = nextReply();
  // A raw payload with an unknown op (bypassing encodeRequest's validation —
  // the worker must still answer per the protocol).
  worker.postMessage(JSON.stringify({ id: "host-bad-op", op: "heliocentric", params: {} }));
  const reply = decodeResponse(await pending, "init");
  if (reply.ok) {
    throw new Error("host error: a bad op must not succeed");
  }
  expect(reply.id).toBe("host-bad-op");
  expect(reply.error.length).toBeGreaterThan(0);
});

it("host: engine failure path ⇒ {ok:false, error} (chiron honest absence)", async () => {
  const moment = fixtureMoment();
  const reply = await roundtrip("position", {
    id: "host-chiron",
    op: "position",
    params: { body: "chiron", ut: moment.jd },
  });
  if (reply.ok) {
    throw new Error("host error: chiron must stay honestly absent under Moshier");
  }
  expect(reply.id).toBe("host-chiron");
  expect(reply.error).toMatch(/honest absence/);
});
