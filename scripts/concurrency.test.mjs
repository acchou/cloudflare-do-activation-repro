import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { summarizeConcurrency } from "./concurrency-summary.mjs";
const evidence = new URL(
  "../evidence/2026-10-26/concurrency/",
  import.meta.url,
);
const rows = fs
  .readFileSync(new URL("samples.ndjson", evidence), "utf8")
  .trim()
  .split("\n")
  .map(JSON.parse);
const summary = summarizeConcurrency(rows);

test("complete concurrency population supports every claimed blocked follow-up", () => {
  assert.deepEqual(
    summary,
    JSON.parse(fs.readFileSync(new URL("summary.json", evidence), "utf8")),
  );
  assert.equal(rows.length, 873);
  assert.equal(new Set(rows.map((r) => r.id)).size, rows.length);
  assert.equal(summary.failures, 0);
  assert.equal(summary.primaryRequests, 832);
  assert.equal(summary.incompleteGroups, 0);
  assert.equal(summary.groupsWithFollowers, 11);
  assert.equal(summary.followups, 33);
  assert.equal(
    new Set(rows.filter((r) => r.role === "primary").map((r) => r.key)).size,
    64,
  );
  assert.equal(new Set(summary.groups.map((g) => g.targetObjectId)).size, 3);
  assert.equal(Math.max(...summary.groups.map((g) => g.primaryRpcMs)), 9913);
  for (const group of summary.groups) {
    assert.equal(group.primarySequence, 1);
    assert.deepEqual(group.followers.map((r) => r.role).sort(), [
      "direct-worker",
      "other-caller",
      "same-caller",
    ]);
    for (const row of group.followers) {
      assert.ok(row.dispatchedBeforePrimaryHandler);
      assert.ok(row.sameObject && row.sameInstance);
      assert.equal(row.handlerOffsetMs, 0);
    }
  }
});

test("each sanitized native handler event joins its exact recorded request", () => {
  let handlers = 0;
  for (const filename of fs.readdirSync(new URL("traces/", evidence))) {
    const trace = JSON.parse(
      fs.readFileSync(new URL(`traces/${filename}`, evidence), "utf8"),
    );
    assert.equal(new Set(trace.map((r) => r.traceId)).size, 1);
    const targetEvents = trace.filter(
      (r) => r.operation === "placement.target",
    );
    assert.equal(targetEvents.length, 4);
    for (const event of targetEvents) {
      const row = rows.find((r) => r.id === event.id);
      assert.ok(row);
      assert.equal(event.objectId, row.result.target.objectId);
      assert.equal(event.born, row.result.target.born);
      assert.equal(event.entered, row.result.target.entered);
      assert.equal(event.sequence, row.result.target.sequence);
      handlers++;
    }
  }
  assert.equal(handlers, 8);
});

test("summary exposes failed and incomplete groups instead of claiming success", () => {
  const groupId = summary.groups[0].groupId;
  const group = rows.filter((r) => r.groupId === groupId);
  const damaged = structuredClone(group);
  damaged[0].result = { status: 500 };
  const result = summarizeConcurrency(damaged);
  assert.equal(result.failures, 1);
  assert.equal(result.incompleteGroups, 1);
  assert.equal(result.groupsWithFollowers, 0);
  assert.equal(summarizeConcurrency(group.slice(0, 2)).incompleteGroups, 1);
});
