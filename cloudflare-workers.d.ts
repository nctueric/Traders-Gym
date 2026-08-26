// Cloudflare supplies the concrete D1 type at deploy time; keep this ambient shim permissive.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type D1Database = any;

interface Fetcher {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

declare module "cloudflare:workers" {
  export const env: { DB?: D1Database; [key: string]: unknown };
}
