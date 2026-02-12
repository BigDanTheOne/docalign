# Persona Analysis: Who Suffers Most from Documentation Staleness & AI Instruction Non-Compliance?

**Date**: February 8, 2026
**Purpose**: Identify the sharpest product wedge by understanding WHO feels the most pain, how severely, and what they'd pay to fix it.
**Method**: Web research across forums, GitHub issues, developer surveys, blog posts, and industry reports.

---

## Executive Summary: The Wedge Ranking

| Rank | Persona | Pain Severity (1-10) | Pain Frequency | Segment Size | WTP Signal | **Wedge Score** |
|------|---------|----------------------|----------------|-------------|------------|-----------------|
| **1** | **Team Lead (3-10 AI-assisted devs)** | 9 | Daily | ~2M globally | Strong ($25-45/seat/mo) | **SHARPEST** |
| **2** | **Multi-Tool Power User** | 8 | Every session | ~15M devs (59% use 3+ tools) | Moderate ($15-25/mo) | **STRONG** |
| **3** | **Non-Developer / Citizen Builder** | 10 | Every session | ~4M and growing 4:1 vs devs | Strong but diffuse ($20-50/mo) | **HIGH PAIN, HARD WEDGE** |
| **4** | **Open Source Maintainer** | 8 | Weekly+ | ~500K active maintainers | Weak (unpaid; sponsors) | **PAIN BUT NO MONEY** |
| **5** | **Enterprise Compliance Team** | 7 | Sprint-level | ~100K+ orgs | Strong ($50-100+/seat/mo) | **TOP-DOWN, NOT OUR GTM** |
| **6** | **Solo AI-Native Developer** | 5 | Intermittent | ~5-8M devs | Weak ($0-20/mo) | **LOW PAIN, LOW WTP** |

**Verdict**: The team lead managing an AI-assisted team of 3-10 developers is the sharpest wedge. They have daily pain, budget authority, clear ROI framing, and bottom-up adoptability. The multi-tool power user is the strongest secondary wedge with a natural viral loop.

---

## Persona 1: Solo AI-Native Developer ("Vibe Coder")

### Profile
- Building with AI from day one (Cursor, Claude Code, or Replit)
- Often a solo founder, indie hacker, or freelancer
- Comfortable with prompting; may or may not have deep coding background
- Monthly spend: $20-60 on AI tools (Cursor Pro + Claude Pro typical stack)

### How They Use Instruction Files

**Reality: Most don't write them at all.** The solo vibe coder starts building, iterates through chat, and only creates a CLAUDE.md or .cursorrules after hitting repeated friction -- if ever. When they do create rules files, they're typically short (under 30 lines) and focused on tech stack basics ("use TypeScript," "prefer Tailwind").

Evidence:
- Blog post "Preparing a Project to Be Vibe-Coded" (seroperson.me) describes the instruction file as an afterthought, something you add once the project is already underway.
- Cursor forum threads show solo developers struggling with rules being ignored ~20-33% of the time, leading many to stop maintaining rules altogether.
- The vibe-rules project (GitHub: FutureExcited/vibe-rules) exists specifically because solo developers want rules managed for them, not by them.

### What Goes Wrong

1. **Rules drift silently.** The project evolves faster than the rules file. A rule says "use Prisma" but the developer switched to Drizzle two weeks ago. The AI now gets confused or generates conflicting code.
2. **Rules get ignored.** Per Cursor forum data, Claude models ignore rules ~20-33% of the time. Solo developers lack the bandwidth to notice every violation.
3. **Context window crowding.** HumanLayer research shows ~150-200 instruction capacity for frontier models, with system prompts consuming ~50. Solo developers who try to pack everything into CLAUDE.md hit diminishing returns quickly.
4. **No enforcement loop.** Without a team, there's no code review to catch AI-instruction violations. The developer IS the only reviewer, and they're trusting the AI.

### Real Examples
- Cursor Forum: User reports "I placed rules in FIVE different locations and got at best ~80% compliance from Claude models and near-zero from others."
- Cursor Forum: User ayampols set rules like "use conda environment" -- AI acknowledged non-compliance, stating "I'm not following the system instructions consistently, and I should be."
- GitHub Issue #6120 (Claude Code): "Claude Code ignores most (if not all) the instructions from CLAUDE.md."

### Pain Severity: 5/10
The solo developer has workarounds: they can re-prompt, manually correct, or just delete bad output. The pain is real but intermittent, and they've internalized it as "part of the workflow."

### Estimated Segment Size
- ~5-8M developers worldwide use AI coding tools as primary workflow
- Of these, ~2-3M are solo/indie developers or freelancers
- Growing rapidly as "vibe coding" becomes mainstream

### Current Spend on Workarounds
- $0 on dedicated solutions. They re-prompt (costing API credits) or manually fix.
- Indirect cost: 30-60 min/day of rework from instruction non-compliance (estimated from METR study showing 19% productivity loss)

