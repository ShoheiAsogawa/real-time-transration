import fs from "node:fs";

const migration = fs.readFileSync("migrations/0001_b2b_usage.sql", "utf8");
const api = fs.readFileSync("functions/api/[[path]].js", "utf8");

const checks = [
  {
    name: "pharmacy metadata-only DB constraint",
    ok: migration.includes("CHECK (industry != 'pharmacy' OR history_retention_mode = 'metadata_only')")
  },
  {
    name: "plan seed includes Free daily/monthly/session limits",
    ok: migration.includes("('free', 'Free Trial', 0, 10, 3, 180, 1, 1, 0, 0)")
  },
  {
    name: "plan seed includes Lite daily/monthly/session limits",
    ok: migration.includes("('lite', 'Business Lite', 9800, 300, 30, 600, 3, 1, 25, 1)")
  },
  {
    name: "content payload guard exists",
    ok: api.includes("function rejectContentPayload")
  },
  {
    name: "content payload forbidden keys include transcript/translation/audio/messages/media",
    ok: ["transcript", "translation", "audio", "messages", "media"].every((key) => api.includes(`"${key}"`))
  },
  {
    name: "heartbeat payload is allowlisted",
    ok: api.includes('new Set(["activeAudioSeconds", "silenceSeconds"])')
  },
  {
    name: "end payload is allowlisted",
    ok: api.includes('new Set(["reason"])')
  },
  {
    name: "stale session cleanup exists",
    ok: api.includes("closeStaleSessions") && api.includes("stale_ended")
  },
  {
    name: "start reserves 60 seconds",
    ok: api.includes("const reserveSeconds = 60")
  }
];

const failed = checks.filter((check) => !check.ok);
for (const check of checks) {
  console.log(`${check.ok ? "ok" : "fail"} - ${check.name}`);
}

if (failed.length) {
  console.error(`Business-rule smoke check failed: ${failed.length} issue(s).`);
  process.exit(1);
}
