import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import dotenv from "dotenv"
import { z } from "zod"

function findEnvFile(): string | undefined {
	// When running unbundled (tsx/node), import.meta.url is the actual file path
	// When compiled with Bun, import.meta.url is a virtual $bunfs path
	const candidates: string[] = []

	// Try relative to source file (works when unbundled)
	const metaUrl = import.meta.url
	if (!metaUrl.includes("$bunfs")) {
		const sourceDir = path.dirname(fileURLToPath(metaUrl))
		candidates.push(path.resolve(sourceDir, ".env"))
	}

	// Try relative to binary location (works when compiled)
	// For Bun compiled binaries, process.execPath gives the actual binary location
	const binaryPath = path.resolve(process.execPath)
	const binaryDir = path.dirname(binaryPath)
	candidates.push(path.resolve(binaryDir, ".env"))
	// Also try parent of bin/ directory (common structure: pkg/bin/binary, pkg/.env)
	candidates.push(path.resolve(binaryDir, "..", ".env"))

	// Try current working directory
	candidates.push(path.resolve(process.cwd(), ".env"))

	for (const candidate of candidates) {
		if (fs.existsSync(candidate)) {
			return candidate
		}
	}

	return undefined
}

const envPath = findEnvFile()
const dotenvResult = envPath ? dotenv.config({ path: envPath }) : { parsed: {} }

const str = () => z.string().trim().min(1)

export const schema = z.object({
	BROWSERLESS_TOKEN: str().optional(),
	DATABASE_POOL_SIZE: z.coerce.number().int().positive().max(50).optional().default(2),
	DATABASE_URL: str().default(
		"postgres://postgres:postgres@localhost:5877/skillssupply_dev",
	),
	GITHUB_TOKEN: str().optional(),
	NODE_ENV: z.enum(["development", "production", "preview"]).default("development"),
	SKILLSMP_API_KEY: str().optional(),
	SKILLSMP_API_LIMIT: z.coerce.number().int().positive().optional().default(48),
	SKILLSMP_BQL_LIMIT: z.coerce.number().int().positive().optional().default(48),
	SKILLSMP_BQL_TIMEOUT_MS: z.coerce
		.number()
		.int()
		.positive()
		.optional()
		.default(30_000),
})

const mergedEnv = {
	...(dotenvResult.parsed ?? {}),
	...process.env,
}

export const env = schema.parse(mergedEnv)
