import tsconfigPaths from "vite-tsconfig-paths"
import { defineConfig } from "vitest/config"

export default defineConfig({
	plugins: [tsconfigPaths()],
	test: {
		coverage: {
			exclude: ["src/**/*.test.ts"],
			include: ["src/**/*.ts"],
		},
		include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
		name: "sk",
		testTimeout: 30000,
	},
})
