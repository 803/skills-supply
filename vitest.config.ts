import { defineConfig } from "vitest/config"

export default defineConfig({
	test: {
		projects: [
			"packages/core/vitest.config.ts",
			"packages/discovery/vitest.config.ts",
			"packages/sk/vitest.config.ts",
		],
	},
})
