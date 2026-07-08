import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function loadRootEnv(): void {
  try {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
    const content = readFileSync(resolve(root, ".env"), "utf8");
    for (const line of content.split(/\r?\n/)) {
      const match = line.match(/^([^#=]+)=(.*)$/);
      if (!match) {
        continue;
      }
      const key = match[1].trim();
      const value = match[2].trim();
      if (!key || !value) {
        continue;
      }
      const current = process.env[key];
      if (current !== undefined && current.trim() !== "") {
        continue;
      }
      process.env[key] = value;
    }
  } catch {
    // .env optional — rely on process environment when absent
  }
}
