---
id: 346740d8-09d6-430a-bbc0-afdee03f1619
created: '2026-07-26T01:52:57.846Z'
modified: '2026-07-26T01:52:57.846Z'
memory_type: context
tags: []
---
Important CombatLogParser project updates from the current session:

- The app is a single-page local WoW combat log parser in `index.html` with dense Warcraft Logs-style fight reports.
- Recent UI/report changes: fight list sorted newest-first; selecting a fight resets the scrollable `.main` container to top; expanded report panels keep their grid column width and grow downward instead of spanning full width; report rows/bars got visual polish with parent/child hierarchy rails, connector lines, inset spell drilldown trays, and second-depth target styling.
- Parser fixes: `ENVIRONMENTAL_DAMAGE` with advanced unit fields now skips those fields so falling damage is labeled `Falling` instead of Player-* GUID spell names; advanced payload owner pairs are scanned so non-`SPELL_SUMMON` units like Avatar of Bloodshed can roll up to their player owner (e.g. `Mellowed-Moonrunner-US`), making Bloodletting Lunge show under the owned pet in Damage Done.
- Standalone executable work: added `server.cjs`, a local static server that serves `index.html` on `127.0.0.1`, picks/falls back from `COMBAT_LOG_PARSER_PORT` default `8081`, opens browser unless `COMBAT_LOG_PARSER_NO_OPEN=1`, and is packaged into `dist/CombatLogParser.exe`.
- Tooling modernization: `package.json` is now native Node ESM for `src` with `server.cjs` kept CommonJS; removed Babel/Jest legacy stack; tests use `node:test` and `node:assert`; ESLint uses flat config; packaging uses maintained `@yao-pkg/pkg` with `node20-win-x64` target; `npm audit` is clean.
- Verification at end: `npm test`, `npm run build`, `npm run lint`, `npm audit --omit=optional` all passed; `node server.cjs` served `index.html`; `npm run build:win` produced `dist/CombatLogParser.exe`.
- Pushes should use the `gitea` remote.
