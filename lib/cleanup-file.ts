import { rm } from "node:fs/promises";

export async function removeForCleanup(filename: string, recursive = false) {
  try {
    await rm(filename, { force: true, recursive });
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return true;
    console.error("Media cleanup will retry", code ?? "UNKNOWN");
    return false;
  }
}
