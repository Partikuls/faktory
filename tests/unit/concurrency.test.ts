import { describe, it, expect } from "vitest";
import { mapLimit } from "../../src/concurrency.js";

const tick = () => new Promise<void>((r) => setTimeout(r, 5));

describe("mapLimit", () => {
  it("never runs more than `limit` at once and preserves order", async () => {
    let inFlight = 0, peak = 0;
    const r = await mapLimit([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      inFlight++; peak = Math.max(peak, inFlight);
      await tick(); await tick();
      inFlight--;
      return n * 10;
    });
    expect(peak).toBe(3);
    expect(r.map((x) => (x as PromiseFulfilledResult<number>).value)).toEqual([10, 20, 30, 40, 50, 60, 70]);
  });
  it("captures a rejection without stopping the others", async () => {
    const r = await mapLimit(["a", "b", "c"], 2, async (s) => { await tick(); if (s === "b") throw new Error("boom"); return s.toUpperCase(); });
    expect(r[0]).toEqual({ status: "fulfilled", value: "A" });
    expect(r[1].status).toBe("rejected");
    expect((r[1] as PromiseRejectedResult).reason.message).toBe("boom");
    expect(r[2]).toEqual({ status: "fulfilled", value: "C" });
  });
  it("handles an empty list and a limit larger than the list", async () => {
    expect(await mapLimit([], 3, async () => 1)).toEqual([]);
    expect((await mapLimit([1], 8, async (n) => n)).length).toBe(1);
  });
  it("clamps limit <= 0 to a single worker instead of running nothing", async () => {
    let inFlight = 0, peak = 0;
    const r = await mapLimit([1, 2, 3], 0, async (n) => {
      inFlight++; peak = Math.max(peak, inFlight);
      await tick();
      inFlight--;
      return n;
    });
    expect(peak).toBe(1);
    expect(r.map((x) => (x as PromiseFulfilledResult<number>).value)).toEqual([1, 2, 3]);
  });
});
