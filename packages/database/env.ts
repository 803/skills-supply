import { z } from "zod"

const str = () => z.string().trim().min(1)
// const toBool = (x: string | undefined) => !(x && ["false", "f"].includes(x))

export const schema = z.object({
	// Database
	DATABASE_POOL_SIZE: z.coerce.number().int().positive().max(50).optional().default(2),
	DATABASE_URL: str(),
	// General
	NODE_ENV: z.enum(["development", "production", "preview"]).default("development"),
})

export const env = schema.parse(process.env)
