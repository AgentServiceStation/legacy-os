import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import * as coreSchema from "./schema";
import * as lifecycleSchema from "./lifecycle-schema";

const schema = { ...coreSchema, ...lifecycleSchema };

export function getDb() {
  if (!env.DB) {
    throw new Error(
      "Cloudflare D1 binding `DB` is unavailable. Set the `d1` field in .openai/hosting.json to `DB` or let your control plane inject the real binding values before using the database.",
    );
  }

  return drizzle(env.DB, { schema });
}
