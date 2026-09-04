import { clerkSetup } from "@clerk/testing/playwright";
import fs from "fs";
import path from "path";

// Loads Clerk keys from the gitignored .env.e2e (values Vercel redacts on
// pull are skipped) and obtains a Clerk Testing Token — the official way to
// get past bot protection in automated tests. Runs once before all projects.
export default async function globalSetup() {
  const envPath = path.join(__dirname, "../.env.e2e");
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, "utf-8").split(/\r?\n/)) {
      const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)="?([^"]*)"?$/);
      if (!m || m[2] === "[SENSITIVE]" || !m[2]) continue;
      process.env[m[1]] ??= m[2];
    }
  }
  if (!process.env.CLERK_SECRET_KEY || !process.env.CLERK_PUBLISHABLE_KEY) {
    console.warn("[global.setup] Clerk keys missing — authenticated projects will fail");
    return;
  }
  await clerkSetup();
}
