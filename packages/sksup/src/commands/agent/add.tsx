import { runAgentUpdate } from "@/commands/agent/shared"

export async function agentAdd(agentId: string): Promise<void> {
	await runAgentUpdate(agentId, "enable")
}
