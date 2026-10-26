import { DurableObject } from "cloudflare:workers";
let isolateId: string;
function getIsolateId() {
  return (isolateId ??= crypto.randomUUID());
}
type Input = {
  id: string;
  key: string;
  caller: string;
  hint: "auto" | DurableObjectLocationHint;
};
type Location = { colo: string; loc: string; http: string };
type Located = Location & { born: string; isolateId: string; objectId: string };
type TargetValue = {
  id: string;
  entered: number;
  finished: number;
  born: string;
  isolateId: string;
  sequence: number;
  objectId: string;
  absent: null;
};
type CallerValue = {
  id: string;
  entered: number;
  started: number;
  ended: number;
  rpcMs: number;
  target: TargetValue;
  callerBorn: string;
  callerIsolateId: string;
  callerObjectId: string;
};
async function locate(): Promise<Location> {
  const response = await fetch("https://www.cloudflare.com/cdn-cgi/trace");
  const fields = Object.fromEntries(
    (await response.text())
      .trim()
      .split("\n")
      .map((line) => line.split("=")),
  );
  return { colo: fields.colo, loc: fields.loc, http: fields.http };
}
export class Target extends DurableObject<Env> {
  born = crypto.randomUUID();
  sequence = 0;
  ping(id: string): TargetValue {
    const entered = Date.now();
    const absent = this.ctx.storage.kv.get("never-written");
    const value = {
      id,
      entered,
      finished: Date.now(),
      born: this.born,
      isolateId: getIsolateId(),
      sequence: ++this.sequence,
      objectId: this.ctx.id.toString(),
      absent:
        absent === undefined
          ? null
          : (() => {
              throw new Error("Unexpected data");
            })(),
    };
    console.log({ operation: "placement.target", ...value });
    return value;
  }
  async location(): Promise<Located> {
    return {
      ...(await locate()),
      born: this.born,
      isolateId: getIsolateId(),
      objectId: this.ctx.id.toString(),
    };
  }
}
export class Caller extends DurableObject<Env> {
  born = crypto.randomUUID();
  async run(input: Input): Promise<CallerValue> {
    const entered = Date.now();
    const stub = this.env.TARGET.getByName(
      input.key,
      input.hint === "auto" ? undefined : { locationHint: input.hint },
    );
    const started = Date.now();
    const target = await stub.ping(input.id);
    const ended = Date.now();
    const row = {
      id: input.id,
      entered,
      started,
      ended,
      rpcMs: ended - started,
      target,
      callerBorn: this.born,
      callerIsolateId: getIsolateId(),
      callerObjectId: this.ctx.id.toString(),
    };
    console.log({ operation: "placement.caller", ...row });
    return row;
  }
  async location(input: Input): Promise<{ caller: Located; target: Located }> {
    return {
      caller: {
        ...(await locate()),
        born: this.born,
        isolateId: getIsolateId(),
        objectId: this.ctx.id.toString(),
      },
      target: await this.env.TARGET.getByName(input.key).location(),
    };
  }
}
export default {
  async fetch(request: Request, env: Env) {
    const supplied =
      request.headers.get("Authorization")?.replace(/^Bearer /, "") ?? "";
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(supplied),
    );
    const expected = Uint8Array.from(env.AUTH_HASH.match(/../g)!, (byte) =>
      parseInt(byte, 16),
    );
    if (!crypto.subtle.timingSafeEqual(digest, expected))
      return new Response("Unauthorized", { status: 401 });
    const path = new URL(request.url).pathname;
    if (path === "/health")
      return Response.json({ colo: request.cf?.colo, now: Date.now() });
    const input = await request.json<Input>();
    if (
      ![input.id, input.key, input.caller].every(
        (x) => typeof x === "string" && /^[a-z0-9-]{1,100}$/.test(x),
      ) ||
      !["auto", "wnam", "enam", "weur"].includes(input.hint)
    )
      return new Response("Invalid input", { status: 400 });
    try {
      const started = Date.now();
      if (path === "/direct") {
        const target = await env.TARGET.getByName(
          input.key,
          input.hint === "auto" ? undefined : { locationHint: input.hint },
        ).ping(input.id);
        const ended = Date.now();
        return Response.json({
          id: input.id,
          started,
          ended,
          rpcMs: ended - started,
          target,
          outerMs: ended - started,
          colo: request.cf?.colo,
        });
      }
      const caller = env.CALLER.getByName(input.caller, {
        locationHint: "wnam",
      });
      const value =
        path === "/locate"
          ? await caller.location(input)
          : await caller.run(input);
      return Response.json({
        ...value,
        outerMs: Date.now() - started,
        colo: request.cf?.colo,
      });
    } catch (error) {
      console.error({ operation: "placement.error", id: input.id, error });
      return Response.json(
        {
          error: String(error),
          stack: error instanceof Error ? error.stack : undefined,
        },
        { status: 500 },
      );
    }
  },
} satisfies ExportedHandler<Env>;
