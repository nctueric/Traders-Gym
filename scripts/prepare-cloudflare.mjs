// Generate deployable config from the tested build; does not create resources or deploy.
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const args = Object.fromEntries(process.argv.slice(2).map(value => { const split = value.indexOf("="); return [value.slice(0, split), value.slice(split + 1)]; }));
const databaseId = args["--database-id"], clientId = args["--google-client-id"], bucket = args["--bucket"] || "traders-gym-snapshots";
const personalEmail = args["--personal-email"], accountId = args["--account-id"];
if (!/^[a-f0-9-]{36}$/i.test(databaseId || "") || databaseId === "00000000-0000-4000-8000-000000000000" || (!personalEmail && !/^[\w-]+\.apps\.googleusercontent\.com$/.test(clientId || "")) || (personalEmail && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(personalEmail) || clientId)) || !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket) || !/^[a-f0-9]{32}$/.test(accountId || "")) {
  throw new Error("Provide --account-id=<Cloudflare account> --database-id=<D1 UUID> and either --personal-email=<email> or --google-client-id=<Web Client ID>");
}
const config = JSON.parse(await readFile("dist/server/wrangler.json", "utf8"));
config.name = "traders-gym";
config.account_id = accountId;
// Keep the compatibility date used by the tested build and pinned workerd binary.
config.workers_dev = true;
config.preview_urls = false;
config.d1_databases = [{ binding: "DB", database_name: "traders-gym", database_id: databaseId, migrations_dir: "../../drizzle" }];
config.r2_buckets = [{ binding: "SNAPSHOTS", bucket_name: bucket }];
config.vars = personalEmail ? { PERSONAL_PASSWORD_LOGIN: "true", PERSONAL_LOGIN_EMAIL: personalEmail.toLowerCase() } : { GOOGLE_CLIENT_ID: clientId };
config.observability = { enabled: false };
await writeFile("dist/server/wrangler.cloudflare.json", JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
console.log(`Prepared ${resolve("dist/server/wrangler.cloudflare.json")}; no resources created, no deployment performed.`);
