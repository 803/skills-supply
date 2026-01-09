import type { ValidatedDeclaration } from "@/types/declaration"

export function normalizeDeclarationToKey(declaration: ValidatedDeclaration): string {
	const entries: Array<[string, string]> = []

	switch (declaration.type) {
		case "registry": {
			entries.push(["name", declaration.name])
			if (declaration.org) {
				entries.push(["org", declaration.org])
			}
			entries.push(["type", declaration.type])
			entries.push(["version", declaration.version])
			break
		}
		case "github": {
			entries.push(["gh", declaration.gh])
			if (declaration.path) {
				entries.push(["path", declaration.path])
			}
			if (declaration.ref) {
				entries.push(["ref", `${declaration.ref.type}:${declaration.ref.value}`])
			}
			entries.push(["type", declaration.type])
			break
		}
		case "git": {
			if (declaration.path) {
				entries.push(["path", declaration.path])
			}
			if (declaration.ref) {
				entries.push(["ref", `${declaration.ref.type}:${declaration.ref.value}`])
			}
			entries.push(["type", declaration.type])
			entries.push(["url", declaration.url])
			break
		}
		case "local": {
			entries.push(["path", declaration.path])
			entries.push(["type", declaration.type])
			break
		}
		case "claude-plugin": {
			entries.push(["marketplace", declaration.marketplace])
			entries.push(["plugin", declaration.plugin])
			entries.push(["type", declaration.type])
			break
		}
		default: {
			const exhaustive: never = declaration
			return exhaustive
		}
	}

	entries.sort((a, b) => a[0].localeCompare(b[0]))

	return entries.map(([key, value]) => `${key}:${value}`).join(",")
}
