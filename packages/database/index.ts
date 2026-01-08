import type { Kysely } from "kysely"
import postgres from "postgres"
import { env } from "./env"
import type Database from "./models/Database"
import { initKysely } from "./postgres"

export function initDb(): Kysely<Database> {
	return initKysely<Database>(
		postgres(env.DATABASE_URL, { max: env.DATABASE_POOL_SIZE }),
	)
}

export const db = initDb()

export type { default as Database } from "./models/Database"
export type { IndexedPackagesId } from "./models/public/IndexedPackages"
