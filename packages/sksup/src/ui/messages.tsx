import { Box, Text } from "ink"
import type { ReactElement } from "react"

interface MessageListProps {
	lines: string[]
}

export function MessageList({ lines }: MessageListProps): ReactElement {
	return (
		<Box flexDirection="column">
			{lines.map((line, index) => (
				<Text key={`${index}-${line}`}>{line.length === 0 ? " " : line}</Text>
			))}
		</Box>
	)
}
