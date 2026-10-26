import fs from "node:fs";
import path from "node:path";
import { randomBytes, createHash } from "node:crypto";
import { root, local, configFile, stateFile, save } from "./local.mjs";
if (fs.existsSync(stateFile) || fs.existsSync(configFile)) {
  throw new Error(
    "Local setup already exists. Reuse it, or clean up its deployment before removing .local and wrangler.local.jsonc.",
  );
}
fs.mkdirSync(local, { recursive: true, mode: 0o700 });
const name = "do-activation-" + randomBytes(6).toString("hex");
const token = randomBytes(32).toString("hex");
const config = JSON.parse(
  fs.readFileSync(path.join(root, "wrangler.jsonc"), "utf8"),
);
config.name = name;
config.vars.AUTH_HASH = createHash("sha256").update(token).digest("hex");
if (process.env.CLOUDFLARE_ACCOUNT_ID)
  config.account_id = process.env.CLOUDFLARE_ACCOUNT_ID;
fs.writeFileSync(configFile, JSON.stringify(config, null, 2) + "\n", {
  mode: 0o600,
});
save({ name, token, createdAt: new Date().toISOString(), deployed: false });
console.log(
  `Prepared isolated Worker ${name}. Credentials are in ignored local files.`,
);
