import fs from "node:fs";
import { fileURLToPath } from "node:url";

export function summarizeConcurrency(rows) {
  const grouped = new Map();
  for (const row of rows) {
    if (!row.groupId) continue;
    const group = grouped.get(row.groupId) ?? [];
    group.push(row);
    grouped.set(row.groupId, group);
  }
  const groups = [];
  let incompleteGroups = 0;
  for (const [groupId, members] of grouped) {
    const primary = members.find((r) => r.role === "primary");
    const followers = members.filter((r) => r.role !== "primary");
    if (!followers.length) continue;
    if (
      !primary ||
      members.length !== 4 ||
      members.some((r) => r.result.status !== 200)
    ) {
      incompleteGroups++;
      continue;
    }
    const target = primary.result.target;
    groups.push({
      groupId,
      primaryId: primary.id,
      primaryRpcMs: primary.result.rpcMs,
      targetObjectId: target.objectId,
      primarySequence: target.sequence,
      followers: followers.map((row) => ({
        role: row.role,
        id: row.id,
        rpcMs: row.result.rpcMs,
        dispatchOffsetMs: row.result.started - primary.result.started,
        dispatchedBeforePrimaryHandler: row.result.started < target.entered,
        handlerOffsetMs: row.result.target.entered - target.entered,
        sameObject: row.result.target.objectId === target.objectId,
        sameInstance: row.result.target.born === target.born,
      })),
    });
  }
  return {
    requests: rows.length,
    failures: rows.filter((r) => r.result.status !== 200).length,
    primaryRequests: rows.filter((r) => r.role === "primary").length,
    groupsWithFollowers: groups.length,
    incompleteGroups,
    followups: groups.reduce((n, g) => n + g.followers.length, 0),
    groups,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const filename =
    process.argv[2] ??
    fileURLToPath(
      new URL(
        "../evidence/2026-10-26/concurrency/samples.ndjson",
        import.meta.url,
      ),
    );
  const rows = fs
    .readFileSync(filename, "utf8")
    .trim()
    .split(/\r?\n/)
    .map(JSON.parse);
  console.log(JSON.stringify(summarizeConcurrency(rows), null, 2));
}
