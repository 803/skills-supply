import postgres from "postgres"
import { env } from "./env"
import type Database from "./models/Database"
import { initKysely } from "./postgres"

export const db = initKysely<Database>(
	postgres(env.DATABASE_URL, { max: env.DATABASE_POOL_SIZE }),
)

export type { default as Database } from "./models/Database"
