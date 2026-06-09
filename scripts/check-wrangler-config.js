import fs from "node:fs";

const text = fs.readFileSync("wrangler.toml", "utf8");
const placeholder = 'database_id = "00000000-0000-0000-0000-000000000000"';

if (text.includes(placeholder)) {
  console.error("[error] wrangler.toml still uses the placeholder D1 database_id.");
  console.error("[error] Remove it or replace it with a real D1 database UUID before deploy.");
  process.exit(1);
}

const hasDbBinding = /^\s*\[\[d1_databases\]\]/m.test(text);
if (!hasDbBinding) {
  console.warn("[warn] wrangler.toml has no [[d1_databases]] block.");
  console.warn("[warn] Bind D1 as DB in Cloudflare Pages → Settings → Functions before using B2B usage.");
}
