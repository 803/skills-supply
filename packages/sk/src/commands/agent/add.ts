import { runAgentUpdate } from "@/src/commands/agent/shared"

export async function agentAdd(
	agentId: string,
	options: { global: boolean; nonInteractive: boolean },
): Promise<void> {
	await runAgentUpdate(agentId, "enable", options)
}
