import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { parseManifest } from "@/core/manifest/parse"
import type { Manifest } from "@/core/manifest/types"
import { serializeManifest } from "@/core/manifest/write"

export interface ManifestLoadResult {
	created: boolean
	manifest: Manifest
	manifestPath: string
}

export class ManifestNotFoundError extends Error {
	constructor(message: string) {
		super(message)
		this.name = "ManifestNotFoundError"
	}
}

export async function loadManifestFromCwd(options: {
	createIfMissing: boolean
}): Promise<ManifestLoadResult> {
	const manifestPath = path.join(process.cwd(), "skills.toml")
	let manifest: Manifest
	let created = false

	try {
		const contents = await readFile(manifestPath, "utf8")
		const parsed = parseManifest(contents, manifestPath)
		if (!parsed.ok) {
			throw new Error(parsed.error.message)
		}

		manifest = parsed.value
	} catch (error) {
		if (isNotFound(error)) {
			if (!options.createIfMissing) {
				throw new ManifestNotFoundError(
					"skills.toml not found in the current directory.",
				)
			}

			manifest = {
				agents: {},
				packages: {},
				sourcePath: manifestPath,
			}
			created = true
		} else {
			throw error
		}
	}

	return { created, manifest, manifestPath }
}

export async function saveManifest(
	manifest: Manifest,
	manifestPath: string,
): Promise<void> {
	const serialized = serializeManifest(manifest)
	await writeFile(manifestPath, serialized, "utf8")
}

function isNotFound(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		(error as { code?: string }).code === "ENOENT"
	)
}

export function isManifestNotFoundError(error: unknown): error is ManifestNotFoundError {
	return (
		error instanceof ManifestNotFoundError ||
		(typeof error === "object" &&
			error !== null &&
			"name" in error &&
			(error as { name?: string }).name === "ManifestNotFoundError")
	)
}
