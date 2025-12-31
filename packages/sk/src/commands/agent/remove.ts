import { runAgentUpdate } from "@/src/commands/agent/shared"

export async function agentRemove(agentId: string): Promise<void> {
	await runAgentUpdate(agentId, "disable")
}
