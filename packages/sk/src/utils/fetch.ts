import { sleep } from "@/utils/sleep"

export async function fetchWithRetry(
	url: string,
	options?: RequestInit,
	retries = 3,
): Promise<Response> {
	let lastError: unknown = null
	for (let attempt = 0; attempt < retries; attempt += 1) {
		try {
			return await fetch(url, options)
		} catch (error) {
			lastError = error
			if (attempt < retries - 1) {
				await sleep(1000 * (attempt + 1))
			}
		}
	}
	throw lastError instanceof Error ? lastError : new Error("Request failed")
}
