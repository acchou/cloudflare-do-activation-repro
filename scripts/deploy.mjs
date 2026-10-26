import fs from "node:fs";
import path from "node:path";
import { load, save, wrangler, local } from "./local.mjs";
const state = load();
if (state.deletedAt)
  throw new Error(
    "This Worker was deleted. Remove local setup files and run setup for a new namespace.",
  );
const output = wrangler(["deploy", "--config", "wrangler.local.jsonc"]);
fs.writeFileSync(path.join(local, "deploy.log"), output, { mode: 0o600 });
console.log(output);
const url = output.match(/https:\/\/[^\s]+\.workers\.dev\b/)?.[0];
if (!url)
  throw new Error(
    "Deployment may have succeeded; URL was not found. Inspect .local/deploy.log before retrying or cleaning up.",
  );
save({
  ...state,
  url,
  deployed: true,
  version: output.match(/Current Version ID:\s*(\S+)/)?.[1],
});
