import { intro, log, outro, spinner } from "@clack/prompts"
import { runSync } from "@/core/sync/sync"
import { formatError } from "@/utils/errors"

export async function syncCommand(options: { dryRun: boolean }): Promise<void> {
	intro("sksup sync")

	const action = spinner()
	action.start(options.dryRun ? "Planning sync..." : "Syncing skills...")

	try {
		const result = await runSync({ dryRun: options.dryRun })
		if (!result.ok) {
			action.stop("Sync failed.")
			log.error(`[${result.error.stage}] ${result.error.message}`)
			outro("Sync failed.")
			process.exitCode = 1
			return
		}

		action.stop(options.dryRun ? "Plan complete." : "Sync complete.")
		log.info(`Found ${result.value.manifests} manifest(s).`)
		log.info(
			`Resolved ${result.value.dependencies} dependenc${result.value.dependencies === 1 ? "y" : "ies"}.`,
		)
		log.info(`Enabled agents: ${result.value.agents.join(", ")}`)

		const installVerb = options.dryRun ? "Would install" : "Installed"
		const removeVerb = options.dryRun ? "remove" : "removed"
		log.info(
			`${installVerb} ${result.value.installed} skill(s), ${removeVerb} ${result.value.removed} stale skill(s).`,
		)

		for (const warning of result.value.warnings) {
			log.warn(warning)
		}

		outro("Done.")
	} catch (error) {
		action.stop("Sync failed.")
		log.error(formatError(error))
		outro("Sync failed.")
		process.exitCode = 1
	}
}
