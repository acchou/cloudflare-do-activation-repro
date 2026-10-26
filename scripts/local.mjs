import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
export const root = fileURLToPath(new URL("..", import.meta.url));
export const local = path.join(root, ".local");
export const configFile = path.join(root, "wrangler.local.jsonc");
export const stateFile = path.join(local, "state.json");
export function save(state) {
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2) + "\n", {
    mode: 0o600,
  });
}
export function load() {
  if (!fs.existsSync(stateFile)) throw new Error("Run npm run setup first.");
  const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  const config = JSON.parse(fs.readFileSync(configFile, "utf8"));
  if (
    state.name !== config.name ||
    !/^do-activation-[a-f0-9]{12}$/.test(state.name)
  ) {
    throw new Error(
      "Generated Worker identity does not match; refusing to continue.",
    );
  }
  return state;
}
export function wrangler(args, input) {
  const cli = path.join(root, "node_modules", "wrangler", "bin", "wrangler.js");
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    input,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(
      result.stderr || result.stdout || `Wrangler exited ${result.status}`,
    );
  return (result.stdout + result.stderr).replace(/\x1b\[[0-9;]*m/g, "");
}
