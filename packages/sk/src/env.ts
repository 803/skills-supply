export const SK_BASE_URL = normalizeBaseUrl(
	process.env.SK_BASE_URL ?? "https://api.skills.supply",
)

function normalizeBaseUrl(baseUrl: string): string {
	return baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl
}
