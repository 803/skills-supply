import { consola } from "consola"
import { loadManifestFromCwd, saveManifest } from "@/core/manifest/fs"
import { hasDependency, removeDependency } from "@/core/manifest/transform"
import { coerceAlias } from "@/core/types/coerce"
import { formatError } from "@/utils/errors"

export async function pkgRemove(alias: string): Promise<void> {
	consola.info("sk pkg remove")
	consola.start("Updating dependencies...")

	try {
		const trimmed = alias.trim()
		if (!trimmed) {
			throw new Error("Dependency alias is required.")
		}

		const coercedAlias = coerceAlias(trimmed)
		if (!coercedAlias) {
			throw new Error(`Invalid alias: ${trimmed}`)
		}

		const manifestResult = await loadManifestFromCwd({ createIfMissing: false })
		if (!hasDependency(manifestResult.manifest, coercedAlias)) {
			throw new Error(`Dependency not found: ${trimmed}`)
		}

		const updated = removeDependency(manifestResult.manifest, coercedAlias)
		await saveManifest(updated, manifestResult.manifestPath)

		consola.success("Dependency settings updated.")
		consola.success(`Removed dependency: ${trimmed}.`)
		consola.info(`Manifest: ${manifestResult.manifestPath} (updated).`)
		consola.success("Done.")
	} catch (error) {
		process.exitCode = 1
		consola.error(formatError(error))
		consola.error("Package update failed.")
	}
}
