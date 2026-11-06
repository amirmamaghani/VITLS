/** Daily retention job: expired raw ingest archives and stale rate-limit counters. Schedule on the host (cron / scheduled function). */
import { closeDbExec } from "@agent-native/core/db";
import { loadEnv } from "@agent-native/core/scripts";

import { purgeExpiredArchives } from "../server/lib/ingest/archive.js";
import { purgeStaleRateLimits } from "../server/lib/ingest/rate-limit.js";

loadEnv();

try {
  console.log(`Purged ${await purgeExpiredArchives()} expired raw ingest archive(s).`);
  console.log(`Purged ${await purgeStaleRateLimits()} stale rate-limit counter(s).`);
} finally {
  await closeDbExec();
}
