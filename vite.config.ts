import { sites } from "@openai/sites-vite-plugin";
import vinext from "vinext";
import { defineConfig, loadEnv } from "vite";
import hostingConfig from "./.openai/hosting.json";
import { fileURLToPath } from "node:url";
import { localAccountPlugin } from "./server/local-account-plugin.mjs";

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  "00000000-0000-4000-8000-000000000000";

const { d1, r2 } = hostingConfig;

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";

const localBindingConfig = {
  main: "./worker/index.ts",
  compatibility_flags: ["nodejs_compat"],
  d1_databases: d1
    ? [
        {
          binding: d1,
          database_name: "site-creator-d1",
          database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
        },
      ]
    : [],
  r2_buckets: r2
    ? [
        {
          binding: r2,
          bucket_name: "site-creator-r2",
        },
      ]
    : [],
};

export default defineConfig(async ({ command, mode }) => {
  const settings = loadEnv(mode, process.cwd(), "");
  const googleClientId = settings.GOOGLE_CLIENT_ID || "";
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    server: {
      host: "127.0.0.1",
      strictPort: true,
      ...(isCodexSeatbeltSandbox
        ? { watch: { useFsEvents: false, usePolling: true, awaitWriteFinish: { stabilityThreshold: 1200, pollInterval: 200 } } }
        : {}),
    },
    plugins: [
      localAccountPlugin({ openGoogleLogin:settings.OPEN_GOOGLE_LOGIN === "true", mailPreview:settings.LOCAL_MAIL_PREVIEW === "true", resendApiKey:settings.RESEND_API_KEY || "", applicationsOpen: settings.APPLICATIONS_OPEN === "true", personalEmail: settings.LOCAL_PERSONAL_EMAIL || "", passwordHash: Buffer.from(settings.LOCAL_PASSWORD_HASH_BASE64 || "", "base64").toString("utf8"), directory: settings.LOCAL_RECORD_DIRECTORY || fileURLToPath(new URL("../自動儲存/", import.meta.url)), clientId: googleClientId, migrations: fileURLToPath(new URL("./drizzle/", import.meta.url)) }),
      vinext(),
      sites(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        config: { ...localBindingConfig, ...(command === "serve" ? { vars: { LOCAL_ACCOUNT_SERVICE: "true", PERSONAL_PASSWORD_LOGIN: settings.LOCAL_PERSONAL_EMAIL ? "true" : "false", GOOGLE_CLIENT_ID: googleClientId, APPLICATIONS_OPEN: settings.APPLICATIONS_OPEN || "false" } } : {}) },
        inspectorPort: false,
      }),
    ],
  };
});
