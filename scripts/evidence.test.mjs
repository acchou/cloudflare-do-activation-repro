import test from "node:test";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import fs from "node:fs";
const evidence = new URL("../evidence/2026-10-26/", import.meta.url);
const [header, ...lines] = fs
  .readFileSync(new URL("samples.csv", evidence), "utf8")
  .trim()
  .split(/\r?\n/);
const columns = header.split(",");
const rows = lines.map((line) =>
  Object.fromEntries(line.split(",").map((v, i) => [columns[i], v])),
);
test("published dataset retains complete measured population and residency split", () => {
  assert.equal(rows.length, 2016);
  assert.equal(new Set(rows.map((r) => r.target_object_id)).size, 72);
  assert.equal(new Set(rows.map((r) => r.caller_object_id)).size, 4);
  assert.equal(rows.filter((r) => Number(r.target_sequence) > 1).length, 1600);
  const slow = rows.filter((r) => Number(r.caller_rpc_ms) > 1000);
  assert.equal(slow.length, 18);
  assert.ok(slow.every((r) => Number(r.target_sequence) === 1));
  assert.equal(Math.max(...rows.map((r) => Number(r.caller_rpc_ms))), 27844);
});
test("each exported trace joins to its exact client probe and target object", () => {
  const dir = new URL("traces/", evidence);
  const names = fs.readdirSync(dir).filter((n) => n.endsWith(".json"));
  assert.equal(names.length, 4);
  for (const name of names) {
    const trace = JSON.parse(fs.readFileSync(new URL(name, dir), "utf8"));
    const caller = trace.find(
      (e) => e.source?.operation === "placement.caller",
    );
    assert.ok(caller, name);
    const row = rows.find((r) => r.probe_id === caller.source.id);
    assert.ok(row, name);
    assert.equal(Number(row.caller_rpc_ms), caller.source.rpcMs);
    assert.equal(row.target_object_id, caller.source.target.objectId);
    assert.ok(trace.every((e) => e.trace === caller.trace));
    assert.equal(row.target_colo, trace.find((e) => e.entry === "Target").colo);
  }
});

test("setup template is strict JSON without an account or usable secret", () => {
  const config = JSON.parse(
    fs.readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8"),
  );
  assert.equal(config.account_id, undefined);
  assert.equal(config.vars.AUTH_HASH, "0".repeat(64));
  assert.equal(config.durable_objects.bindings.length, 2);
});

test("run summaries exclude location responses and failed requests", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "do-summary-"));
  try {
    const file = path.join(dir, "samples.ndjson");
    fs.writeFileSync(
      file,
      [
        { result: { status: 200, rpcMs: 10, target: { sequence: 1 } } },
        { result: { status: 200, rpcMs: 30, target: { sequence: 2 } } },
        { result: { status: 200, target: { colo: "ORD" } } },
        { result: { status: 500, error: "failed" } },
      ]
        .map(JSON.stringify)
        .join("\n"),
    );
    const result = spawnSync(
      process.execPath,
      [fileURLToPath(new URL("summary.mjs", import.meta.url)), file],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    const summary = JSON.parse(result.stdout);
    assert.equal(summary.all.n, 2);
    assert.equal(summary.all.medianMs, 20);
    assert.equal(summary.firstOnInstance.n, 1);
    assert.equal(summary.resident.n, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("fresh setup generates a consistent private local configuration", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "do-setup-"));
  try {
    fs.mkdirSync(path.join(dir, "scripts"));
    for (const name of ["local.mjs", "setup.mjs"])
      fs.copyFileSync(
        new URL(name, import.meta.url),
        path.join(dir, "scripts", name),
      );
    fs.copyFileSync(
      new URL("../wrangler.jsonc", import.meta.url),
      path.join(dir, "wrangler.jsonc"),
    );
    const result = spawnSync(
      process.execPath,
      [path.join(dir, "scripts", "setup.mjs")],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    const state = JSON.parse(
      fs.readFileSync(path.join(dir, ".local", "state.json"), "utf8"),
    );
    const config = JSON.parse(
      fs.readFileSync(path.join(dir, "wrangler.local.jsonc"), "utf8"),
    );
    assert.equal(config.name, state.name);
    assert.equal(
      config.vars.AUTH_HASH,
      createHash("sha256").update(state.token).digest("hex"),
    );
    assert.ok(!result.stdout.includes(state.token));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
