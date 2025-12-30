import { consola } from "consola"
import { loadManifestFromCwd, saveManifest } from "@/commands/manifest"
import { formatError } from "@/utils/errors"

export async function pkgRemove(alias: string): Promise<void> {
	consola.info("sk pkg remove")
	consola.start("Updating dependencies...")

	try {
		const trimmed = alias.trim()
		if (!trimmed) {
			throw new Error("Dependency alias is required.")
		}

		const manifestResult = await loadManifestFromCwd({ createIfMissing: false })
		if (!(trimmed in manifestResult.manifest.dependencies)) {
			throw new Error(`Dependency not found: ${trimmed}`)
		}

		delete manifestResult.manifest.dependencies[trimmed]
		await saveManifest(manifestResult.manifest, manifestResult.manifestPath)

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
