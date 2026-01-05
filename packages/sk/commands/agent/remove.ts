import { runAgentUpdate } from "@/commands/agent/shared"

export async function agentRemove(
	agentId: string,
	options: { global: boolean; nonInteractive: boolean },
): Promise<void> {
	await runAgentUpdate(agentId, "disable", options)
}
