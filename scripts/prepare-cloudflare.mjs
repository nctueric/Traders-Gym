// Generate deployable config from the tested build; does not create resources or deploy.
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const args = Object.fromEntries(process.argv.slice(2).map(value => { const split = value.indexOf("="); return [value.slice(0, split), value.slice(split + 1)]; }));
const databaseId = args["--database-id"], clientId = args["--google-client-id"], bucket = args["--bucket"] || "traders-gym-snapshots";
const personalEmail = args["--personal-email"], accountId = args["--account-id"];
if (!/^[a-f0-9-]{36}$/i.test(databaseId || "") || databaseId === "00000000-0000-4000-8000-000000000000" || (!personalEmail && !/^[\w-]+\.apps\.googleusercontent\.com$/.test(clientId || "")) || (personalEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(personalEmail)) || (clientId && !/^[\w-]+\.apps\.googleusercontent\.com$/.test(clientId)) || !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket) || !/^[a-f0-9]{32}$/.test(accountId || "")) {
  throw new Error("Provide --account-id=<Cloudflare account> --database-id=<D1 UUID> and --personal-email=<email> and/or --google-client-id=<Web Client ID>");
}
const config = JSON.parse(await readFile("dist/server/wrangler.json", "utf8"));
config.name = "traders-gym";
config.account_id = accountId;
// Keep the compatibility date used by the tested build and pinned workerd binary.
config.workers_dev = true;
config.ratelimits = [{ name: "MARKET_RATE_LIMITER", namespace_id: "20261007", simple: { limit: 120, period: 60 } }];
config.preview_urls = false;
config.d1_databases = [{ binding: "DB", database_name: "traders-gym", database_id: databaseId, migrations_dir: "../../drizzle" }];
config.r2_buckets = [{ binding: "SNAPSHOTS", bucket_name: bucket }];
const domain = args["--domain"] || "tradergym.app";
if (domain && domain !== "tradergym.app") throw new Error("Only the configured tradergym.app domain is supported");
if (args["--applications-open"] && !["true", "false"].includes(args["--applications-open"])) throw new Error("--applications-open must be true or false");
if (args["--applications-open"] === "true" && (!clientId || !domain)) throw new Error("Applications require the production Google client and domain");
if (args["--open-google-login"] && !["true", "false"].includes(args["--open-google-login"])) throw new Error("--open-google-login must be true or false");
config.routes = domain ? [{ pattern: domain, custom_domain: true }, { pattern: `www.${domain}`, custom_domain: true }] : [];
config.vars = { ...(personalEmail ? { PERSONAL_PASSWORD_LOGIN: "true", PERSONAL_LOGIN_EMAIL: personalEmail.toLowerCase() } : {}),
  ...(clientId ? { GOOGLE_CLIENT_ID: clientId } : {}), APPLICATIONS_OPEN: args["--applications-open"] || "false", OPEN_GOOGLE_LOGIN: args["--open-google-login"] || "false" };
if(args['--snapshot-retention'] && !['true','false'].includes(args['--snapshot-retention'])) throw new Error('--snapshot-retention must be true or false');
config.vars.SNAPSHOT_RETENTION_ENABLED=args['--snapshot-retention'] || 'false';
config.triggers={crons:config.vars.SNAPSHOT_RETENTION_ENABLED==='true'?['15 * * * *']:[]};
config.observability = { enabled: false };
await writeFile("dist/server/wrangler.cloudflare.json", JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
console.log(`Prepared ${resolve("dist/server/wrangler.cloudflare.json")}; no resources created, no deployment performed.`);
