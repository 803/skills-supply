import { intro, log, note, outro, spinner } from "@clack/prompts"
import { loadManifestFromCwd, saveManifest } from "@/commands/manifest"
import { formatError } from "@/utils/errors"

export async function pkgRemove(alias: string): Promise<void> {
	intro("sksup pkg remove")

	const action = spinner()
	action.start("Updating dependencies...")

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

		action.stop("Dependency settings updated.")
		log.success(`Removed dependency: ${trimmed}.`)
		note(`Manifest: ${manifestResult.manifestPath}`, "Updated")
		outro("Done.")
	} catch (error) {
		action.stop("Failed to update dependencies.")
		process.exitCode = 1
		log.error(formatError(error))
		outro("Package update failed.")
	}
}
