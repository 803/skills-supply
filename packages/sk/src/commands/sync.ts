import { consola } from "consola"
import { runSync } from "@/src/core/sync/sync"
import { formatError } from "@/src/utils/errors"

export async function syncCommand(options: { dryRun: boolean }): Promise<void> {
	consola.info("sk sync")
	consola.start(options.dryRun ? "Planning sync..." : "Syncing skills...")

	try {
		const result = await runSync({ dryRun: options.dryRun })
		if (!result.ok) {
			consola.error(`[${result.error.stage}] ${result.error.message}`)
			consola.error("Sync failed.")
			process.exitCode = 1
			return
		}

		consola.success(options.dryRun ? "Plan complete." : "Sync complete.")
		consola.info(`Found ${result.value.manifests} manifest(s).`)
		consola.info(
			`Resolved ${result.value.dependencies} dependenc${result.value.dependencies === 1 ? "y" : "ies"}.`,
		)
		consola.info(`Enabled agents: ${result.value.agents.join(", ")}`)

		const installVerb = options.dryRun ? "Would install" : "Installed"
		const removeVerb = options.dryRun ? "remove" : "removed"
		consola.info(
			`${installVerb} ${result.value.installed} skill(s), ${removeVerb} ${result.value.removed} stale skill(s).`,
		)

		for (const warning of result.value.warnings) {
			consola.warn(warning)
		}

		consola.success("Done.")
	} catch (error) {
		consola.error(formatError(error))
		consola.error("Sync failed.")
		process.exitCode = 1
	}
}
