import { db } from "@skills-supply/database"
import { Hono } from "hono"
import { authenticateBearer } from "@/services/auth"
import { hashToken } from "@/utils/hash"

export const accountRoutes = new Hono()

accountRoutes.get("/api/me", async (c) => {
	const user = await authenticateBearer(c.req.header("Authorization"))
	if (!user) {
		return c.text("Unauthorized", 401)
	}

	return c.json({
		email: user.email,
		username: user.username,
	})
})

accountRoutes.post("/api/tokens/revoke", async (c) => {
	const authHeader = c.req.header("Authorization")
	const token = parseBearerToken(authHeader)
	if (!token) {
		return c.text("Unauthorized", 401)
	}

	await db
		.updateTable("api_tokens")
		.set({ revoked_at: new Date() })
		.where("token_hash", "=", hashToken(token))
		.execute()

	return new Response(null, { status: 204 })
})

function parseBearerToken(header: string | null | undefined): string | null {
	if (!header) {
		return null
	}

	const [scheme, token] = header.split(" ")
	if (scheme !== "Bearer" || !token) {
		return null
	}

	return token
}
