import { intro, log, note, outro, spinner } from "@clack/prompts"
import { loadManifestFromCwd, saveManifest } from "@/commands/manifest"
import { formatError } from "@/utils/errors"

export async function pkgRemove(alias: string): Promise<void> {
	intro("sksup pkg remove")

	const action = spinner()
	action.start("Updating packages...")

	try {
		const trimmed = alias.trim()
		if (!trimmed) {
			throw new Error("Package alias is required.")
		}

		const manifestResult = await loadManifestFromCwd({ createIfMissing: false })
		if (!(trimmed in manifestResult.manifest.packages)) {
			throw new Error(`Package not found: ${trimmed}`)
		}

		delete manifestResult.manifest.packages[trimmed]
		await saveManifest(manifestResult.manifest, manifestResult.manifestPath)

		action.stop("Package settings updated.")
		log.success(`Removed package: ${trimmed}.`)
		note(`Manifest: ${manifestResult.manifestPath}`, "Updated")
		outro("Done.")
	} catch (error) {
		action.stop("Failed to update packages.")
		process.exitCode = 1
		log.error(formatError(error))
		outro("Package update failed.")
	}
}
