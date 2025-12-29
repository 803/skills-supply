import { randomBytes } from "node:crypto"
import type { Database } from "@skills-supply/database"
import { db } from "@skills-supply/database"
import type { Selectable } from "kysely"
import { env } from "../env"
import { generateToken, hashToken } from "../utils/hash"

export type CliAuthSession = Selectable<Database["cli_auth_sessions"]>
export type User = Selectable<Database["users"]>

const SESSION_TTL_MS = env.CLI_AUTH_SESSION_TTL * 1000
const POLL_INTERVAL_SECONDS = 5
const USER_CODE_CHARS = "BCDFGHJKMNPQRSTVWXYZ"

export interface CliSessionCreateResult {
	device_code: string
	user_code: string
	verification_url: string
	expires_in: number
	interval: number
}

export type DeviceTokenResponse =
	| { status: "pending" }
	| { status: "expired" }
	| {
			status: "success"
			token: string
			user_id: string
			username: string
			email: string
	  }
	| { status: "success" }

export async function createCliSession(
	ipAddress: string | null,
	userAgent: string | null,
): Promise<CliSessionCreateResult> {
	const expiresAt = new Date(Date.now() + SESSION_TTL_MS)

	for (let attempt = 0; attempt < 3; attempt += 1) {
		const deviceCode = randomBytes(32).toString("hex")
		const userCode = generateUserCode()

		try {
			await db
				.insertInto("cli_auth_sessions")
				.values({
					device_code: deviceCode,
					expires_at: expiresAt,
					ip_address: ipAddress,
					status: "pending",
					user_agent: userAgent,
					user_code: userCode,
				})
				.execute()

			return {
				device_code: deviceCode,
				expires_in: Math.floor(SESSION_TTL_MS / 1000),
				interval: POLL_INTERVAL_SECONDS,
				user_code: userCode,
				verification_url: `${normalizeBaseUrl(env.WEB_BASE_URL)}/auth/cli`,
			}
		} catch (error) {
			if (attempt === 2) {
				throw error
			}
		}
	}

	throw new Error("Failed to create CLI auth session")
}

export async function verifyCliSession(
	userCode: string,
	userId: string,
): Promise<boolean> {
	const session = await db
		.selectFrom("cli_auth_sessions")
		.selectAll()
		.where("user_code", "=", userCode)
		.executeTakeFirst()

	if (!session) {
		return false
	}

	if (isExpired(session)) {
		await expireSession(session.id)
		return false
	}

	if (session.status === "consumed" || session.status === "expired") {
		return false
	}

	await db
		.updateTable("cli_auth_sessions")
		.set({
			authenticated_at: new Date(),
			status: "authenticated",
			user_id: userId,
		})
		.where("id", "=", session.id)
		.execute()

	return true
}

export async function redeemDeviceCode(deviceCode: string): Promise<DeviceTokenResponse> {
	const session = await db
		.selectFrom("cli_auth_sessions")
		.selectAll()
		.where("device_code", "=", deviceCode)
		.executeTakeFirst()

	if (!session) {
		return { status: "expired" }
	}

	if (isExpired(session)) {
		await expireSession(session.id)
		return { status: "expired" }
	}

	if (!session.user_id || session.status === "pending") {
		return { status: "pending" }
	}

	if (session.status === "consumed" || session.consumed_at) {
		return { status: "success" }
	}

	const user = await db
		.selectFrom("users")
		.select(["id", "email", "username"])
		.where("id", "=", session.user_id)
		.executeTakeFirst()

	if (!user) {
		return { status: "expired" }
	}

	const tokenPrefixValue = tokenPrefixForEnv(env.NODE_ENV)
	const token = `${tokenPrefixValue}${generateToken()}`
	const tokenHash = hashToken(token)

	await db
		.insertInto("api_tokens")
		.values({
			token_hash: tokenHash,
			token_prefix: tokenPrefixValue,
			user_id: session.user_id,
		})
		.execute()

	await db
		.updateTable("cli_auth_sessions")
		.set({
			consumed_at: new Date(),
			status: "consumed",
		})
		.where("id", "=", session.id)
		.execute()

	return {
		email: user.email,
		status: "success",
		token,
		user_id: user.id,
		username: user.username,
	}
}

function generateUserCode(): string {
	const bytes = randomBytes(12)
	let code = ""
	for (const byte of bytes) {
		code += USER_CODE_CHARS[byte % USER_CODE_CHARS.length]
	}

	return `${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8, 12)}`
}

function isExpired(session: CliAuthSession): boolean {
	return session.expires_at.getTime() < Date.now()
}

async function expireSession(sessionId: string): Promise<void> {
	await db
		.updateTable("cli_auth_sessions")
		.set({ status: "expired" })
		.where("id", "=", sessionId)
		.execute()
}

function tokenPrefixForEnv(envName: string): string {
	return envName === "production" ? "ss_prod_" : "ss_stg_"
}

function normalizeBaseUrl(baseUrl: string): string {
	return baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl
}
