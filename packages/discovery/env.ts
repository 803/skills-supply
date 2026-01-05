import path from "node:path"
import { fileURLToPath } from "node:url"
import dotenv from "dotenv"
import { z } from "zod"

const CURRENT_DIR = path.dirname(fileURLToPath(import.meta.url))
const ENV_PATH = path.resolve(CURRENT_DIR, "..", ".env")

const dotenvResult = dotenv.config({ path: ENV_PATH })

const str = () => z.string().trim().min(1)

export const schema = z.object({
	DATABASE_POOL_SIZE: z.coerce.number().int().positive().max(50).optional().default(2),
	DATABASE_URL: str(),
	GITHUB_TOKEN: str().optional(),
	NODE_ENV: z.enum(["development", "production", "preview"]).default("development"),
	SKILLSMP_API_KEY: str().optional(),
})

const mergedEnv = {
	...(dotenvResult.parsed ?? {}),
	...process.env,
}

export const env = schema.parse(mergedEnv)
