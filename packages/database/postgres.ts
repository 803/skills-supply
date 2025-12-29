import chalk from "chalk"
import { Kysely } from "kysely"
import { PostgresJSDialect } from "kysely-postgres-js"
import type { Sql } from "postgres"
import { debug } from "./log"

const EVENT_LEVELS_SIGNS = {
	error: "🔴",
	query: "🟢",
} as const

const EVENT_LEVELS = Object.keys(
	EVENT_LEVELS_SIGNS,
) as (keyof typeof EVENT_LEVELS_SIGNS)[]

export function initKysely<T>(pg: Sql): Kysely<T> {
	return new Kysely<T>({
		dialect: new PostgresJSDialect({
			postgres: pg,
		}),

		log(event) {
			if (
				EVENT_LEVELS.includes(event.level) &&
				process.env.NODE_ENV === "development"
			) {
				debug(
					__filename,
					`${EVENT_LEVELS_SIGNS[event.level]} ${chalk.yellow(event.queryDurationMillis)} ${chalk.dim(event.query.sql)}`,
				)
			}
		},
	})
}
