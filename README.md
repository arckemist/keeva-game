# keeva-game

Quiz game mode for KeeVa (Primary 2).

Spire-style: 5 small enemies + 1 boss per run, MC-only questions from PDF.

**Live:** https://keeva-game.arckemistry.com

## Files

- `index.html` — entry (redirects to game.html)
- `game.html` — game UI shell (4 screens: landing, fight, rest, victory/lose)
- `game.js` — state machine + fight loop + after-run stats
- `game.css` — styles
- `game_data.json` — 70 MC from PDF (Agama Islam Grade 2, 7 domains)
- `assets/characters/` — keeva_warrior.svg, keisha_ice_mage.svg
- `assets/enemies/` — dragon boss, goblin, skeleton SVGs

## Game Loop (v1)

- 1 run = 5 small + 1 boss = 6 fights
- Hero HP 5, Skill 1 (saves from 1 wrong answer)
- Per fight: 1 MC question. Correct = 1 damage to enemy. Wrong = skill check, else 1 damage to hero.
- Boss takes 5 hits to defeat (same mechanic, 5 questions).
- After-run summary: accuracy %, strongest/weakest domain, time.

## How to Update Questions

1. Drop new PDF in `/home/excal/.hermes/document_cache/`
2. Run `pdf-quiz-game` skill to extract + generate 70 MC
3. Replace `game_data.json` (schema unchanged)
4. Commit + push (auto-deploys via Cloudflare Workers)

See `/home/excal/quiz-game-design.md` for full design spec.
