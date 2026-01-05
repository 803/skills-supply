import { coerceAlias } from "@skills-supply/core"
import { consola } from "consola"
import {
	buildParentPromptMessage,
	resolveGlobalManifest,
	resolveLocalManifest,
	warnIfSubdirectory,
} from "@/commands/manifest-selection"
import { syncWithSelection } from "@/commands/sync"
import { CommandResult, printOutcome } from "@/commands/types"
import { saveManifest } from "@/manifest/fs"
import { hasDependency, removeDependency } from "@/manifest/transform"

export async function pkgRemove(
	alias: string,
	options: { global: boolean; nonInteractive: boolean; sync: boolean },
): Promise<void> {
	consola.info("sk pkg remove")

	const trimmed = alias.trim()
	if (!trimmed) {
		const message = "Dependency alias is required."
		printOutcome(
			CommandResult.failed({
				field: "alias",
				message,
				source: "manual",
				type: "validation",
			}),
		)
		return
	}

	const coercedAlias = coerceAlias(trimmed)
	if (!coercedAlias) {
		const message = `Invalid alias: ${trimmed}`
		printOutcome(
			CommandResult.failed({
				field: "alias",
				message,
				source: "manual",
				type: "validation",
			}),
		)
		return
	}

	const selectionResult = options.global
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

	if (selectionResult.status !== "completed") {
		printOutcome(selectionResult)
		return
	}
	const selection = selectionResult.value

	if (!options.global) {
		warnIfSubdirectory(selection)
	}

	consola.start("Updating dependencies...")

	if (!hasDependency(selection.manifest, coercedAlias)) {
		printOutcome(
			CommandResult.failed({
				message: `Dependency not found: ${trimmed}`,
				target: "dependency",
				type: "not_found",
			}),
		)
		return
	}

	const updated = removeDependency(selection.manifest, coercedAlias)
	const saved = await saveManifest(
		updated,
		selection.manifestPath,
		selection.serializeOptions,
	)
	if (!saved.ok) {
		printOutcome(CommandResult.failed(saved.error))
		return
	}

	consola.success("Dependency settings updated.")
	consola.success(`Removed dependency: ${trimmed}.`)
	consola.info(`Manifest: ${selection.manifestPath} (updated).`)

	if (options.sync) {
		const syncResult = await syncWithSelection(
			{ ...selection, manifest: updated },
			{ dryRun: false, nonInteractive: options.nonInteractive },
		)
		if (syncResult.status === "failed") {
			printOutcome(syncResult)
			return
		}
		if (syncResult.status === "cancelled") {
			consola.info("Sync skipped.")
		} else if (syncResult.status === "unchanged") {
			consola.info(syncResult.reason)
		}
	}

	printOutcome(CommandResult.completed(undefined))
}
