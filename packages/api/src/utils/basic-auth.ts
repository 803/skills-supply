export interface BasicAuthCredentials {
	username: string
	password: string
}

export function parseBasicAuth(
	header: string | null | undefined,
): BasicAuthCredentials | null {
	if (!header) {
		return null
	}

	const [scheme, encoded] = header.split(" ")
	if (scheme !== "Basic" || !encoded) {
		return null
	}

	const decoded = Buffer.from(encoded, "base64").toString("utf8")
	const separatorIndex = decoded.indexOf(":")
	if (separatorIndex === -1) {
		return null
	}

	const username = decoded.slice(0, separatorIndex)
	const password = decoded.slice(separatorIndex + 1)
	if (!username || !password) {
		return null
	}

	return { password, username }
}
