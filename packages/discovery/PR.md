`sk` is a universal package manager for agent skills (npm/cargo for agents). it works across most coding agents, handles updates, and more. It installs skills using the native installation location for each coding agent. It also supports loading skills from claude-plugins (it'll extract the skill folders and put it into the right spot for other agents)

I proposed this PR because it solves a problem for me, and I do think it solves a for you for other users of this project. It’s annoying to use the same skills with multiple agents and keep them in updated (either globally in user-scope or for a specific project). It’s also tricky to distribute skills I or you have written, for multiple agents. This solves that.

Now if you feel it doesn’t solve it or you don’t care about the problem, I understand. I’d love some feedback for `sk`. Right now it just supports skills but I want to add support for commands and agent-specific things. It would be awesome to have a common container spec for agent extensions/packages/plugins, with some way to override for agent-specific tuning. That’s at least the direction I’m taking.

would you be open to adding this?
