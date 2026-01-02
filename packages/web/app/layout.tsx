import type { Metadata } from "next"
import { Orbit, Rubik, Space_Mono, Work_Sans } from "next/font/google"
import "./globals.css"

const fontLogo = Orbit({
	subsets: ["latin"],
	variable: "--font-logo",
	weight: "400",
})

const fontHeading = Rubik({
	subsets: ["latin"],
	variable: "--font-heading",
})

const fontSans = Work_Sans({
	subsets: ["latin"],
	variable: "--font-sans",
})

const fontMono = Space_Mono({
	subsets: ["latin"],
	variable: "--font-mono",
	weight: ["400", "700"],
})

export const metadata: Metadata = {
	description:
		"The documentation layer for AI coding assistants. Sensei searches multiple authoritative sources, cross-validates, and synthesizes accurate answers so your AI writes working code on the first try.",
	title: "Sensei — Documentation for AI Coding Assistants",
}

export default function RootLayout({
	children,
}: Readonly<{
	children: React.ReactNode
}>) {
	return (
		<html
			lang="en"
			className={`${fontLogo.variable} ${fontHeading.variable} ${fontSans.variable} ${fontMono.variable}`}
		>
			<body className="min-h-screen bg-stone-50 text-stone-800 antialiased">
				{children}
			</body>
		</html>
	)
}
