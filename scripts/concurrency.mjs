import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import path from "node:path";
import { load, local } from "./local.mjs";
const state = load();
if (!state.deployed || state.deletedAt || !state.url)
  throw new Error("Run setup and deploy first.");
const outputDir = path.join(
  local,
  "runs",
  `concurrency-${new Date().toISOString().replaceAll(":", "-")}`,
);
fs.mkdirSync(outputDir, { recursive: true });
const outputFile = (name) => path.join(outputDir, name);
const callers = Array.from({ length: 8 }, () => `caller-${randomUUID()}`);
const targets = ["auto", "wnam", "enam", "weur"].flatMap((hint) =>
  Array.from({ length: 16 }, () => ({
    hint,
    key: `target-${hint}-${randomUUID()}`,
  })),
);
fs.writeFileSync(
  outputFile("design.json"),
  JSON.stringify(
    {
      createdAt: new Date().toISOString(),
      worker: state.name,
      version: state.version,
      callers,
      targets,
      cycles: 12,
      idleMs: 25000,
      followupAfterMs: 1000,
      concurrency: 4,
    },
    null,
    2,
  ),
);
let requests = 0,
  failures = 0,
  triggered = 0,
  max = 0;
async function call(path, input, meta) {
  const started = Date.now();
  let result;
  try {
    const r = await fetch(state.url + path, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${state.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(65000),
    });
    result = {
      status: r.status,
      ray: r.headers.get("cf-ray"),
      ...(await r.json()),
    };
  } catch (e) {
    result = { error: String(e) };
  }
  const ended = Date.now();
  const row = {
    ...meta,
    path,
    ...input,
    started,
    ended,
    clientMs: ended - started,
    result,
  };
  fs.appendFileSync(outputFile("samples.ndjson"), JSON.stringify(row) + "\n");
  requests++;
  if (result.status !== 200) failures++;
  max = Math.max(max, result.rpcMs ?? 0);
  return row;
}
async function group(t, cycle, index) {
  const groupId = randomUUID(),
    caller = callers[index % 4];
  let settled = false;
  const p = call(
    "/probe",
    { ...t, caller, id: randomUUID() },
    { groupId, cycle, role: "primary" },
  ).finally(() => {
    settled = true;
  });
  // A fulfilled primary wins the race so fast requests do not wait for the timer.
  const late = await Promise.race([
    p.then(() => false),
    delay(1000).then(() => true),
  ]);
  if (late && !settled) {
    triggered++;
    const f = await Promise.all([
      call(
        "/probe",
        { ...t, caller, id: randomUUID() },
        { groupId, cycle, role: "same-caller" },
      ),
      call(
        "/probe",
        { ...t, caller: callers[4 + (index % 4)], id: randomUUID() },
        { groupId, cycle, role: "other-caller" },
      ),
      call(
        "/direct",
        { ...t, caller, id: randomUUID() },
        { groupId, cycle, role: "direct-worker" },
      ),
    ]);
    const a = await p;
    console.log(
      JSON.stringify({
        groupId,
        cycle,
        key: t.key,
        primaryMs: a.result.rpcMs,
        primaryClient: a.clientMs,
        followers: f.map((b) => ({
          role: b.role,
          rpcMs: b.result.rpcMs,
          offset: b.result.started - a.result.started,
          finishedBeforePrimary: b.ended < a.ended,
          handlerOffset: b.result.target?.entered - a.result.target?.entered,
          sequence: b.result.target?.sequence,
        })),
      }),
    );
  } else await p;
}
async function round(cycle) {
  let n = 0;
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (n < targets.length) {
        const i = n++;
        await group(
          targets[(i + cycle + targets.length) % targets.length],
          cycle,
          i,
        );
      }
    }),
  );
  console.log(JSON.stringify({ cycle, requests, triggered, failures, max }));
}
for (let i = 0; i < callers.length; i++)
  await call(
    "/probe",
    { hint: "wnam", key: `warm-${i}`, caller: callers[i], id: randomUUID() },
    { role: "caller-warmup" },
  );
await round(-1);
for (let cycle = 0; cycle < 12; cycle++) {
  await delay(25000);
  await round(cycle);
}
fs.writeFileSync(
  outputFile("completion.json"),
  JSON.stringify(
    {
      finishedAt: new Date().toISOString(),
      requests,
      triggered,
      failures,
      max,
    },
    null,
    2,
  ),
);

console.log(`Results: ${outputDir}`);
if (failures) process.exitCode = 1;
