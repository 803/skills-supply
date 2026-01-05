import type { Database } from "@skills-supply/database"
import { db } from "@skills-supply/database"
import type { Selectable } from "kysely"
import { env } from "@/env"
import { parseBasicAuth } from "@/utils/basic-auth"
import { hashToken } from "@/utils/hash"

export type User = Selectable<Database["users"]>

const USER_COLUMNS = [
	"users.id",
	"users.email",
	"users.username",
	"users.created_at",
	"users.updated_at",
] as const

export async function authenticateBasic(
	authorization: string | null | undefined,
): Promise<User | null> {
	const credentials = parseBasicAuth(authorization)
	if (!credentials) {
		return null
	}

	const tokenHash = hashToken(credentials.password)
	const user = await getUserForTokenHash(tokenHash)
	if (!user) {
		return null
	}

	if (credentials.username !== user.id) {
		return null
	}

	return user
}

export async function authenticateBearer(
	authorization: string | null | undefined,
): Promise<User | null> {
	if (!authorization) {
		return null
	}

	const [scheme, token] = authorization.split(" ")
	if (scheme !== "Bearer" || !token) {
		return null
	}

	return getUserForTokenHash(hashToken(token))
}

async function getUserForTokenHash(tokenHash: string): Promise<User | null> {
	const row = await db
		.selectFrom("api_tokens")
		.innerJoin("users", "users.id", "api_tokens.user_id")
		.select([
			"api_tokens.revoked_at",
			"api_tokens.created_at as token_created_at",
			...USER_COLUMNS,
		])
		.where("api_tokens.token_hash", "=", tokenHash)
		.executeTakeFirst()

	if (!row) {
		return null
	}

	if (row.revoked_at) {
		return null
	}

	const tokenAgeMs = Date.now() - row.token_created_at.getTime()
	if (tokenAgeMs > env.API_TOKEN_TTL * 1000) {
		return null
	}

	const { revoked_at, token_created_at, ...user } = row
	return user
}
