import { load, save, wrangler } from "./local.mjs";
const state = load();
if (state.deletedAt) {
  console.log("This generated Worker was already deleted.");
  process.exit(0);
}
// Only the exact generated name is eligible, checked by load(). No company Worker names.
const output = wrangler(
  ["delete", state.name, "--config", "wrangler.local.jsonc", "--force"],
  "y\n",
);
console.log(output);
save({
  ...state,
  token: "REDACTED_AFTER_DELETION",
  deployed: false,
  deletedAt: new Date().toISOString(),
});
