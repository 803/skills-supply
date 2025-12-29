# MVP 4: Skills for Non-Technical Users

> Zapier/Notion for AI agent skills

---

## Problem Statement

Skills require:
- Editing markdown files with YAML frontmatter
- Understanding directory structures (`.claude/skills/`)
- Using terminal commands
- Navigating file systems

Normal people can't do this. Marketers, PMs, writers, ops teams—they use Claude daily but skills are inaccessible to them.

As AI assistants expand beyond developers, skills need to expand too.

---

## Scope

**In Scope:**
- One-click skill installation (no terminal)
- Conversational skill creation (no code)
- Cloud-hosted skill storage (no file system)
- Web UI for skill library
- Slash command access (`/skills`)

**Out of Scope:**
- CLI tools (that's MVP 1)
- Developer workflows (different audience)
- Payments (assume marketplace exists)
- Enterprise governance (future tier)

---

## The Core Insight

**Non-technical users already use Claude like a coworker.**

They don't think:
- "I need to configure my development environment"
- "I should write a SKILL.md file with YAML frontmatter"

They think:
- "I wish Claude remembered how I like my reports formatted"
- "I want Claude to always use our brand voice"
- "Can Claude do this the way Sarah does it?"

**Skills = Memory, not configuration.**

Frame skills as "teach Claude your preferences" not "install a markdown file."

---

## Core User Flows

### Flow 1: Installing a Skill

**Current state (developer):**
```bash
sksup install gh:marketingpro/brand-voice
# Skill installed to ~/.claude/skills/brand-voice/
```

**New state (non-technical):**
```
1. Receive shared link: skills.supply/s/brand-voice
2. Click link → opens in browser
3. See skill description + preview
4. Click "Add to Claude"
5. Prompted to sign in (if needed)
6. Click "Confirm"
7. ✓ "brand-voice added to your skills"
8. Next Claude conversation automatically has access
```

No terminal. No files. Just click.

### Flow 2: Creating a Skill

**Current state (developer):**
```
1. Create directory ~/.claude/skills/my-skill/
2. Create SKILL.md file
3. Write YAML frontmatter
4. Write markdown instructions
5. Restart Claude
6. Test
7. Iterate
```

**New state (non-technical):**
```
1. In Claude, type: "help me create a skill"
2. Claude asks: "What do you want me to remember?"
3. User: "When I ask for a weekly report, format it like this..."
4. Claude: "Got it. I'll create a skill called 'weekly-report-format'"
5. Claude shows preview of how it will behave
6. User: "Perfect"
7. Claude: "Skill saved. I'll use this format for weekly reports."
8. User can share via link
```

Conversation, not code.

### Flow 3: Managing Skills

```
┌─────────────────────────────────────────────────────────────────┐
│  MY SKILLS                                          [Settings]  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  🔍 Search skills...                                            │
│                                                                 │
│  ───────────────────────────────────────────────────────────    │
│                                                                 │
│  ⭐ Your Skills                                                 │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ 📝 Weekly Report Format                                  │   │
│  │ Created by you · Dec 28, 2024                           │   │
│  │                                              [Edit] [⋮]  │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ 🎨 Brand Voice                                           │   │
│  │ Added from @marketing · Dec 15, 2024                    │   │
│  │                                          [Remove] [⋮]    │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ───────────────────────────────────────────────────────────    │
│                                                                 │
│  📦 Discover More                                               │
│                                                                 │
│  [Browse Marketplace →]                                         │
│                                                                 │
│  ───────────────────────────────────────────────────────────    │
│                                                                 │
│  [+ Create New Skill]                                           │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Storage Model

### Current: File-System Centric

```
~/.claude/skills/
  brand-voice/
    SKILL.md
  weekly-report/
    SKILL.md
```

- Files are source of truth
- Syncing between machines is manual
- Non-technical users can't access

### New: Cloud-First

```
User Account (skills.supply)
  └── Skills
        ├── brand-voice (SKILL.md content)
        ├── weekly-report (SKILL.md content)
        └── email-templates (SKILL.md content)

Local Cache (~/.claude/skills/)
  ├── .skills-supply-sync
  └── [synced skills...]
```

- **Cloud is source of truth**
- Local files become cache, not source
- Auto-sync on Claude startup
- Works on any machine when logged in

### Sync Mechanism

```typescript
// On Claude startup (conceptual)
async function syncSkills(userId: string) {
  const cloudSkills = await fetch(`skills.supply/api/users/${userId}/skills`);
  const localSkills = await readLocalSkillsDir();

  // Cloud wins
  for (const skill of cloudSkills) {
    await writeLocalSkill(skill);
  }

  // Remove skills not in cloud
  for (const local of localSkills) {
    if (!cloudSkills.find(s => s.name === local.name)) {
      await removeLocalSkill(local);
    }
  }
}
```

---

## Skill Creation UI

### Conversational Builder

Instead of a form, use Claude itself to create skills:

```
User: I want to create a skill for writing customer emails

Claude: I'd be happy to help you create a skill for customer emails.
Let me ask a few questions:

1. What tone should the emails have? (Professional, Friendly, Formal)
2. Are there specific phrases or greetings you always use?
3. Should I include any particular sign-off?

User: Professional but warm. We always start with "Thanks for reaching out"
and end with "Best regards, [Name] from the Customer Success team"

Claude: Got it! Here's the skill I'll create:

┌───────────────────────────────────────────────────────────┐
│ Customer Email Writer                                      │
│                                                           │
│ When writing customer emails:                             │
│ • Use professional but warm tone                          │
│ • Start with "Thanks for reaching out"                    │
│ • End with "Best regards, [Name] from Customer Success"   │
│ • Be helpful and solution-oriented                        │
└───────────────────────────────────────────────────────────┘

Does this look right? I can adjust or add more details.

User: Add that we should always acknowledge their specific issue first

Claude: Updated! I've added "Acknowledge the specific issue they raised
before providing solutions."

[Save Skill] [Preview] [Edit More]
```

### Form Builder (Alternative)

For users who prefer structure:

```
┌─────────────────────────────────────────────────────────────────┐
│  CREATE SKILL                                                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Skill Name                                                     │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │ Customer Email Writer                                     │ │
│  └───────────────────────────────────────────────────────────┘ │
│                                                                 │
│  When should Claude use this skill?                             │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │ When writing emails to customers or responding to         │ │
│  │ customer inquiries                                        │ │
│  └───────────────────────────────────────────────────────────┘ │
│                                                                 │
│  What should Claude do?                                         │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │ • Use professional but warm tone                          │ │
│  │ • Start with "Thanks for reaching out"                    │ │
│  │ • Acknowledge their specific issue first                  │ │
│  │ • End with "Best regards, [Name] from Customer Success"   │ │
│  │                                                           │ │
│  └───────────────────────────────────────────────────────────┘ │
│                                                                 │
│  [Cancel]                                    [Save Skill →]     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Access Points

### 1. Web UI (Primary)

`skills.supply/library`

- Full skill management
- Works on any device
- No installation required

### 2. Slash Command

Within Claude conversation:

```
User: /skills

Claude: Your skills:

📝 Weekly Report Format (created by you)
🎨 Brand Voice (from @marketing)
✉️ Customer Emails (created by you)

[Manage Skills] [Create New] [Browse More]
```

### 3. Natural Language

```
User: What skills do I have?

Claude: You have 3 active skills:
• Weekly Report Format - formats your weekly updates
• Brand Voice - maintains consistent brand tone
• Customer Emails - guides customer communication

Want me to use one now, or would you like to create a new skill?
```

---

## Sharing Model

### Personal Skills

Created by user, visible only to them.

### Shared via Link

```
skills.supply/s/abc123

Anyone with link can view and add to their own library.
```

### Team Skills (Future)

```
Organization → Team → Skills

Marketing team shares:
• Brand Voice
• Campaign Templates
• Social Media Guidelines

All marketing team members auto-receive these skills.
```

---

## Viral Growth Mechanism

**Skills become shareable tribal knowledge.**

Scenario:
1. Marketing manager creates "Brand Voice" skill
2. Shares link in team Slack: "Hey, add this so Claude matches our voice"
3. 10 team members add it
4. Each uses Claude with consistent brand voice
5. One shares with agency partner
6. Agency adds it to their workflow
7. Agency creates their own version for clients

Skills spread like Google Docs—useful documents that propagate through organizations.

---

## What Changes From Developer Model

| Aspect | Developer Model | Non-Technical Model |
|--------|-----------------|---------------------|
| Storage | Local files | Cloud-first |
| Installation | Terminal command | Click link |
| Creation | Edit SKILL.md | Conversation or form |
| Management | File explorer | Web UI |
| Sharing | Git repo | URL link |
| Sync | Manual | Automatic |
| Access | File system | Web + slash command |

---

## Technical Requirements

### Authentication

```
skills.supply account
  ↓
OAuth with Claude.ai (if available) or email magic link
  ↓
JWT token stored in browser
  ↓
Token synced to Claude desktop client for skill sync
```

### API Endpoints

```typescript
// User's skills
GET  /api/me/skills              // List all skills
POST /api/me/skills              // Create skill
PUT  /api/me/skills/:id          // Update skill
DELETE /api/me/skills/:id        // Remove skill

// Shared skills
GET  /api/skills/:shareId        // Get shared skill
POST /api/me/skills/add/:shareId // Add shared skill to library

// Sync
GET  /api/me/skills/sync         // Get all skills for local sync
POST /api/me/skills/sync         // Report local state
```

### Local Sync Agent

Lightweight background process that:
1. Runs on Claude startup
2. Checks skills.supply for updates
3. Syncs skills to local directory
4. Handles conflict resolution (cloud wins)

Could be:
- Claude Code plugin
- Standalone daemon
- Browser extension

---

## What We Skip (For MVP)

1. **Team features** — Individual only. Teams later.
2. **Version history** — Latest only. History later.
3. **Collaboration** — Single owner. Shared editing later.
4. **Import from files** — Cloud creation only. Import later.
5. **Offline creation** — Requires connection. Offline sync later.
6. **Mobile app** — Web responsive only. Native app later.

---

## Success Metrics

1. **Non-dev adoption**: % of users who don't use CLI
2. **Skill creation rate**: Skills created per user per month
3. **Share rate**: % of skills shared via link
4. **Viral coefficient**: New users from shared skill links
5. **Time to first skill**: Minutes from signup to creating first skill

---

## The 10x Insight

**Skills aren't configuration. Skills are memory.**

Technical framing:
> "Install this SKILL.md file to your .claude/skills directory"

Human framing:
> "Teach Claude how you like things done"

The second framing unlocks non-technical users. They already teach coworkers their preferences. Now they can teach Claude.

**Bonus insight: Tribal knowledge becomes portable.**

Every organization has "the way we do things here." It lives in:
- Onboarding docs no one reads
- Slack messages that get lost
- Senior employees' heads

Skills make this knowledge executable. The marketing team's brand voice isn't a PDF—it's a skill that makes Claude speak correctly automatically.

That's transformative for organizations.
