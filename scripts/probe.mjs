import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { parseArgs } from "node:util";
import { load, local } from "./local.mjs";
const { values } = parseArgs({
  options: {
    hints: { type: "string", default: "auto,wnam,enam,weur" },
    "objects-per-hint": { type: "string", default: "2" },
    cycles: { type: "string", default: "6" },
    "idle-ms": { type: "string", default: "25000" },
  },
});
function integer(key, min, max) {
  const value = Number(values[key]);
  if (!Number.isInteger(value) || value < min || value > max)
    throw new Error(`Invalid --${key}`);
  return value;
}
const hints = values.hints.split(",");
if (
  !hints.length ||
  hints.some((h) => !["auto", "wnam", "enam", "weur"].includes(h))
)
  throw new Error("Invalid --hints");
const perHint = integer("objects-per-hint", 1, 100),
  cycles = integer("cycles", 1, 100),
  idleMs = integer("idle-ms", 0, 300000);
const state = load();
if (!state.deployed || !state.url) throw new Error("Run npm run deploy first.");
const callers = Array.from({ length: 4 }, () => "caller-" + randomUUID());
const targets = hints.flatMap((hint) =>
  Array.from({ length: perHint }, () => ({
    hint,
    key: `target-${hint}-${randomUUID()}`,
  })),
);
const outputDir = path.join(
  local,
  "runs",
  new Date().toISOString().replaceAll(":", "-"),
);
fs.mkdirSync(outputDir, { recursive: true });
const filename = path.join(outputDir, "samples.ndjson");
fs.writeFileSync(
  path.join(outputDir, "manifest.json"),
  JSON.stringify(
    {
      worker: state.name,
      version: state.version,
      callers,
      targets,
      cycles,
      idleMs,
    },
    null,
    2,
  ),
);
let failures = 0,
  max = 0,
  probes = 0;
async function call(endpoint, input, phase, round) {
  const started = Date.now();
  let result;
  try {
    const response = await fetch(state.url + endpoint, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + state.token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(60000),
    });
    result = {
      status: response.status,
      ray: response.headers.get("cf-ray"),
      ...(await response.json()),
    };
  } catch (error) {
    result = { error: String(error) };
  }
  const row = {
    phase,
    round,
    ...input,
    started,
    clientMs: Date.now() - started,
    result,
  };
  fs.appendFileSync(filename, JSON.stringify(row) + "\n");
  if (result.status !== 200) failures++;
  if (endpoint === "/probe") {
    probes++;
    max = Math.max(max, result.rpcMs ?? 0);
    if (result.rpcMs >= 1000 || result.status !== 200)
      console.log(
        JSON.stringify({
          phase,
          round,
          key: input.key,
          caller: input.caller,
          probeId: input.id,
          clientMs: row.clientMs,
          rpcMs: result.rpcMs,
          sequence: result.target?.sequence,
          error: result.error,
        }),
      );
  }
}
for (const target of targets) {
  await call(
    "/probe",
    { ...target, caller: callers[0], id: randomUUID() },
    "first-contact",
    -1,
  );
  await call(
    "/locate",
    { ...target, caller: callers[0], id: randomUUID() },
    "location",
    -1,
  );
}
for (let round = 0; round < cycles; round++) {
  await delay(idleMs);
  for (let j = 0; j < targets.length; j++) {
    const target = targets[(j + round) % targets.length];
    for (const phase of ["after-idle", "immediate-repeat"]) {
      await call(
        "/probe",
        {
          ...target,
          caller: callers[round % callers.length],
          id: randomUUID(),
        },
        phase,
        round,
      );
    }
  }
  console.log(
    JSON.stringify({
      completedCycles: round + 1,
      cycles,
      probes,
      maxRpcMs: max,
      failures,
    }),
  );
}
console.log(`Results: ${filename}`);
if (failures) process.exitCode = 1;
