/**
 * Nick's Tire & Auto — Cron Worker (Railway)
 *
 * Lightweight HTTP scheduler that triggers cron jobs on nickstire.org.
 * Removes the need for in-process setInterval on Vercel, saving ~20-30% memory.
 *
 * Each job calls POST /api/cron/{jobName} on the main site.
 * The actual job logic stays in nickstire.org — this is just the scheduler.
 */

import { CronJob } from "cron";

const SITE_URL = process.env.SITE_URL || "https://nickstire.org";
const CRON_SECRET = process.env.CRON_SECRET || "";

interface JobConfig {
  name: string;
  schedule: string; // cron expression
  enabled: boolean;
}

const JOBS: JobConfig[] = [
  { name: "sms-scheduler",      schedule: "*/5 * * * *",    enabled: true },   // Every 5 min
  { name: "review-requests",    schedule: "*/30 * * * *",   enabled: true },   // Every 30 min
  { name: "daily-report",       schedule: "0 19 * * *",     enabled: true },   // 7 PM daily
  { name: "cleanup",            schedule: "0 */6 * * *",    enabled: true },   // Every 6 hours
  { name: "warranty-alerts",    schedule: "0 8 * * *",      enabled: true },   // 8 AM daily
  { name: "dashboard-sync",     schedule: "*/15 * * * 1-6", enabled: true },   // Every 15 min, Mon-Sat
  { name: "abandoned-forms",    schedule: "*/30 * * * *",   enabled: true },   // Every 30 min
  { name: "stale-lead-followup",schedule: "0 */2 * * 1-6",  enabled: true },   // Every 2h, Mon-Sat
  { name: "statenour-sync",     schedule: "0 */4 * * *",    enabled: true },   // Every 4 hours
  // Disabled by default
  { name: "customer-segmentation", schedule: "0 2 * * 0",   enabled: false },  // Sunday 2 AM
  { name: "retention-90day",    schedule: "0 3 * * 1",      enabled: false },  // Monday 3 AM
];

async function triggerJob(jobName: string): Promise<void> {
  const url = `${SITE_URL}/api/cron/${jobName}`;
  const started = Date.now();

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(CRON_SECRET ? { "x-cron-secret": CRON_SECRET } : {}),
      },
      body: JSON.stringify({ source: "railway-cron", job: jobName, ts: new Date().toISOString() }),
      signal: AbortSignal.timeout(55000), // 55s timeout (Vercel max is 60s)
    });

    const elapsed = Date.now() - started;

    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      console.log(`[CRON] ${jobName} completed in ${elapsed}ms`, data);
    } else {
      const text = await res.text().catch(() => "");
      console.error(`[CRON] ${jobName} failed: ${res.status} (${elapsed}ms)`, text.slice(0, 200));
    }
  } catch (err) {
    const elapsed = Date.now() - started;
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[CRON] ${jobName} error (${elapsed}ms):`, msg);
  }
}

function startScheduler(): void {
  console.log(`[CRON] Starting scheduler — ${JOBS.filter((j) => j.enabled).length}/${JOBS.length} jobs enabled`);
  console.log(`[CRON] Target: ${SITE_URL}`);
  console.log(`[CRON] Auth: ${CRON_SECRET ? "configured" : "none"}`);

  for (const job of JOBS) {
    if (!job.enabled) {
      console.log(`[CRON] Skipped (disabled): ${job.name}`);
      continue;
    }

    const cronJob = new CronJob(
      job.schedule,
      () => triggerJob(job.name),
      null,
      true,
      "America/New_York" // Cleveland timezone
    );

    console.log(`[CRON] Scheduled: ${job.name} — ${job.schedule}`);
  }

  // Health check / keep-alive
  console.log(`[CRON] Scheduler running. PID: ${process.pid}`);
}

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("[CRON] Received SIGTERM, shutting down...");
  process.exit(0);
});

process.on("SIGINT", () => {
  console.log("[CRON] Received SIGINT, shutting down...");
  process.exit(0);
});

startScheduler();
