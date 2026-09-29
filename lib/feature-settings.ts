import { readFileSync } from "node:fs";
// Runtime server-only switch. Missing/invalid configuration fails closed.
export function assignmentsEnabled() {
  try { return JSON.parse(readFileSync(process.env.MEEDOO_FEATURES_FILE || "/etc/meedoo/features.json", "utf8")).assignments === true; }
  catch { return false; }
}
