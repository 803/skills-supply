import { execSync } from "node:child_process"
import { promises as fs } from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { Command } from "commander"
import { FileMigrationProvider, type Kysely, Migrator } from "kysely"
import type { ZodError } from "zod"
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

interface BaseError {
	type: string
	message: string
	cause?: BaseError
	rawError?: Error
}

type ValidationError =
	| (BaseError & {
			type: "validation"
			source: "zod"
			field: string
			zodError: ZodError
	  })
	| (BaseError & {
			type: "validation"
			source: "manual"
			field: string
	  })

type IoError = BaseError & {
	type: "io"
	operation: string
	path: string
}

type CommandError = BaseError & {
	type: "command"
	command: string
	exitCode?: number
}

type MigrationError = BaseError & {
	type: "migration"
	action: string
}

type DbManageError = ValidationError | IoError | CommandError | MigrationError

type Result<T> = { ok: true; value: T } | { ok: false; error: DbManageError }

type PrintableError = BaseError & {
	field?: string
	path?: string
	operation?: string
	source?: string
	target?: string
	zodError?: ZodError
}

const PROGRAM = new Command()
	.option("--no-auto-biome")
	.option("--no-auto-codegen")
	.option("--ci")
	.argument("<string>")

const ACTIONS = {
	biome: async ({ folder }): Promise<Result<void>> => {
		return runCommand(`${biomeBin()} check --write ${folder}`, { stdio: "inherit" })
	},
	codegen: async ({ codegen, dbUrl, folder }): Promise<Result<void>> => {
		if (codegen === "kanel-kysely") {
			return runCommand(
				`${kanelBin()} -d ${dbUrl} -o ${path.join(folder, "models")}`,
				{ cwd: folder, stdio: "inherit" },
			)
		}
		if (codegen === "kysely-codegen") {
			return runCommand(
				`${kyselyCodegenBin()} --url ${dbUrl} --out-file=${path.join(folder, "models/index.d.ts")}`,
				{ cwd: folder, stdio: "inherit" },
			)
		}
		return {
			error: {
				field: "codegen",
				message: "Unsupported codegen option.",
				source: "manual",
				type: "validation",
			},
			ok: false,
		}
	},
	down: async ({ migrator }): Promise<Result<void>> => {
		return runMigration("down", async () => migrator.migrateDown())
	},
	downup: async ({ migrator }): Promise<Result<void>> => {
		const down = await runMigration("down", async () => migrator.migrateDown())
		if (!down.ok) {
			return down
		}
		return runMigration("up", async () => migrator.migrateUp())
	},
	drop: async ({ drop, db, dbUrl }): Promise<Result<void>> => {
		if (drop === "schema") {
			try {
				await db.schema.dropSchema("public").ifExists().cascade().execute()
				await db.schema.createSchema("public").execute()
				return { ok: true, value: undefined }
			} catch (error) {
				return {
					error: {
						message: "Schema drop failed.",
						operation: "dropSchema",
						path: "db",
						rawError: error instanceof Error ? error : undefined,
						type: "io",
					},
					ok: false,
				}
			}
		}
		if (drop === "file") {
			try {
				await fs.writeFile(dbUrl, "")
				return { ok: true, value: undefined }
			} catch (error) {
				return {
					error: {
						message: "Failed to clear database file.",
						operation: "writeFile",
						path: dbUrl,
						rawError: error instanceof Error ? error : undefined,
						type: "io",
					},
					ok: false,
				}
			}
		}
		return {
			error: {
				field: "drop",
				message: "Unsupported drop option.",
				source: "manual",
				type: "validation",
			},
			ok: false,
		}
	},
	latest: async ({ migrator }): Promise<Result<void>> => {
		return runMigration("latest", async () => migrator.migrateToLatest())
	},
	reset: async (config): Promise<Result<void>> => {
		const dropped = await ACTIONS.drop(config)
		if (!dropped.ok) {
			return dropped
		}
		return ACTIONS.latest(config)
	},
	up: async ({ migrator }): Promise<Result<void>> => {
		return runMigration("up", async () => migrator.migrateUp())
	},
} satisfies Record<string, (config: ExtendedConfig) => Promise<Result<void>>>

const __filename = fileURLToPath(import.meta.url)
const CURRENT_DIR = path.dirname(__filename)
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

