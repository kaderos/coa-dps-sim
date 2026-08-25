import assert from "node:assert/strict";
import test from "node:test";
import {
  BisbeardImportError,
  bisbeardImportEndpoint,
  bisbeardImportRequestUrl,
  mapBisbeardBuild,
  parseBisbeardBuildId,
} from "../src/bisbeard-import.ts";

test("parseBisbeardBuildId accepts share URLs and bare ids", () => {
  assert.equal(parseBisbeardBuildId("https://coa.bisbeard.com/b/cQpb7ZcI1Nr0Pj"), "cQpb7ZcI1Nr0Pj");
  assert.equal(parseBisbeardBuildId("cQpb7ZcI1Nr0Pj"), "cQpb7ZcI1Nr0Pj");
  assert.equal(parseBisbeardBuildId("not a link"), null);
});

test("bisbeardImportEndpoint uses absolute Worker URL in production", () => {
  const endpoint = bisbeardImportEndpoint({
    DEV: false,
    VITE_BISBEARD_PROXY: "https://coa-dps-sim-bisbeard-proxy.example.workers.dev",
  } as ImportMetaEnv);
  assert.equal(endpoint, "https://coa-dps-sim-bisbeard-proxy.example.workers.dev/api/bisbeard/import");
});

test("bisbeardImportEndpoint accepts a full import path", () => {
  const endpoint = bisbeardImportEndpoint({
    DEV: false,
    VITE_BISBEARD_PROXY: "https://coa-dps-sim-bisbeard-proxy.example.workers.dev/api/bisbeard/import",
  } as ImportMetaEnv);
  assert.equal(endpoint, "https://coa-dps-sim-bisbeard-proxy.example.workers.dev/api/bisbeard/import");
});

test("bisbeardImportEndpoint uses local middleware path in development", () => {
  const endpoint = bisbeardImportEndpoint({
    DEV: true,
    VITE_BISBEARD_PROXY: "",
  } as ImportMetaEnv);
  assert.equal(endpoint, "/api/bisbeard/import");
});

test("bisbeardImportEndpoint fails closed without production proxy config", () => {
  assert.throws(
    () =>
      bisbeardImportEndpoint({
        DEV: false,
        VITE_BISBEARD_PROXY: "",
      } as ImportMetaEnv),
    (err: unknown) => err instanceof BisbeardImportError,
  );
});

test("bisbeardImportRequestUrl does not append the GitHub Pages project path to the Worker", () => {
  const url = bisbeardImportRequestUrl("https://coa.bisbeard.com/b/cQpb7ZcI1Nr0Pj", {
    DEV: false,
    VITE_BISBEARD_PROXY: "https://coa-dps-sim-bisbeard-proxy.example.workers.dev",
  } as ImportMetaEnv);
  assert.equal(
    url,
    "https://coa-dps-sim-bisbeard-proxy.example.workers.dev/api/bisbeard/import?share=https%3A%2F%2Fcoa.bisbeard.com%2Fb%2FcQpb7ZcI1Nr0Pj",
  );
  assert.equal(url.includes("/coa-dps-sim/"), false);
});

test("mapBisbeardBuild maps slot arrays", () => {
  const mapped = mapBisbeardBuild({
    gear: ["1", "-", "3"],
    enchants: ["-", "9"],
    phase: 5,
    specName: "Infernal",
    className: "Felsworn",
  });
  assert.equal(mapped.gear.head, 1);
  assert.equal(mapped.gear.neck, null);
  assert.equal(mapped.gear.shoulder, 3);
  assert.equal(mapped.enchants.head, null);
  assert.equal(mapped.enchants.neck, 9);
  assert.equal(mapped.phase, "5");
  assert.equal(mapped.specName, "Infernal");
  assert.equal(mapped.className, "Felsworn");
});
