import assert from "node:assert/strict";
import test from "node:test";
import { saltedFightDuration } from "../src/sim/engine.ts";
import { Rng } from "../src/sim/rng.ts";

test("salted fight duration varies nominal length by ±5 seconds", () => {
  const samples = new Set<number>();
  for (let i = 0; i < 100; i++) {
    const sec = saltedFightDuration(180, new Rng(1 + i * 7919));
    assert.ok(sec >= 175 && sec <= 185, `expected 175–185s, got ${sec}`);
    samples.add(sec);
  }
  assert.ok(samples.size > 5, "expected varied salted durations");
});
