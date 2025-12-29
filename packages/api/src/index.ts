import { serve } from "@hono/node-server"
import { Hono } from "hono"
import { env } from "./env"
import { accountRoutes } from "./routes/account"
import { authRoutes } from "./routes/auth"
import { gitRoutes } from "./routes/git"

const app = new Hono()

app.get("/", (c) => c.text("Skills Supply API"))
app.route("/", gitRoutes)
app.route("/", authRoutes)
app.route("/", accountRoutes)

serve({
	fetch: app.fetch,
	port: env.PORT,
})

export default app
