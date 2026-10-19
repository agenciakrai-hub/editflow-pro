import assert from "node:assert/strict";
import { buildGroups } from "../src/modules/album/similarity/groupBuilder.js";

const signalA = Array(256).fill(0);
const signalB = Array(256).fill(13); // mismo entorno, cambio visual ambiguo
const photos = [
  { id: "a", capture_time: 1000, phash: "0000000000000000" },
  { id: "b", capture_time: 2000, phash: "0000000000000000" },
];
const signals = new Map([["a", signalA], ["b", signalB]]);
const common = { photos, signals, thumbOf: () => "synthetic-preview" };

const confirmedSame = await buildGroups({
  ...common,
  resolveContinuity: async () => [true],
});
assert.equal(confirmedSame.length, 1, "only explicit positive vision result may join an ambiguous boundary");

const confirmedDifferent = await buildGroups({
  ...common,
  resolveContinuity: async () => [false],
});
assert.equal(confirmedDifferent.length, 2, "explicit different-moment decision must split");

const missingDecision = await buildGroups({
  ...common,
  resolveContinuity: async () => [],
});
assert.equal(missingDecision.length, 2, "missing vision decision must not silently merge moments");

const unavailableVision = await buildGroups({
  ...common,
  resolveContinuity: async () => { throw new Error("provider unavailable"); },
});
assert.equal(unavailableVision.length, 2, "provider outage must not silently merge moments");

const noResolver = await buildGroups(common);
assert.equal(noResolver.length, 2, "without a vision resolver, ambiguous photos remain separate");

console.log("PASS: ambiguous burst boundaries fail closed on missing, incomplete, or failed vision responses");
