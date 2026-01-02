import { createHash } from "node:crypto"
import path from "node:path"
import type { GitRef } from "@/src/core/packages/types"

export function buildRepoKey(
	type: "github" | "git",
	identity: string,
	ref: GitRef | undefined,
): string {
	return `${type}:${identity}:${refKey(ref)}`
}

export function buildRepoDir(tempRoot: string, key: string, alias: string): string {
	const hash = createHash("sha256").update(key).digest("hex").slice(0, 12)
	const safeAlias = alias
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/g, "-")
		.replace(/^-+/, "")
		.replace(/-+$/, "")
	const dirName = safeAlias ? `${safeAlias}-${hash}` : hash
	return path.join(tempRoot, dirName)
}

function refKey(ref: GitRef | undefined): string {
	if (!ref) {
		return "default"
	}

	return `${ref.type}:${ref.value}`
}
