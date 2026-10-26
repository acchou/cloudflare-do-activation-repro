# Recorded hosted-platform run — 2026-10-26

Window: **20:24:17.963–20:31:43.270 UTC**. Worker: `codex-placement-446b6c`. Version: `0c5183b4-c380-4983-bf82-15e3274012ba`. Wrangler: **4.151.1**. Compatibility date: **2026-04-09**. Paid Workers account. SQLite-backed Durable Objects. The Worker and its namespaces were deleted after measurement.

## Study design

- 72 target identities: 24 originals, 24 fresh same-hint replacements, 24 fresh changed-hint replacements.
- Original hints: six each of automatic, `wnam`, `enam`, `weur`. Changed mapping: `wnam` → `enam`; other hints → `wnam`.
- Two original callers in SJC and LAX. Two additional fresh callers in DFW and SJC.
- 72 first-contact probes, 288 baseline probes, 384 interleaved same-hint probes, 576 interleaved three-way probes, 104 caller warmups, 520 caller comparisons, 72 controlled idle/repeat probes. **2,016 RPC probes total.**
- Location/health checks are outside this probe CSV. Native spans corroborated all 72 target locations across 15 colos. 19/24 same-hint replacements and 20/24 changed-hint replacements landed in different colos. No initial-to-final target colo changes were observed.
- There was one Worker deployment throughout these phases. No application service bindings, data, or credentials were used.

## Equal-sized three-way comparison

| Cohort               | Calls | Median ms | p99 ms | Maximum ms | >3 seconds |
| -------------------- | ----: | --------: | -----: | ---------: | ---------: |
| Original             |   192 |        75 |    564 |      6,660 |          1 |
| Fresh, same hints    |   192 |        65 |  7,566 |      7,867 |          4 |
| Fresh, changed hints |   192 |        38 |    603 |      1,417 |          0 |

The changed-hint group mostly moved toward the western-US callers. This is evidence of lower ordinary network latency in this sample, not proof of a cure for rare stalls. Cohorts have unequal exposure outside this equal-sized phase, so raw outlier totals should not be compared across the entire study as failure rates.

## Selected traces

These are compact exports from Cloudflare Observability, preserving native span identity, relationships, timings, CPU/wall measurements where present, colo/object metadata, and the structured caller/target events. They are not complete OTLP export envelopes. Omitted fields include unrelated transport metadata. `time`, `start`, `end`, and application timestamps are Unix milliseconds; `ms`, `wall`, and `cpu` are durations in milliseconds.

| Trace file                                                    | Trace ID                           | Caller → target | Awaited RPC |
| ------------------------------------------------------------- | ---------------------------------- | --------------- | ----------: |
| [11.875 s](traces/trace-11875ms.json)                         | `5e02221d0a74158bdc23d02dd212ce3d` | SJC → IAD       |   11,875 ms |
| [7.566 s replacement](traces/trace-7566ms-replacement.json)   | `1c7b4d4cef630ccb622c22de9f3719b7` | LAX → ORD       |    7,566 ms |
| [27.844 s replacement](traces/trace-27844ms-replacement.json) | `3612b97993290a98b4b86358d61b68d1` | SJC → ORD       |   27,844 ms |
| [1.350 s](traces/trace-1350ms.json)                           | `340bd42eb0926c222310b884ae85f11a` | SJC → LAX       |    1,350 ms |

The 27.844-second target was `f5547a44420b5abe411ba3c4e47654228210248ad98afc31ad68338d03a11c4b`. Its object-instance UUID changed on reopen while a module-isolate UUID could survive. This distinction is directly recorded, rather than inferring a cold isolate from a pause.

In the final targeted follow-up, this ORD replacement was slow on five of six reopens after 25-second idle periods (3,726–16,925 ms), including one from a fresh DFW caller. Its immediate repeats were ≤83 ms. The original IAD object was now ≤119 ms after idle without changing identity. Targets were selected to investigate earlier outliers; this follow-up is not a population-level failure-rate estimate.

## Files and verification

- `samples.csv`: all 2,016 measured probes. Each row joins to trace events through `probe_id`, and to `locations.json` through object ID. Target sequence 1 denotes the first ping on that in-memory object instance; larger sequences denote later pings.
- `locations.json`: compact native-span aggregation by object ID, colo, and entrypoint. `count` counts matching native spans, not RPCs.
- `source-provenance.json`: measured Worker source hash and export scope. The Worker in this repository is a formatting-only copy; the public runner is simplified.
- `traces/`: four selected compact traces. Original identifiers and timestamps are retained for provider diagnosis; these are synthetic objects, with no user data.

Run `npm run summary` and `npm test` to verify the published totals, residency split, and exact trace-to-probe joins. No local paths, account IDs, access tokens, IP addresses, or application logs are included.

## Limits

The data supports a pre-handler platform stall correlated with object activation. It does not prove a storage, scheduler, host, transport, or regional failure. All 18 calls over one second were first pings on their object instances; all 1,600 later pings were ≤583 ms. A short run cannot establish a universally good/bad location. Tracing was enabled throughout; a separate earlier experiment saw multi-second waits with tracing disabled, but those unrelated traces are not part of this export.