function runCommand(
	command: string,
	options: Parameters<typeof execSync>[1],
): Result<void> {
	try {
		execSync(command, options)
		return { ok: true, value: undefined }
	} catch (error) {
		return {
			error: {
				command,
				exitCode: getExitCode(error),
				message: `Command failed: ${command}`,
				rawError: error instanceof Error ? error : undefined,
				type: "command",
			},
			ok: false,
		}
	}
}

async function runMigration(
	action: string,
	migrate: () => Promise<Awaited<ReturnType<Migrator["migrateUp"]>>>,
): Promise<Result<void>> {
	const result = await migrate()
	debug(__filename, result)
	if (result.error) {
		return {
			error: {
				action,
				message: `Migration ${action} failed.`,
				rawError: result.error instanceof Error ? result.error : undefined,
				type: "migration",
			},
			ok: false,
		}
	}
	return { ok: true, value: undefined }
}

function printError(error: PrintableError): void {
	console.error(formatErrorChain(error))
	printRawErrors(error)
}

function formatErrorChain(error: PrintableError): string {
	return formatErrorChainLines(error, 0).join("\n")
}

function formatErrorChainLines(error: PrintableError, indent: number): string[] {
	const prefix = " ".repeat(indent)
	const detailParts = buildDetailParts(error)
	const details = detailParts.length ? ` (${detailParts.join(", ")})` : ""
	const lines = [`${prefix}[${error.type}] ${error.message}${details}`]

	if (error.zodError) {
		lines.push(`${prefix}  Zod issues:`)
		for (const issue of error.zodError.issues) {
			const pathLabel = issue.path.length > 0 ? issue.path.join(".") : "<root>"
			lines.push(`${prefix}  - ${pathLabel}: ${issue.message}`)
		}
	}

	if (error.cause) {
		lines.push(`${prefix}Caused by:`)
		lines.push(...formatErrorChainLines(error.cause, indent + 2))
	}

	return lines
}

function printRawErrors(error: PrintableError): void {
	if (error.rawError) {
		console.error(error.rawError)
	}
	if (error.cause) {
		printRawErrors(error.cause)
	}
}

function buildDetailParts(error: PrintableError): string[] {
	const details: string[] = []
	if ("field" in error && typeof error.field === "string") {
		details.push(`field=${error.field}`)
	}
	if ("path" in error && typeof error.path === "string") {
		details.push(`path=${error.path}`)
	}
	if ("operation" in error && typeof error.operation === "string") {
		details.push(`operation=${error.operation}`)
	}
	if ("command" in error && typeof error.command === "string") {
		details.push(`command=${error.command}`)
	}
	if ("exitCode" in error && typeof error.exitCode === "number") {
		details.push(`exitCode=${error.exitCode}`)
	}
	if ("action" in error && typeof error.action === "string") {
		details.push(`action=${error.action}`)
	}
	if ("source" in error && typeof error.source === "string") {
		details.push(`source=${error.source}`)
	}
	return details
}

function getExitCode(error: unknown): number | undefined {
	if (error && typeof error === "object" && "status" in error) {
		const status = (error as { status?: unknown }).status
		if (typeof status === "number") {
			return status
		}
	}
	return undefined
}

async function run(): Promise<Result<void>> {
	const p = PROGRAM.parse()
	const action = p.args[0]
	const { autoCodegen, autoBiome, ci } = p.opts()
	if (!action || !(action in ACTIONS)) {
		return {
			error: {
				field: "action",
				message: `Unknown action: ${action ?? "<missing>"}`,
				source: "manual",
				type: "validation",
			},
			ok: false,
		}
	}
	const typedAction = action as keyof typeof ACTIONS
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
	const actions: (keyof typeof ACTIONS)[] = [typedAction]
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
		const actionFn = ACTIONS[a]
		const result = await actionFn(extendedConfig)
		if (!result.ok) {
			return result
		}
	}
	try {
		await config.db.destroy()
	} catch (error) {
		return {
			error: {
				message: "Failed to close database connection.",
				operation: "destroy",
				path: "db",
				rawError: error instanceof Error ? error : undefined,
				type: "io",
			},
			ok: false,
		}
	}
	return { ok: true, value: undefined }
}

run().then((result) => {
	if (!result.ok) {
		printError(result.error)
		process.exit(1)
	}
	process.exit(0)
})
