import { resolve } from "node:path"
import { defineConfig } from "vitest/config"

export default defineConfig({
	resolve: {
		alias: {
			"@": resolve(__dirname, "./src"),
		},
	},
	test: {
		include: ["tests/e2e/**/*.test.ts"],
		testTimeout: 30000, // E2E tests are slower
	},
})
