import { env } from "cloudflare:workers";
import { apiUser } from "@/app/account-server";
import { reviewCacheHandler } from "@/lib/review-cache-api.mjs";
async function handle(request: Request) {return reviewCacheHandler(request,{db:env.DB,objects:env.SNAPSHOTS,authenticate:apiUser});}
export {handle as GET,handle as PUT};
