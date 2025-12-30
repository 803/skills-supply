import path from "node:path"
import type { AgentInstallState } from "@/core/agents/state"
import type { AgentDefinition } from "@/core/agents/types"
import type { IoResult } from "@/core/io/fs"
import { removePath } from "@/core/io/fs"

export interface ReconcileResult {
	removed: string[]
}

export async function reconcileAgentSkills(
	agent: AgentDefinition,
	state: AgentInstallState | null,
	desired: Set<string>,
): Promise<IoResult<ReconcileResult>> {
	if (!state) {
		return { ok: true, value: { removed: [] } }
	}

	const removed: string[] = []
	for (const skill of state.skills) {
		if (desired.has(skill)) {
			continue
		}

		const targetPath = path.join(agent.skillsPath, skill)
		const result = await removePath(targetPath)
		if (!result.ok) {
			return result
		}

		removed.push(skill)
	}

	return { ok: true, value: { removed } }
}
