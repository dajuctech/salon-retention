// Local stand-in for Vercel Cron: `pnpm jobs` runs the daily jobs and sends due messages once.
import "dotenv/config";
import { unscopedDb } from "../src/server/db";
import { runDailyJobs } from "../src/server/platform/daily";
import { dispatchDue } from "../src/server/platform/dispatcher";
import { runRetention } from "../src/server/platform/retention";
import { ensurePlatformTemplates } from "../src/server/platform/templates";

async function main() {
  await ensurePlatformTemplates();
  console.log("daily:", await runDailyJobs());
  console.log("dispatch:", await dispatchDue({ limit: 500 }));
  console.log("retention:", await runRetention());
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => unscopedDb().$disconnect());
