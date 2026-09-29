// Push selected variables from frontend/.env.local into a Vercel environment
// without the trailing CR/LF that shell pipes add on Windows (a stray "\r" in
// STRIPE_SECRET_KEY produced "Invalid character in header content" in
// production on 2026-09-29). Values are passed on stdin and never printed.
//
//   node scripts/vercel_push_env.mjs production STRIPE_SECRET_KEY STRIPE_PRICE_SOLO_MONTHLY ...
//
// Run from the repo root or frontend/; a new deployment is needed afterwards
// for serverless functions to see the new values.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const [target = "production", ...names] = process.argv.slice(2);
if (names.length === 0) {
  console.error("usage: node scripts/vercel_push_env.mjs <environment> NAME [NAME...]");
  process.exit(2);
}
const frontend = fs.existsSync("frontend") ? "frontend" : ".";
const envFile = path.join(frontend, ".env.local");
const env = Object.fromEntries(
  fs
    .readFileSync(envFile, "utf8")
    .split(/\r?\n/)
    .filter((l) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(l))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    }),
);

for (const name of names) {
  const value = env[name];
  if (!value) {
    console.log(`${name}: not in ${envFile}, skipped`);
    continue;
  }
  if (/[\r\n]/.test(value)) {
    console.log(`${name}: value contains a line break, refusing`);
    continue;
  }
  const r = spawnSync("npx", ["--yes", "vercel", "env", "add", name, target, "--force"], {
    cwd: frontend,
    input: value, // no trailing newline
    encoding: "utf8",
    shell: true,
  });
  const out = `${r.stdout}\n${r.stderr}`;
  const ok = /Overrode|Added/.test(out);
  console.log(`${name}: ${ok ? "set" : "FAILED"} (${target})${ok ? "" : "\n" + out.replace(value, "<value>").slice(0, 300)}`);
}
