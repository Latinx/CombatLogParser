# CombatLog Parser — Frontend Design Plan

## Subject & Audience
**Subject:** World of Warcraft combat log analyzer — upload a `.txt` log, get fight breakdowns, player performance, mechanics timelines.
**Audience:** Raid leaders, theorycrafters, guild officers, players reviewing pulls.
**Single Job:** Make a raw combat log legible. Turn 90k lines of text into "what happened, when, and who did what."

---

## Palette (6 named values)

| Token | Hex | Role |
|-------|-----|------|
| `ink-well` | `#0d0b08` | Deepest bg — warm undertone |
| `parchment` | `#1a1510` | Primary surface — cards, panels |
| `parchment-raised` | `#241e18` | Hover/focus, input backgrounds |
| `gold-vein` | `#c9a84c` | Primary accent — headers, CTAs |
| `gold-glint` | `#f0d47a` | Hover/active, highlighted numbers |
| `ink` | `#e8dfd0` | Body text — warm off-white |

**Class color system (semantic, not decorative):**
```css
--class-warrior: #c69b6d;
--class-paladin: #f48cba;
--class-hunter: #aad372;
--class-rogue: #fff468;
--class-priest: #ffffff;
--class-dk: #c41e3a;
--class-shaman: #0070dd;
--class-mage: #3fc7eb;
--class-warlock: #8788ee;
--class-monk: #00ff98;
--class-dh: #a330c9;
--class-evoker: #33937f;
```

---

## Typography

| Role | Font | Why |
|------|------|-----|
| **Display** | `Cinzel` | WoW-like serif for titles, boss names. Used sparingly. |
| **Body** | `DM Sans` | Geometric humanist for UI text, tables, tooltips. |
| **Data/Mono** | `JetBrains Mono` | Clarity for timestamps, spell IDs, numbers. |

**Type Scale (clamp-based, fluid):**
- `--text-xs`: 0.7rem / 1.3
- `--text-sm`: 0.8125rem / 1.4
- `--text-base`: 1rem / 1.6
- `--text-lg`: 1.125rem / 1.5
- `--text-xl`: 1.375rem / 1.4
- `--text-2xl`: clamp(1.75rem, 1.5rem + 1.25vw, 2.5rem) / 1.2
- `--text-3xl`: clamp(2.25rem, 1.75rem + 2.5vw, 3.5rem) / 1.1

---

## Layout Concept

**"The Open Spellbook"**

```
+------------------------------------------------------------------+
|  COMBAT LOG PARSER                 [Load Log] [Load Directory]     |
+------------------------------------------------------------------+
|  [Overall] [Fights] [Players] [Timeline] [Deaths] [Auras] [Raw]  |
+------------------------------------------------------------------+
|                                                                    |
|  +--------------------------------------------------------------+  |
|  |  HERO: Upload zone / Fight list / Overall summary            |  |
|  |  -- or --                                                    |  |
|  |  SELECTED FIGHT or OVERALL DETAIL                            |  |
|  |                                                              |  |
|  |  [Summary] [Damage] [Healing] [Buffs] ... tab subnav         |  |
|  |                                                              |  |
|  |  +--------------------+  +--------------------+               |  |
|  |  | Damage Done       |  | Damage Taken       |  Paired       |  |
|  |  | #1 Warrior 1.2M   |  | (same layout)      |  report       |  |
|  |  | #2 Mage   980K    |  | ...                |  panels       |  |
|  |  | ...               |  |                    |               |  |
|  |  +--------------------+  +--------------------+               |  |
|  |                                                              |  |
|  |  Actor filter: [All] [Players] (event-level filter)          |  |
|  |                                                              |  |
|  |  Player rows: class-colored | metric bar | spell drilldown   |  |
|  +--------------------------------------------------------------+  |
|                                                                    |
+------------------------------------------------------------------+
```

**Responsive:** Tab bar wraps at < 1024px, stacks vertical at < 640px.

## Signature Element

**The Encounter Timeline** — a horizontal (desktop) / vertical (mobile) visualization of a single fight:

- Top: Boss health bar (animated on load, segmented by phase)
- Middle: Phase transition markers (gold diamonds with phase name)
- Bottom: Each player = a class-colored track. Events = dots on the track:
  - ▸ Damage: small square, sized by magnitude
  - ▸ Healing: small circle, green tint
  - ▸ Cooldowns: diamond, gold border
  - ▸ Mechanics (debuffs, interrupts, deaths): distinct shapes (▲, ■, ✕)
- Hover any dot → tooltip with exact timestamp, spell name, value, target
- Click → filters the raw log panel to that moment

This is the *one thing* that makes this tool legible at a glance. Everything else serves it.

---

## Motion (Restrained)

1. **Page load:** Header + sidebar slide in from left (200ms stagger), main content fades up (300ms).
2. **Timeline reveal:** Boss health bar draws left→right (600ms ease-out), phase markers pop in sequence (100ms stagger), player tracks draw their dots (400ms, per-track stagger 50ms).
3. **Hover micro-interactions:** Cards lift 2px, gold border glows (150ms). Timeline dots scale 1.5×.
4. **Tab switch:** Content cross-fades (150ms), no slide.
5. **Respects `prefers-reduced-motion`** — all animations disable instantly.

---

## Copy Strategy

| Element | Text | Rationale |
|---------|------|-----------|
| Page title | `Combat Log Parser` | Functional, no marketing fluff |
| Upload zone | `Drag a WoWCombatLog.txt here` | Imperative, specific file name |
| Upload zone (sub) | `Or click to browse. Parses locally — nothing leaves your machine.` | Privacy reassurance, active voice |
| Empty state | `No log loaded. Drop a file to begin.` | Direct instruction |
| Fight card | `Mythic Razan • 6:42 • Kill` | Difficulty • Boss • Duration • Result |
| Player card | `Vexie — Discipline Priest • 84.2k HPS • 2.1M Healing` | Name — Spec • Primary metric • Total |
| Timeline phase | `Phase 2: Adds` | Descriptive, not numbered |
| Tooltip | `03:14.281 — Power Word: Shield → Vexie — 42,311 absorb` | Timestamp — Spell → Target — Value |

---

## Risk & Justification

**Risk:** Dark parchment + gold is a known "fantasy UI" trope.
**Mitigation:** The *structure* is not a fantasy trope — it's a data tool. The palette serves legibility (high contrast, class colors pop). The signature timeline is a genuine analytics instrument, not decoration. The type pairing (Cinzel/DM Sans/JetBrains Mono) is deliberate, not "fantasy default."

**Risk:** Timeline is complex to build.
**Justification:** It's the *only* complex interaction. Everything else is static HTML/CSS. The timeline carries the entire value proposition.

---

## Self-Critique Checklist (Pre-Build)

- [ ] No cream background (#F4F1EA) — using warm near-black instead
- [ ] No acid green/vermilion accent — using WoW gold
- [ ] No numbered section markers (01/02/03) — tabs are semantic (Fights/Players/Timeline)
- [ ] No generic "hero with big number" — hero *is* the upload zone or fight list
- [ ] Class colors are semantic data encoding, not decoration
- [ ] Cinzel used only for display, never body text
- [ ] JetBrains Mono only for tabular data
- [ ] Reduced-motion implemented
- [ ] Keyboard focus visible (gold ring)
- [ ] Mobile-first responsive