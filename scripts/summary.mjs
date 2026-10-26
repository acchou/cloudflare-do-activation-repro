import fs from "node:fs";
import { fileURLToPath } from "node:url";
const filename =
  process.argv[2] ??
  fileURLToPath(new URL("../evidence/2026-10-26/samples.csv", import.meta.url));
const text = fs.readFileSync(filename, "utf8").trim();
let rows;
if (filename.endsWith(".csv")) {
  // Our checked-in CSV has no quoted fields or embedded commas.
  const [head, ...lines] = text.split(/\r?\n/);
  const columns = head.split(",");
  rows = lines.map((line) =>
    Object.fromEntries(line.split(",").map((v, i) => [columns[i], v])),
  );
} else {
  rows = text
    .split("\n")
    .map(JSON.parse)
    .filter(
      (r) =>
        r.result?.status === 200 &&
        Number.isFinite(r.result.rpcMs) &&
        Number.isInteger(r.result.target?.sequence),
    )
    .map((r) => ({
      caller_rpc_ms: r.result.rpcMs,
      target_sequence: r.result.target.sequence,
      phase: r.phase,
    }));
}
function summarize(rows) {
  const v = rows.map((r) => Number(r.caller_rpc_ms)).sort((a, b) => a - b);
  if (!v.length) return { n: 0 };
  const middle = Math.floor(v.length / 2);
  return {
    n: v.length,
    medianMs: v.length % 2 ? v[middle] : (v[middle - 1] + v[middle]) / 2,
    p99Ms: v[Math.ceil(v.length * 0.99) - 1],
    maxMs: v.at(-1),
    over1s: v.filter((x) => x > 1000).length,
  };
}
console.log(
  JSON.stringify(
    {
      all: summarize(rows),
      firstOnInstance: summarize(
        rows.filter((r) => Number(r.target_sequence) === 1),
      ),
      resident: summarize(rows.filter((r) => Number(r.target_sequence) > 1)),
    },
    null,
    2,
  ),
);
