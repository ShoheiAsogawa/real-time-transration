import fs from "node:fs";

const text = fs.readFileSync("wrangler.toml", "utf8");
const placeholder = 'database_id = "00000000-0000-0000-0000-000000000000"';

if (text.includes(placeholder)) {
  console.warn("[warn] wrangler.toml still uses the placeholder D1 database_id.");
  console.warn("[warn] Create a Cloudflare D1 database and replace it before deploy/demo.");
}

const hasDbBinding = /\[\[d1_databases\]\][\s\S]*binding\s*=\s*"DB"/.test(text);
if (!hasDbBinding) {
  console.error("[error] Missing D1 binding DB in wrangler.toml.");
  process.exit(1);
}