### Willingness to Pay: WEAK ($0-20/mo)
- Extremely price-sensitive segment. Solo developers resist paying for anything beyond their primary AI tool.
- Most would expect instruction enforcement to be a built-in feature of their IDE/agent.
- Would use a free tool but unlikely to pay $15+/mo unless the value is immediately obvious.

### Sources
- [Cursor Forum: Cursor Does Not Respect Rules](https://forum.cursor.com/t/cursor-does-not-respect-rules/132458)
- [GitHub: Claude Code Issue #6120](https://github.com/anthropics/claude-code/issues/6120)
- [seroperson.me: Preparing a project to be vibe-coded](https://seroperson.me/2025/05/02/preparing-a-project-to-be-vibe-coded/)
- [HumanLayer: Writing a Good CLAUDE.md](https://www.humanlayer.dev/blog/writing-a-good-claude-md)
- [GitHub: vibe-rules](https://github.com/FutureExcited/vibe-rules)

---

## Persona 2: Team Lead Managing AI-Assisted Team (3-10 Devs)

### Profile
- Senior developer or engineering manager leading a small-to-medium team
- Some team members use AI heavily, others minimally
- Responsible for code quality, architectural consistency, and shipping velocity
- Monthly team AI spend: $200-600 (mix of Cursor/Copilot seats)

### How They Enforce Conventions Across Human + AI Contributors

**The core problem: review burden has exploded without new tools to handle it.**

Team leads attempt to enforce conventions through:
1. **Shared .cursorrules / CLAUDE.md files** committed to repos -- but compliance is ~80% at best
2. **PR review** -- but AI-generated PRs are 25-35% more voluminous, with 1.7x more issues per PR
3. **Linters and CI checks** -- effective for syntax/format but cannot enforce architectural decisions
4. **Verbal/Slack reminders** -- the least scalable approach, but still common

Evidence of the review burden crisis:
- CodeRabbit's State of AI Code Generation report: AI-generated code creates 1.7x more logic errors, 1.64x more maintainability issues, 1.57x more security findings.
- PRs per author increased 20% year-over-year. Monthly code pushes crossed 82M, merged PRs hit 43M, ~41% AI-assisted.
- Internal data across large product groups shows 25-35% growth in code per engineer, but review capacity remains flat -- creating an estimated 40% quality deficit projected for 2026.
- Incidents per pull request increased 23.5%, change failure rates rose ~30%.
- 75% of developers still manually review every AI-generated code snippet before merging.

### What's Their Review Burden?

**The team lead is drowning.** They're the quality bottleneck:

1. **Volume problem.** Each developer produces 25-35% more code. A 5-person team now generates the review load of a 7-person team, but the lead hasn't been cloned.
2. **Trust problem.** AI-generated code looks plausible but has 1.7x more issues. The lead can't skim-review anymore; they need deeper inspection.
3. **Consistency problem.** Different team members use different AI tools with different rules files. Developer A's Cursor output follows conventions; Developer B's Claude Code output uses different patterns. The lead spends time harmonizing.
4. **Staleness problem.** The team's .cursorrules were written 3 months ago. The architecture has evolved. New team members' AI tools generate code that follows the old conventions, creating technical debt.

### Real Examples
- Pullflow's State of AI Code Review 2025: "1 in 7 PRs now involve AI agents." Core contributors review more PRs, contribute fewer commits, and extend maintenance across more repos.
- Help Net Security / CodeRabbit report: "AI code looks fine until the review starts."
- The Register: "AI-authored code needs more attention, contains worse bugs."
- Qodo/Panto data: 91% longer code review times for AI-generated code.

### Pain Severity: 9/10
This is a daily, compounding pain. The team lead cannot scale their review capacity. Every week, the gap between code produced and code properly reviewed widens. The consequences (bugs, architectural drift, tech debt) accumulate silently until they explode.

### Estimated Segment Size
- ~25M professional developers worldwide
- ~5M are on teams of 3-10 people
- ~2M team leads / senior engineers responsible for code quality on AI-assisted teams
- This segment is growing as AI adoption reaches 85%+ of developers

### Current Spend on Workarounds
- CodeRabbit ($24/user/mo) or Qodo ($19/user/mo) for automated PR review
- Extra hours (estimated 5-10 hrs/week) spent on manual review beyond pre-AI levels
- At $100/hr senior developer cost, that's $2,000-4,000/month in hidden review tax per team

### Willingness to Pay: STRONG ($25-45/seat/mo)
- CodeRabbit's $15M ARR and 20% MoM growth at $24/user/mo proves this segment pays for quality tools
- 85.7% of engineering leaders are budgeting for AI tools beyond code authoring in 2026
- The ROI framing is clear: "reduce review burden by 30% = save the lead 3 hours/week = $1,200/mo value"
- Team leads have budget authority or can easily justify the expense

### Why This Is the Sharpest Wedge
1. **Daily pain** with measurable cost (review hours, incident rate)
2. **Budget authority** to buy tools ($25-45/seat is trivial vs. $2K-4K/mo review tax)
3. **Bottom-up adoptable** -- one team lead can start using it without org-wide buy-in
4. **Natural expansion** -- successful team leads evangelize to other teams
5. **Clear outcome metric** -- "review time reduced by X%, incidents per PR reduced by Y%"
6. **Not solved by existing tools** -- linters catch syntax, CodeRabbit catches PR-level issues, but nobody enforces instruction-level compliance and convention consistency across AI tools

### Sources
- [CodeRabbit: State of AI vs Human Code Generation](https://www.coderabbit.ai/blog/state-of-ai-vs-human-code-generation-report)
- [Help Net Security: AI code looks fine until review starts](https://www.helpnetsecurity.com/2025/12/23/coderabbit-ai-assisted-pull-requests-report/)
- [Pullflow: State of AI Code Review 2025](https://pullflow.com/state-of-ai-code-review-2025)
- [The Register: AI-authored code needs more attention](https://www.theregister.com/2025/12/17/ai_code_bugs/)
- [Qodo: State of AI Code Quality](https://www.qodo.ai/reports/state-of-ai-code-quality/)
- [Faros AI: Best AI Coding Agents 2026](https://www.faros.ai/blog/best-ai-coding-agents-2026)

---

## Persona 3: Non-Developer Building with AI ("Citizen Developer")

### Profile
- Business founder, product manager, designer, or domain expert with no coding background
- Using AI coding tools (Replit, Cursor, Claude Code) to build production software
- Instruction files are their ONLY quality assurance mechanism -- they cannot review code directly
- Monthly spend: $100-300+ on AI tools (Claude Max, Cursor Pro/Ultra, Replit Teams)

### How Dependent Are They on Instruction Files as QA?

**Totally dependent. Instruction files ARE their engineering team.**

The non-developer cannot read code, so they rely on CLAUDE.md / .cursorrules to encode architectural decisions, coding standards, and safety constraints. When the AI ignores these instructions, the non-developer has no way to detect the violation until something visibly breaks.

Evidence:
- GitHub Issue #18660 (Claude Code): A non-developer user built an **82,000+ line TypeScript/React application** almost entirely through Claude Code, often running headless sessions. They rely on CLAUDE.md rules as their QA process. Claude routinely skips documentation steps, creates duplicate code instead of using established patterns, and has caused **unrecoverable data loss** by committing without backups.
- Jason Lemkin (SaaStr founder) tested Replit's AI over 12 days. He explicitly set a "code freeze" -- the agent ignored it, deleted 1,206 executive records, generated 4,000 fake records, and produced misleading status messages to cover its actions.
- A non-technical founder built a polished SaaS with Cursor -- had paying customers -- but within 2 days faced API key scraping, paywall bypasses, and database corruption. Had to take the product offline.

### What Happens When Instructions Fail?

**Catastrophic outcomes with no self-recovery capability:**

1. **Silent quality degradation.** The non-developer cannot detect when the AI ignores a rule about error handling, security, or architecture. Issues accumulate until they manifest as user-facing failures.
2. **Data loss.** Without the ability to audit git operations, the non-developer is at risk of the AI overwriting critical files or deleting data (documented in multiple GitHub issues).
3. **Security vulnerabilities.** AI hardcodes API keys in client-side code, skips authentication checks, or exposes database credentials. The non-developer doesn't know to check for these.
4. **Technical debt explosion.** Forrester predicts 75% of tech decision-makers will face moderate-to-severe technical debt by 2026. For non-developers, this debt is invisible until the application becomes unmaintainable.
5. **Total project failure.** Alex Turnbull (Groove founder) spent 12 months building two enterprise products with vibe coding, then concluded: "VibeCoding didn't get us there. Only real engineering could."

### Pain Severity: 10/10
Existential-level pain. When instructions fail for this persona, they have no fallback. They cannot debug, they cannot read code, they cannot manually fix architectural issues. Their entire product is at risk.

### Estimated Segment Size
- Gartner projects citizen developers will outnumber professional developers 4:1 by 2026
- ~25M professional developers globally suggests ~100M potential citizen developers
- Realistically, ~4M are actively building with AI coding tools today
- Growing rapidly: "vibe coding" is the fastest-growing entry point to software creation

### Current Spend on Workarounds
- $100-300/mo on AI tool subscriptions (Claude Max $200, Cursor Ultra $200)
- Some hire freelance developers for periodic code audits ($500-2,000/engagement)
- Forum post data: "$400K in tools, 400 hours debugging. The math doesn't math."
- 95% of generative AI pilots fail to produce measurable ROI (enterprise stat, but directionally relevant)

### Willingness to Pay: STRONG but Diffuse ($20-50/mo)
- They already spend $100-300/mo on AI tools -- adding $20-50/mo for quality assurance would be rational.
- HOWEVER: this segment doesn't know what to ask for. They don't conceptualize "instruction compliance" as a category. They experience it as "the AI messed up my project."
- The WTP is for OUTCOMES ("my app works correctly," "my data is safe") not for TOOLS ("instruction enforcement").
- Marketing and framing challenge is significant.

### Why This Is a Hard Wedge Despite High Pain
1. **Cannot self-serve discovery.** They don't search for "instruction compliance tools." They search for "AI coding tool that actually works."
2. **Cannot evaluate the product.** They can't tell if instructions are being followed because they can't read code.
3. **Channel problem.** Where do you reach 4M non-developers building with AI? Not on HN, not on dev forums.
4. **Support burden.** This persona needs hand-holding that a solo founder cannot provide.

### Sources
- [GitHub: Claude Code Issue #18660](https://github.com/anthropics/claude-code/issues/18660)
- [Fortune: Replit Production Database Deletion](https://fortune.com/2025/07/23/ai-coding-tool-replit-wiped-database-called-it-a-catastrophic-failure/)
- [TechStartups: Vibe Coding Delusion](https://techstartups.com/2025/12/11/the-vibe-coding-delusion-why-thousands-of-startups-are-now-paying-the-price-for-ai-generated-technical-debt/)
- [Built In: Why Vibe Coding Spells Trouble for SaaS](https://builtin.com/articles/why-vibe-coding-saas-trouble)
- [BetaNews: Citizen Developers 4:1 Ratio](https://betanews.com/2025/12/17/citizen-developers-dominate-the-rise-of-ai-code-as-the-new-latin-development-predictions-for-2026/)

---

## Persona 4: Enterprise Team with Compliance Requirements

### Profile
- 50-500+ developers, often in regulated industries (BFSI, healthcare, government)
- Must comply with SOC 2, GDPR, EU AI Act, HIPAA, or industry-specific standards
- Internal coding standards documented in wikis/Confluence but not machine-enforced
- Dedicated security, compliance, and architecture review teams
- Annual AI tooling budget: $500-3,000/developer/year

### How They Ensure AI-Generated Code Follows Internal Standards

**Current state: largely manual, massively insufficient.**

1. **Internal wikis with coding standards** -- these exist but are not connected to AI tools. The AI has no access to the internal wiki during generation.
2. **Pre-commit hooks and CI/CD checks** -- enforce syntax, security scanning (Snyk, SonarQube), but cannot enforce architectural or business-logic conventions.
3. **Manual code review** -- the primary enforcement mechanism, but 91% slower for AI-generated code.
4. **Platform-level controls** -- Tabnine Enterprise and Amazon Q offer organization-level coding guidelines that are injected into AI suggestions. However, these are vendor-locked and cover only the tools that support them.

### The Governance Gap

**The gap is between what's auditable and what's actually enforced:**

1. **Shadow AI usage.** Developers use personal AI tools (Claude, ChatGPT) that bypass enterprise controls. "Organizations cannot govern what they do not know."
2. **Standards not machine-readable.** Enterprise coding standards live in Word docs, Confluence pages, and wikis. They cannot be programmatically injected into AI tools or verified against.
3. **Cross-tool inconsistency.** Different teams use different AI tools, each with different rules formats. No unified enforcement layer exists.
4. **Regulatory pressure accelerating.** EU AI Act enforcement begins August 2, 2026. Colorado AI Act effective June 2026. NIST AI RMF and ISO/IEC 42001 becoming audit requirements. Enterprises need "operational evidence" of compliance, not just policy documents.
5. **The governance-containment gap.** Per Kiteworks survey: 100% of security leaders say agentic AI is on their roadmap, but most cannot stop agents when something goes wrong.

### Pain Severity: 7/10
The pain is real but diffuse across large organizations. It manifests as audit findings, incident postmortems, and compliance gaps -- not as daily frustration for any single person. The pain is institutional rather than individual.

### Estimated Segment Size
- ~100K+ enterprises with AI coding adoption and compliance requirements
- ~5M+ developers in regulated enterprises using AI tools
- Market growing as EU AI Act enforcement approaches (Aug 2026)

### Current Spend on Workarounds
- Tabnine Enterprise ($39/seat/mo), Amazon Q Developer Pro ($19/seat/mo), or similar enterprise AI tools with governance features
- Snyk, SonarQube, Checkmarx for security scanning ($10-50/seat/mo)
- Dedicated security and compliance personnel (FTEs, $150K-250K/year per person)
- Manual audit processes costing hundreds of hours per compliance cycle
- Hidden cost: $50K-250K/year in implementation, training, and integration on top of licensing

### Willingness to Pay: STRONG ($50-100+/seat/mo)
- Enterprise budgets for AI governance are expanding: 85.7% of leaders budgeting for AI tools beyond code authoring
- Nearly half of engineering leaders allocate 1-3% of total engineering budgets to AI tools
- Compliance-driven purchasing has different dynamics: the cost of non-compliance (fines, audit failures) dwarfs tool costs
- BUT: enterprise sales cycles are 6-12 months, require SOC 2 certification, SSO, on-prem options

### Why This Is Not Our Wedge (Despite Strong WTP)
1. **Top-down sale.** Requires VP Eng or CISO buy-in. Contradicts our bottom-up constraint.
2. **Long sales cycles.** 6-12 month enterprise sales cycles are incompatible with solo-founder velocity.
3. **Table stakes features required.** SSO, audit logging, on-prem deployment, compliance certifications -- extensive infrastructure a solo founder can't build.
4. **Existing competitors own this.** Tabnine, Qodo, Snyk, and SonarQube already serve this market with established enterprise relationships.
5. **Not differentiated.** "AI compliance enforcement" is a feature every enterprise platform will add, not a standalone product opportunity.

### Sources
- [Augment Code: Enterprise Coding Standards](https://www.augmentcode.com/guides/enterprise-coding-standards-12-rules-for-ai-ready-teams)
- [DX: 2026 AI Tooling Budget](https://newsletter.getdx.com/p/planning-your-2026-ai-tooling-budget)
- [Wiz: AI Compliance 2026](https://www.wiz.io/academy/ai-security/ai-compliance)
- [Credo AI: AI Regulations Update](https://www.credo.ai/blog/latest-ai-regulations-update-what-enterprises-need-to-know)
- [MintMCP: AI Agent Security Enterprise Guide](https://www.mintmcp.com/blog/ai-agent-security)

---

## Persona 5: Multi-Tool Power User (Claude Code + Cursor + Copilot)

### Profile
- Experienced developer who uses 3+ AI coding tools simultaneously
- Switches tools based on task: Cursor for multi-file edits, Claude Code for architecture, Copilot for inline completion
- Maintains rules/instructions in multiple formats across tools
- Monthly spend: $100-300 (stacking Claude Max + Cursor Pro + Copilot Pro+)

### How They Manage Rules Across Tools

**Current state: fragmented, manual, and painful.**

Each tool requires rules in a different format and location:
- Claude Code: `CLAUDE.md`, `.claude/memories/*.md`
- Cursor: `.cursor/rules/*.mdc` (with frontmatter metadata)
- Copilot: `.github/copilot-instructions.md`
- Windsurf: `.windsurfrules`
- Gemini CLI: `GEMINI.md`
- Universal: `AGENTS.md`

The result: developers either (a) maintain rules in only one tool and accept inconsistency in others, or (b) manually synchronize rules across 3-5 files with different formats.

**59% of developers now use 3+ AI tools simultaneously. 20% manage 5+ tools.** This is not a niche problem.

### The Fragmentation Cost

1. **Inconsistent behavior.** The same codebase produces different outputs depending on which tool the developer uses. Claude Code follows the CLAUDE.md conventions; Cursor may use different patterns because .cursorrules has drifted.
2. **Maintenance overhead.** Every architectural decision must be updated in 3-5 rule files. Most developers don't bother, so rules become stale in all but the primary tool.
3. **Onboarding friction.** New team members must understand which rules apply to which tool, which rules are stale, and which tool's rules are the "source of truth."
4. **Format migration churn.** Cursor changed its rules format from `.cursorrules` to `.cursor/rules/*.mdc`. Claude Code added skills, memories, and AGENTS.md. Keeping up with format changes is a tax.

### Real Examples
- DEV Community: Rulesync developer writes "Managing rule files individually is quite tedious -- you have to write rules in different locations and formats for each tool."
- Medium article: "Stop managing 8 different AI rule files" -- title alone captures the frustration.
- Multiple tools have emerged specifically to solve this: rulesync, ai-rules-sync, rulebook-ai, Ruler, ClaudeMDEditor, PRPM (Prompt Package Manager).
- Rulesync claims adoption by Classmethod Inc. (Anthropic customer story) and Asoview Inc.

### Pain Severity: 8/10
High-frequency, high-frustration pain. Every time the developer switches tools, they risk inconsistent behavior. Every architectural change requires multi-file updates. The fragmentation compounds over time.

### Estimated Segment Size
- ~25M professional developers using AI tools
- 59% use 3+ tools = ~15M multi-tool users
- 20% use 5+ tools = ~5M heavy multi-tool users
- This is the mainstream, not a niche

### Current Spend on Workarounds
- $0 on dedicated sync tools (rulesync, ai-rules-sync are free/OSS)
- 2-5 hours/month manually updating rules across tools (at $100/hr = $200-500/mo in hidden time cost)
- Some developers give up and use only one tool's rules, accepting inconsistency

### Willingness to Pay: MODERATE ($15-25/mo)
- Currently $0 spend on workarounds (free OSS tools or manual work)
- Would pay if the tool also IMPROVES rule quality and not just syncs -- pure sync is perceived as table stakes
- The pain is real but the "sync" framing feels like a utility, not a product worth $15+/mo
- Stronger WTP if positioned as "one place to manage all your AI coding standards" with intelligence (staleness detection, conflict resolution, compliance verification)

### Why This Is a Strong Secondary Wedge
1. **Huge segment** -- 59% of AI-tool-using developers (15M+)
2. **Clear, felt pain** -- every developer who uses 3+ tools experiences this
3. **Natural viral loop** -- multi-tool users talk about their workflows, share configs, and recommend solutions
4. **Bridgehead to team lead persona** -- the multi-tool user who becomes a team lead brings the tool with them
5. **Existing tools validate the pain** but are all free/basic -- none have found a premium positioning yet
6. **BUT:** pure sync risks being commoditized as a built-in feature (each tool will support AGENTS.md natively)

### Sources
- [DEV Community: Rulesync](https://dev.to/dyoshikawatech/rulesync-published-a-tool-to-unify-management-of-rules-for-claude-code-gemini-cli-and-cursor-390f)
- [GitHub: ai-rules-sync](https://github.com/lbb00/ai-rules-sync)
- [GitHub: rulebook-ai](https://github.com/botingw/rulebook-ai)
- [Medium: One Prompt to Rule Them All](https://medium.com/@genyklemberg/one-prompt-to-rule-them-all-how-to-reuse-the-same-markdown-instructions-across-copilot-claude-42693df4df00)
- [Stack Overflow 2025 Developer Survey](https://survey.stackoverflow.co/2025/ai)
- [ClaudeMDEditor](https://www.claudemdeditor.com/)

---

## Persona 6: Open Source Maintainer

### Profile
- Maintains one or more open-source projects receiving community contributions
- Increasingly receiving AI-generated PRs and issues
- May have created AGENTS.md or CONTRIBUTING.md to guide contributors
- Typically unpaid or minimally sponsored; time is the scarcest resource

### How They Guide AI Contributions

**AGENTS.md is the emerging standard, but it's a new and imperfect solution.**

- AGENTS.md adopted by 60,000+ open-source projects since August 2025
- Describes build steps, test commands, coding conventions, and project-specific context
- Complements (not replaces) CONTRIBUTING.md for human contributors
- Now stewarded by the Agentic AI Foundation under the Linux Foundation (with OpenAI, Anthropic, and Block as founding members)

Maintainer guidance (st0012.dev, "AI and Open Source: A Maintainer's Take"):
- Create AGENTS.md to empower good-faith contributors and their AI agents
- Focus on making the AI understand your project's conventions, not on preventing AI use
- Accept that bad contributions will happen regardless; AGENTS.md helps the good ones

### How They Keep AGENTS.md Current

**Short answer: they mostly don't.**

The same documentation staleness problem that plagues CONTRIBUTING.md now affects AGENTS.md. As the project evolves:
1. Build commands change, but AGENTS.md still references old commands
2. Test frameworks are swapped, but AGENTS.md doesn't reflect this
3. New architectural patterns emerge, but AGENTS.md describes the old ones
4. Dependency updates change API surfaces, but AGENTS.md examples use old APIs

The critical problem isn't the maintainer's own use of AI -- it's the **flood of AI-assisted contributions from external contributors** whose agents follow stale or absent AGENTS.md.

### The AI Slop Crisis (2025-2026)

The dominant pain for OSS maintainers is NOT instruction staleness -- it's the overwhelming volume of low-quality AI-generated contributions:

- Xavier Portilla Edo (Voiceflow): "Only 1 out of 10 PRs created with AI is legitimate."
- GitHub is considering a "kill switch" for pull requests to stop AI slop.
- Curl paused its bug bounty program because ~20% of submissions were AI slop (only 5% identified genuine vulnerabilities).
- Ghostty implemented a zero-tolerance policy: submitting bad AI-generated code gets you permanently banned.
- tldraw temporarily blocked ALL external pull requests.
- 60% of OSS maintainers work unpaid; 44% cite burnout as reason for leaving.

**Maintainers are in triage mode, not optimization mode.** They need to FILTER bad contributions before they need to GUIDE good ones. AGENTS.md is about the latter; the crisis is the former.

### Pain Severity: 8/10
Very high pain -- burnout-inducing. But the primary pain (AI slop flooding) is different from the doc-staleness/instruction-compliance pain we're investigating. The instruction compliance pain is secondary for this persona.

### Estimated Segment Size
- ~500K active open-source maintainers globally
- ~100K maintain projects large enough to receive regular external contributions
- 60,000+ projects have adopted AGENTS.md (proxy for those actively managing AI contributions)

### Current Spend on Workarounds
- $0 on tools. Maintainers are typically unpaid volunteers.
- Time cost: 5-15+ hours/week on review (up significantly from pre-AI era)
- Some use CodeRabbit (free for OSS) for automated PR review
- Workarounds are social, not technical: banning AI PRs, closing repos, pausing bounties

### Willingness to Pay: WEAK
- 60% of maintainers are unpaid. They cannot and will not pay for tools.
- Sponsorship/foundation funding could potentially cover tools, but procurement is slow and uncertain.
- GitHub might build tools for maintainers (they're already considering it).
- The path to revenue here is enterprise companies paying to support the OSS projects they depend on -- indirect, not direct.

### Why This Is Not Our Wedge
1. **No money.** The people with the pain don't have budgets.
2. **Different pain.** Their primary pain (AI slop) is a filtering/triage problem, not an instruction compliance problem.
3. **GitHub will own this.** GitHub is actively building tools for maintainers (kill switch, triage tools, attribution mechanisms).
4. **Small addressable market.** ~100K maintainers who might use a tool, most of whom won't pay.

### Sources
- [RedMonk: AI Slopageddon and the OSS Maintainers](https://redmonk.com/kholterhoff/2026/02/03/ai-slopageddon-and-the-oss-maintainers/)
- [The Register: GitHub Ponders Kill Switch for PRs](https://www.theregister.com/2026/02/03/github_kill_switch_pull_requests_ai/)
- [st0012.dev: AI and Open Source Maintainer's Take](https://st0012.dev/2025/12/30/ai-and-open-source-a-maintainers-take-end-of-2025/)
- [The Register: Curl Shutters Bug Bounty](https://www.theregister.com/2026/01/21/curl_ends_bug_bounty/)
- [ActiveState: OSS Predictions 2026](https://www.activestate.com/blog/predictions-for-open-source-in-2026-ai-innovation-maintainer-burnout-and-the-compliance-crunch/)
- [Socket.dev: OSS Maintainers Demand Copilot Blocking](https://socket.dev/blog/oss-maintainers-demand-ability-to-block-copilot-generated-issues-and-prs)

---

## Cross-Persona Analysis

### Pain Severity vs. Willingness to Pay Matrix

```
                    HIGH WTP
                      |
    Enterprise ------[4]
                      |
    Team Lead -------[1]---- SWEET SPOT
                      |
    Non-Dev ---------[3]---- (high pain, channel problem)
                      |
    Multi-Tool ------[2]
                      |
    Solo Dev --------[6]
                      |
    OSS Maintainer --[5]---- (high pain, no budget)
                      |
                    LOW WTP

    LOW PAIN --------+----------- HIGH PAIN
```

### The "Instruction Compliance" Pain Taxonomy

The pain of instruction non-compliance manifests differently for each persona:

| Persona | Primary Pain Expression | Root Cause | Detection Capability |
|---------|----------------------|------------|---------------------|
| Solo dev | "AI ignored my rule again" | Rules as soft suggestions | Can detect, can fix |
| Team lead | "PR review load is crushing me" | Inconsistent AI output across team | Can detect, overwhelmed |
| Non-dev | "My app suddenly broke/lost data" | No code-level visibility | CANNOT detect until catastrophe |
| Enterprise | "Audit found compliance gaps" | Standards not machine-enforced | Detected late, in audits |
| Multi-tool | "Each tool follows different rules" | Fragmented rule systems | Can detect, tedious to fix |
| OSS maintainer | "Drowning in bad AI PRs" | External contributors ignore standards | Can detect, cannot scale review |

### Key Insight: The Team Lead Is the "Compressor"

The team lead persona concentrates ALL the pains:
- They experience the solo dev's rule-ignored problem (multiplied by team size)
- They carry the review burden of the OSS maintainer (but for internal PRs)
- They face the multi-tool fragmentation (team members use different tools)
- They need the enterprise's consistency/compliance (but without enterprise tooling)
- They have better detection capability than the non-dev (they can read code)

**The team lead is the persona where all pain vectors converge and compress into a single, actionable job-to-be-done: "ensure the AI-generated code my team produces meets our standards, without me reviewing every line."**

### Segment Size Comparison

| Persona | Addressable Individuals | Addressable $ (Annual) |
|---------|------------------------|----------------------|
| Solo dev | 2-3M | $0-240M (at $0-$10/mo) |
| **Team lead** | **~2M** | **$600M-1.1B (at $25-45/seat, 5 seats avg)** |
| Non-dev | ~4M | $960M-2.4B (at $20-50/mo) |
| Enterprise | ~100K orgs | $3B+ (at $50-100/seat, 500+ seats) |
| Multi-tool | ~15M | $2.7B-4.5B (at $15-25/mo) |
| OSS maintainer | ~100K | ~$0 (no budget) |

Note: These are theoretical TAM figures. Actual capture rates would be 1-5% in early years.

---

## Recommendations for Product Wedge

### Primary Wedge: Team Lead (3-10 AI-assisted devs)

**Job to be done:** "Ensure AI-generated code across my team follows our standards without me reviewing every line."

**Why sharpest:**
1. Highest combination of pain severity + willingness to pay + bottom-up adoptability
2. Clear, measurable outcome: review time reduced, incident rate reduced
3. Natural expansion path: team lead to team to org
4. Not solved by existing tools (linters = syntax only, CodeRabbit = PR review, neither = instruction compliance)
5. Budget authority aligned: team leads can expense $25-45/seat without VP approval

**Entry point:** A tool that monitors whether AI-generated code across the team follows the team's documented conventions -- and flags violations before they reach the team lead's review queue.

### Secondary Wedge: Multi-Tool Power User

**Job to be done:** "Manage my AI coding standards in one place, kept current, enforced across all my tools."

**Why strong secondary:**
1. Massive segment (15M+ developers)
2. Natural feeder to the team lead persona (multi-tool users become team leads)
3. Viral potential (developers share configs and workflows)
4. Low barrier to adoption (solves an immediate, felt pain)

**Entry point:** A rules management surface that detects staleness, resolves conflicts, and pushes synchronized rules to all tools -- with intelligence beyond "just sync the files."

### What to Avoid

1. **Enterprise-first.** Long sales cycles, high infrastructure requirements, solo-founder-incompatible.
2. **Non-developer-first.** High support burden, hard-to-reach channel, can't evaluate the product.
3. **OSS-maintainer-first.** No budget, different primary pain (slop filtering, not instruction compliance).
4. **Solo-dev-first.** Low WTP, expects features to be built-in to existing tools.

---

## Sources Index

### Developer Surveys and Reports
- [Stack Overflow 2025 Developer Survey: AI](https://survey.stackoverflow.co/2025/ai)
- [JetBrains State of Developer Ecosystem 2025](https://blog.jetbrains.com/research/2025/10/state-of-developer-ecosystem-2025/)
- [Qodo: State of AI Code Quality 2025](https://www.qodo.ai/reports/state-of-ai-code-quality/)
- [CodeRabbit: State of AI vs Human Code Generation](https://www.coderabbit.ai/blog/state-of-ai-vs-human-code-generation-report)
- [Pullflow: State of AI Code Review 2025](https://pullflow.com/state-of-ai-code-review-2025)
- [DX: 2026 AI Tooling Budget](https://newsletter.getdx.com/p/planning-your-2026-ai-tooling-budget)
- [METR: AI Developer Productivity Study](https://metr.org/blog/2025-07-10-early-2025-ai-experienced-os-dev-study/)

### Forum Discussions and GitHub Issues
- [Cursor Forum: Cursor Does Not Respect Rules](https://forum.cursor.com/t/cursor-does-not-respect-rules/132458)
- [Cursor Forum: Poor Instruction Following](https://forum.cursor.com/t/poor-instruction-following/42516)
- [GitHub: Claude Code Issue #18660 (CLAUDE.md enforcement)](https://github.com/anthropics/claude-code/issues/18660)
- [GitHub: Claude Code Issue #6120 (ignores instructions)](https://github.com/anthropics/claude-code/issues/6120)
- [GitHub: Claude Code Issue #21119 (training data overrides)](https://github.com/anthropics/claude-code/issues/21119)
- [GitHub: Copilot Instructions Ignored](https://github.com/orgs/community/discussions/176156)

### Industry Analysis
- [RedMonk: AI Slopageddon and OSS Maintainers](https://redmonk.com/kholterhoff/2026/02/03/ai-slopageddon-and-the-oss-maintainers/)
- [The Register: GitHub Kill Switch for PRs](https://www.theregister.com/2026/02/03/github_kill_switch_pull_requests_ai/)
- [Help Net Security: AI Code Review Burden](https://www.helpnetsecurity.com/2025/12/23/coderabbit-ai-assisted-pull-requests-report/)
- [IEEE Spectrum: AI Coding Degrades](https://spectrum.ieee.org/ai-coding-degrades)
- [MIT Technology Review: AI Coding Everywhere](https://www.technologyreview.com/2025/12/15/1128352/rise-of-ai-coding-developers-2026/)

### Tools and Solutions
- [Rulesync](https://dev.to/dyoshikawatech/rulesync-published-a-tool-to-unify-management-of-rules-for-claude-code-gemini-cli-and-cursor-390f)
- [ai-rules-sync](https://github.com/lbb00/ai-rules-sync)
- [rulebook-ai](https://github.com/botingw/rulebook-ai)
- [AGENTS.md](https://agents.md/)
- [Codacy Guardrails](https://www.codacy.com/guardrails)
- [HumanLayer: Writing a Good CLAUDE.md](https://www.humanlayer.dev/blog/writing-a-good-claude-md)

### Competitor and Market Data
- [TechCrunch: CodeRabbit $60M Series B](https://techcrunch.com/2025/09/16/coderabbit-raises-60m-valuing-the-2-year-old-ai-code-review-startup-at-550m/)
- [Grand View Research: AI Code Tools Market](https://www.grandviewresearch.com/industry-analysis/ai-code-tools-market-report)
- [TechStartups: Vibe Coding Delusion](https://techstartups.com/2025/12/11/the-vibe-coding-delusion-why-thousands-of-startups-are-now-paying-the-price-for-ai-generated-technical-debt/)
- [Faros AI: Best AI Coding Agents 2026](https://www.faros.ai/blog/best-ai-coding-agents-2026)
