# CLAUDE.md

@AGENTS.md

## Claude Code notes for this fork

`AGENTS.md` above is the repository guide. Its **ME-personal fork policy** section is authoritative; the
upstream Pasta-Devs workflow rules below it (target `staging`, assign `SpicyMarinara`, Marinara-Agents
routing, CodeRabbit, Codex model table) are historical context and do not apply to this fork unless the
owner asks.

### Owner's working rules (summary)

- Priority: preserve existing features > compatibility > complete the request > verify > optimize.
- Trace real source before editing; minimal changes; no mockups, placeholders or fake controls.
- Work on a feature branch from `main`. Commit **and push** each verified feature or recovery point, then
  confirm the remote ref. Never force-push or rewrite history. Do not merge to `main`, release or deploy
  unless the owner asks.
- Report only what was actually implemented and verified. Mark anything not run as **unverified**.
- Modularize only inside the area being changed, when duplication or inefficiency is confirmed there.

### Reference sources

- Upstream baseline (unmodified v2.5.1 frontend): branch `baseline/marinara-v2.5.1` in this repo
  (`8042ef6ec`), same as https://github.com/Pasta-Devs/Marinara-Engine v2.5.1. Use it when a feature looks
  broken or missing after earlier modification work.
- Features removed **on purpose** at the owner's request: Gacha Forge, Noodle, Slurp, Game mode. Do not
  restore them. Server/data code that remains for them exists for data compatibility; leave it unless asked.
- The original personal extensions these integrations were ported from (TTS, translation presets, memory
  vault) are supplied by the owner as attachments; the excerpt studio source is
  https://github.com/boricha417/marinara-excerpt-studio.

### Environment setup (cloud sandbox)

- Node `>=24 <27` is required. If the sandbox has an older Node: `npm i -g node@24` and put
  `~/.npm-global/bin` first on `PATH`.
- `pnpm install --frozen-lockfile` with `ONNXRUNTIME_NODE_INSTALL_CUDA=skip` (the CUDA add-on download
  host is blocked in the sandbox; the CPU binding still installs).
- Useful checks: `pnpm build`, `pnpm format:check`, `pnpm --filter @marinara-engine/client lint`,
  `pnpm check:e2e-types`, `node ./scripts/run-regressions.mjs --filter <name>`, and Playwright with
  `PLAYWRIGHT_ONLY_PROJECT=desktop|mobile npx playwright test -c playwright.config.ts <file>
  --project=desktop-chromium|mobile-chromium`.
- Known pre-existing failures on `main` (2026-10-23, not caused by later work): 4 of 7 `pnpm smoke:ui`
  tests (home shell panels, chat mode tabs, conversation reasoning, game GM panel). The game one relates
  to the intentional Game mode removal.
