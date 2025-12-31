import { confirm, isCancel } from "@clack/prompts"
import {
	isManifestNotFoundError,
	loadManifestFromCwd,
	type ManifestLoadResult,
} from "@/src/core/manifest/fs"

export async function loadManifestForUpdate(): Promise<ManifestLoadResult> {
	try {
		return await loadManifestFromCwd({ createIfMissing: false })
	} catch (error) {
		if (!isManifestNotFoundError(error)) {
			throw error
		}

		const shouldCreate = await confirm({
			message: "package.toml not found. Create it?",
		})
		if (isCancel(shouldCreate) || !shouldCreate) {
			throw new Error("Canceled.")
		}

		return await loadManifestFromCwd({ createIfMissing: true })
	}
}
