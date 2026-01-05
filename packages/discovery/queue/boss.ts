import { consola } from "consola"
import { PgBoss } from "pg-boss"
import { env } from "@/env"

export const DISCOVERY_QUEUE = "discovery"
const QUEUE_POLICY = "exclusive"

const QUEUE_OPTIONS = {
	expireInSeconds: 30 * 60,
	policy: QUEUE_POLICY,
	retryBackoff: true,
	retryDelay: 60,
	retryLimit: 3,
}

export async function createBoss(): Promise<PgBoss> {
	const boss = new PgBoss(env.DATABASE_URL)
	await boss.start()
	const existing = await boss.getQueue(DISCOVERY_QUEUE)
	if (existing && existing.policy !== QUEUE_POLICY) {
		consola.warn(
			`Recreating ${DISCOVERY_QUEUE} queue to enforce policy=${QUEUE_POLICY}.`,
		)
		await boss.deleteQueue(DISCOVERY_QUEUE)
	}
	await boss.createQueue(DISCOVERY_QUEUE, QUEUE_OPTIONS)
	return boss
}

export async function clearQueue(boss: PgBoss): Promise<void> {
	await boss.deleteQueuedJobs(DISCOVERY_QUEUE)
}
