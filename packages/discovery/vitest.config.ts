import tsconfigPaths from "vite-tsconfig-paths"
import { defineConfig } from "vitest/config"

export default defineConfig({
	plugins: [tsconfigPaths()],
	test: {
		coverage: {
			exclude: ["**/*.test.ts", "tests/**/*.ts"],
			include: ["**/*.ts"],
		},
		include: ["**/*.test.ts"],
		name: "discovery",
	},
})
