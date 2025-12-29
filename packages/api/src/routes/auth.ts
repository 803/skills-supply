import { Hono } from "hono"
import { env } from "../env"
import { authenticateBearer } from "../services/auth"
import {
	createCliSession,
	redeemDeviceCode,
	verifyCliSession,
} from "../services/cli-auth"

export const authRoutes = new Hono()

authRoutes.post("/auth/cli", async (c) => {
	const ipAddress = extractIp(
		c.req.header("x-forwarded-for"),
		c.req.header("x-real-ip"),
		c.req.header("cf-connecting-ip"),
	)
	const userAgent = c.req.header("user-agent") ?? null

	const session = await createCliSession(ipAddress, userAgent)
	return c.json(session, 200)
})

authRoutes.get("/auth/cli", async (c) => {
	const redirectUrl = `${normalizeBaseUrl(env.WEB_BASE_URL)}/auth/cli`
	return c.redirect(redirectUrl, 302)
})

authRoutes.post("/auth/cli/verify", async (c) => {
	const user = await authenticateBearer(c.req.header("Authorization"))
	if (!user) {
		return c.text("Unauthorized", 401)
	}

	const payload = await c.req.json().catch(() => null)
	if (!payload || typeof payload !== "object") {
		return c.text("Invalid payload", 400)
	}

	const { user_code } = payload as { user_code?: unknown }
	const userCode = typeof user_code === "string" ? user_code : null
	if (!userCode) {
		return c.text("Invalid payload", 400)
	}

	const verified = await verifyCliSession(userCode, user.id)
	if (!verified) {
		return c.text("Invalid or expired code", 400)
	}

	return c.json({ status: "ok" }, 200)
})

authRoutes.post("/auth/cli/token", async (c) => {
	const payload = await c.req.json().catch(() => null)
	if (!payload || typeof payload !== "object") {
		return c.text("Invalid payload", 400)
	}

	const { device_code } = payload as { device_code?: unknown }
	const deviceCode = typeof device_code === "string" ? device_code : null
	if (!deviceCode) {
		return c.text("Invalid payload", 400)
	}

	const response = await redeemDeviceCode(deviceCode)
	return c.json(response, 200)
})

function normalizeBaseUrl(baseUrl: string): string {
	return baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl
}

function extractIp(
	xForwardedFor: string | null | undefined,
	xRealIp: string | null | undefined,
	cfConnectingIp: string | null | undefined,
): string | null {
	if (xForwardedFor) {
		const first = xForwardedFor.split(",")[0]?.trim()
		if (first) {
			return first
		}
	}

	if (xRealIp) {
		return xRealIp
	}

	if (cfConnectingIp) {
		return cfConnectingIp
	}

	return null
}
