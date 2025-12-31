import { consola } from "consola"
import {
	buildParentPromptMessage,
	resolveGlobalManifest,
	resolveLocalManifest,
	warnIfSubdirectory,
} from "@/src/commands/manifest-selection"
import { saveManifest } from "@/src/core/manifest/fs"
import { hasDependency, removeDependency } from "@/src/core/manifest/transform"
import { coerceAlias } from "@/src/core/types/coerce"
import { formatError } from "@/src/utils/errors"

export async function pkgRemove(
	alias: string,
	options: { global: boolean; nonInteractive: boolean },
): Promise<void> {
	consola.info("sk pkg remove")

	try {
		const trimmed = alias.trim()
		if (!trimmed) {
			throw new Error("Dependency alias is required.")
		}

		const coercedAlias = coerceAlias(trimmed)
		if (!coercedAlias) {
			throw new Error(`Invalid alias: ${trimmed}`)
		}

		const selection = options.global
			? await resolveGlobalManifest({
					createIfMissing: false,
					nonInteractive: options.nonInteractive,
					promptToCreate: false,
				})
			: await resolveLocalManifest({
					createIfMissing: false,
					nonInteractive: options.nonInteractive,
					parentPrompt: {
						buildMessage: (projectRoot, cwd) =>
							buildParentPromptMessage(projectRoot, cwd, {
								action: "modify",
								warnAboutSkillVisibility: true,
							}),
					},
					promptToCreate: false,
				})

		if (!options.global) {
			warnIfSubdirectory(selection)
		}

		consola.start("Updating dependencies...")

		if (!hasDependency(selection.manifest, coercedAlias)) {
			throw new Error(`Dependency not found: ${trimmed}`)
		}

		const updated = removeDependency(selection.manifest, coercedAlias)
		await saveManifest(updated, selection.manifestPath, selection.serializeOptions)

		consola.success("Dependency settings updated.")
		consola.success(`Removed dependency: ${trimmed}.`)
		consola.info(`Manifest: ${selection.manifestPath} (updated).`)
		consola.success("Done.")
	} catch (error) {
		process.exitCode = 1
		consola.error(formatError(error))
		consola.error("Package update failed.")
	}
}
