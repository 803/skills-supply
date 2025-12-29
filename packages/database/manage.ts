import { execSync } from "node:child_process"
import { promises as fs } from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { Command } from "commander"
import { FileMigrationProvider, type Kysely, Migrator } from "kysely"
import { env } from "./env"
import { db as database } from "./index"
import { debug } from "./log"
import type Database from "./models/Database"

interface Config {
	db: Kysely<Database>
	dbUrl: string
	codegen: "kanel-kysely" | "kysely-codegen"
	drop: "schema" | "file"
}

interface ExtendedConfig extends Config {
	folder: string
	migrator: Migrator
}

const PROGRAM = new Command()
	.option("--no-auto-biome")
	.option("--no-auto-codegen")
	.option("--ci")
	.argument("<string>")

const ACTIONS: {
	[key: string]: (config: ExtendedConfig) => Promise<void>
} = {
	biome: async ({ folder }) => {
		execSync(`${biomeBin()} check --write ${folder}`, {
			stdio: "inherit",
		})
	},
	codegen: async ({ codegen, dbUrl, folder }) => {
		if (codegen === "kanel-kysely") {
			execSync(`${kanelBin()} -d ${dbUrl} -o ${path.join(folder, "models")}`, {
				cwd: folder,
				stdio: "inherit",
			})
		} else if (codegen === "kysely-codegen") {
			execSync(
				`${kyselyCodegenBin()} --url ${dbUrl} --out-file=${path.join(folder, "models/index.d.ts")}`,
				{ cwd: folder, stdio: "inherit" },
			)
		} else {
			throw new Error()
		}
	},
	down: async ({ migrator }) => {
		debug(__filename, await migrator.migrateDown())
	},
	downup: async ({ migrator }) => {
		debug(__filename, await migrator.migrateDown())
		debug(__filename, await migrator.migrateUp())
	},
	drop: async ({ drop, db, dbUrl }) => {
		if (drop === "schema") {
			await db.schema.dropSchema("public").ifExists().cascade().execute()
			await db.schema.createSchema("public").execute()
		} else if (drop === "file") {
			await fs.writeFile(dbUrl, "")
		} else {
			throw new Error()
		}
	},
	latest: async ({ migrator }) => {
		debug(__filename, await migrator.migrateToLatest())
	},
	reset: async (config) => {
		await ACTIONS.drop(config)
		await ACTIONS.latest(config)
	},
	up: async ({ migrator }) => {
		debug(__filename, await migrator.migrateUp())
	},
}

const CURRENT_DIR = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(CURRENT_DIR, "../..")
const BIN_EXT = process.platform === "win32" ? ".cmd" : ""

function binPath(name: string): string {
	return path.join(REPO_ROOT, "node_modules", ".bin", `${name}${BIN_EXT}`)
}

function kanelBin(): string {
	return binPath("kanel")
}

function kyselyCodegenBin(): string {
	return binPath("kysely-codegen")
}

function biomeBin(): string {
	return binPath("biome")
}

async function run() {
	const p = PROGRAM.parse()
	const action = p.args[0]
	const { autoCodegen, autoBiome, ci } = p.opts()
	if (!action || !(action in ACTIONS)) {
		throw new Error(`Unknown action: ${action ?? "<missing>"}`)
	}
	const folder = CURRENT_DIR
	const config: Config = {
		codegen: "kanel-kysely",
		db: database,
		dbUrl: env.DATABASE_URL,
		drop: "schema",
	}
	const extendedConfig = {
		folder,
		migrator: new Migrator({
			db: config.db,
			provider: new FileMigrationProvider({
				fs,
				migrationFolder: path.join(folder, "migrations"),
				path,
			}),
		}),
		...config,
	}
	const actions = [action]
	if (!ci) {
		if (autoCodegen) {
			actions.push("codegen")
		}
		if (autoBiome) {
			actions.push("biome")
		}
	}
	const uniquedActions = [...new Set(actions.reverse())].reverse()
	for (const a of uniquedActions) {
		await ACTIONS[a](extendedConfig)
	}
	await config.db.destroy()
	process.exit(0)
}

run()
