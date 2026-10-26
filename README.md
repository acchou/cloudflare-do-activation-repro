# Cloudflare Durable Object activation latency reproduction

Upstream report: [cloudflare/workerd#8010](https://github.com/cloudflare/workerd/issues/8010).

A tiny hosted-Workers reproduction of **multi-second delays before a Durable Object's JavaScript RPC handler begins**. In the captured run, an empty SQLite-backed target took **27.844 seconds** to answer; its native invocation reported **0 ms CPU**. Immediate repeats were fast.

This is a hosted-platform observation. It has not been reproduced in local `workerd`, and the evidence does not establish a particular internal cause.

## What runs

```text
Node client → HTTP Worker → Caller Durable Object → Target Durable Object
```

`Target.ping()` synchronously reads one never-written key and returns timestamps, an object-instance UUID, an isolate UUID, a sequence counter, and its object ID. There are **no application writes, migrations, timers, external calls, or initialization tasks in that handler**. The namespace is provisioned as SQLite-backed with an initial Wrangler migration.

`Caller.run()` measures the exact awaited RPC. The client separately measures HTTP wall time. An authenticated `/locate` endpoint fetches Cloudflare's `/cdn-cgi/trace` from inside the objects, outside timed ping calls. Native Cloudflare spans independently corroborated all 72 target locations in the recorded study.

The Worker preserves the measured implementation (formatting only). The public runner is a smaller idle/repeat harness; it is **not** the original three-stage placement-study driver.

## Captured evidence

The [recorded study](evidence/2026-10-26/README.md) includes **all 2,016 synthetic probe records**, their native location mapping, and four compact trace exports.

| Calls                                    | Count | Median |   Maximum | Calls >1 second |
| ---------------------------------------- | ----: | -----: | --------: | --------------: |
| First handler call on an object instance |   416 | 104 ms | 27,844 ms |              18 |
| Later calls on the same instance         | 1,600 |  58 ms |    583 ms |               0 |

One fresh `enam` identity placed in ORD repeatedly stalled. In six controlled idle/reopen pairs, it took **3.726–16.925 seconds on five first calls**; all six immediate repeats were **≤83 ms**. Both original and newly created callers encountered delays. Other objects remained fast in the same trials.

Changing identities and location hints did not reliably eliminate the problem. An earlier IAD object recovered without changing identity, while its replacement in ORD developed its own stalls. This is related context for [workerd #7607](https://github.com/cloudflare/workerd/issues/7607), but differs from that report's delays on already-running targets. An object can reactivate in an existing JS isolate; object activation and isolate cold start are separate measurements here.

## Run

The CLI is pinned to Wrangler 4.151.1, matching the recorded run. Its Miniflare dependency uses an `undici` 7.30.1 override for published security fixes; this packaging patch does not alter the measured Worker source or historical evidence.

Requires Node.js 22 or later and a Cloudflare account with Workers and SQLite Durable Objects enabled. This deploys a small billable Worker in your account; the cleanup command deletes only the randomly named Worker created by setup.

```sh
npm ci
npm run check
npm test
npx wrangler login
npm run setup
npm run deploy
npm run probe
npm run cleanup
```

If your login has multiple accounts, set `CLOUDFLARE_ACCOUNT_ID` when running `npm run setup`. Setup writes the selected account ID, a random Worker name, and a SHA-256 verifier to **ignored** `wrangler.local.jsonc`. Its bearer token remains in **ignored** `.local/state.json`; it is never printed. The checked-in config has no account ID or usable credential.

The default probe creates two targets for each of `auto`, `wnam`, `enam`, and `weur`, then runs six idle/repeat cycles, rotating four caller identities. For a broader sample:

```sh
npm run probe -- --objects-per-hint 6 --cycles 10 --idle-ms 25000
```

The packaged harness was live-checked on 2026-10-26 with 28 probes, no errors, and a 649 ms maximum. That short functional check did not reproduce a long stall; the captured traces above come from the larger recorded study.

The failure is intermittent and identity-dependent. A run without a long delay does not disprove it. Fresh runs create fresh object identities. To vary placement, change `--hints`, for example:

```sh
npm run probe -- --hints wnam,enam --objects-per-hint 6 --cycles 10
```

Location hints are best effort and apply on initial placement; changing a hint does not move an existing object's state. See [Cloudflare's location documentation](https://developers.cloudflare.com/durable-objects/reference/data-location/).

Results go to `.local/runs/<timestamp>/samples.ndjson`, with a manifest containing the generated identities. The manifest and samples contain no bearer token. A failed request is recorded and makes the runner exit nonzero.

```sh
npm run summary                                     # checked-in study
npm run summary -- .local/runs/<timestamp>/samples.ndjson
```

For another isolated deployment, run cleanup first, then remove `.local/state.json` and `wrangler.local.jsonc`, and run setup again. Existing local run records can be retained.

## Inspect a slow call

1. Retain its `probeId` from the runner output and the matching sample row.
2. In the Worker's Cloudflare Observability logs, search that probe ID. The structured `placement.caller` and `placement.target` events carry it.
3. Save the associated trace ID, native spans, Worker version, caller/target object IDs, and colos.
4. Compare the caller's awaited `rpcMs` and client `clientMs`, then locate the native target invocation and the `placement.target` handler-entry event.

In the 27.844-second example, the caller dispatched at **20:27:02.142 UTC**, and the target handler began at **20:27:29.957 UTC**. The native target invocation occupied 27.830 seconds with 0 ms CPU. In another 11.875-second example, the native target span was only 2 ms: the wait was earlier in dispatch. These locate different pre-handler portions of the platform path; neither identifies an internal root cause.

Cross-host timestamps depend on clock alignment. Client wall time and the caller's awaited duration independently confirm the delay. Short handler work can appear as 0 ms because of timer resolution. Native invocation/session duration alone is not treated as request latency.

## Scope of public data

Everything under `evidence/` belongs to synthetic objects in a deleted temporary Worker. Object IDs, trace IDs, timestamps, version IDs and colos are retained so Cloudflare can investigate. Credentials, account identifiers, local paths, IP addresses, and unrelated application logs are excluded. The evidence README documents the export schema and limitations.
