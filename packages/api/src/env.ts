import { z } from "zod"

const str = () => z.string().trim().min(1)

export const schema = z.object({
	API_BASE_URL: str(),
	API_TOKEN_TTL: z.coerce.number().int().positive().optional().default(4_838_400),
	CLI_AUTH_SESSION_TTL: z.coerce.number().int().positive().optional().default(600),
	NODE_ENV: z.enum(["development", "production", "preview"]).default("development"),
	PORT: z.coerce.number().int().positive().max(65535).optional().default(3000),
	REPO_CACHE_DIR: str(),
	REPO_CACHE_TTL: z.coerce.number().int().nonnegative().optional().default(0),
	WEB_BASE_URL: str(),
})

export const env = schema.parse(process.env)
