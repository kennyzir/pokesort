# Keyword and intent map

Research date: 2026-08-23. GSC data is unavailable, so demand evidence is qualitative and no search volume is claimed. This revision corrects an earlier entity error: **Pokésort is a Daily six-Pokémon minigame inside the parent game Pokelike.** That makes the topic relevant to a PokeSort resource site; the required separation is between search tasks and destination pages, not between the entities themselves. The full query map is in `02-keyword-intent-map.csv`.

## Mechanic and routing decisions

- **Pokelike / 6-link sequence:** BUILD `/pokelike-pokesort/` for the parent/subgame relationship, rules, recurring link types, solving method, and local worksheet. Never send these users to the independent 4×4 board as if it were the Pokelike answer.
- **Current Pokelike hint/answer:** HOLD one future canonical `/pokelike-pokesort/today/` until an auditable daily-data process can verify the six Pokémon, five links, order, date, and reset boundary. The query is relevant; the missing data blocks publication, not the topic.
- **Pokelike solver:** HOLD `/pokelike-pokesort/solver/` until it is a complete working six-position solver. A public GitHub solver proves the task and competition exist, but a worksheet must not be mislabeled as a solver.
- **4×4 grouping:** target `/`, `/infinite/`, `/archive/`, `/how-to-play/`, and `/categories/` with explicit 4×4 language.
- **Generic Pokémon Connections:** target only when the 4×4 product satisfies the task.
- **Mixed:** disambiguate or route by modifier. Do not force one mechanic onto the other.

## Opportunity scoring

Scores use Intent Fit (25), Ability (20), Unique Product Value (20), SERP Opportunity (15), Demand Evidence (10), and Efficiency (10). Penalties are evidence-informed judgments, not volume estimates.

| Candidate | Intent Fit /25 | Ability /20 | Unique /20 | SERP /15 | Demand /10 | Efficiency /10 | Raw | Mechanic | Thin | Cannib. | IP | Freshness | Risk | Final | Confidence | Decision | Reason |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---|---|
| `/pokelike-pokesort/` | 25 | 18 | 17 | 13 | 8 | 7 | 88 | 0 | -3 | 0 | -3 | -8 | -14 | 74 | High | BUILD | Sourced guide plus real worksheet |
| `/infinite/` | 23 | 19 | 18 | 12 | 7 | 9 | 88 | -5 | -2 | 0 | -2 | 0 | -9 | 79 | Medium | BUILD | Label the independent 4×4 mechanic |
| `/archive/` | 23 | 18 | 18 | 13 | 7 | 8 | 87 | 0 | -2 | 0 | -2 | -3 | -7 | 80 | High | IMPROVE | Preserve crawlable rolling archive |
| dated 4×4 pages | 22 | 19 | 16 | 10 | 4 | 8 | 79 | 0 | -3 | -2 | -2 | -6 | -13 | 66 | Medium | HOLD | Hold index release until packs are unique |
| `/categories/` | 21 | 18 | 18 | 10 | 6 | 9 | 82 | -6 | -3 | 0 | -2 | -2 | -13 | 69 | Medium | BUILD | Explicit 4×4 pack reference |
| future Pokelike `/today/` with verified feed | 25 | 14 | 18 | 12 | 10 | 5 | 84 | 0 | -2 | -3 | -3 | -10 | -18 | 66 | Medium | HOLD | Verified daily-data Gate not met |
| future complete Pokelike solver | 25 | 15 | 20 | 14 | 8 | 6 | 88 | 0 | -2 | 0 | -3 | -5 | -10 | 78 | Medium | HOLD | Complete relation engine not built |
| unverified Pokelike Today page now | 25 | 3 | 4 | 12 | 10 | 8 | 62 | 0 | -20 | -5 | -3 | -10 | -38 | 24 | High | HOLD | Relevant task but publication would fabricate volatile data |
| worksheet falsely called a solver | 18 | 4 | 5 | 14 | 8 | 8 | 57 | -10 | -17 | 0 | -3 | -4 | -34 | 23 | High | DO_NOT_TARGET | Mislabels a non-solving worksheet |
| per-Pokémon pages | 10 | 6 | 5 | 8 | 6 | 10 | 45 | -5 | -20 | -12 | -5 | -5 | -47 | -2 | High | DO_NOT_TARGET | No distinct supported task |

## What the live evidence establishes

- The official Pokelike home screen lists Story, Battle Tower, Challenges, and **Daily Pokésort**, described as ordering six Pokémon so every link matches.
- A current Pokelike guide exposes a dated answer as six Pokémon, five links, and a correct order; its FAQ describes Pokésort as a daily Pokelike minigame with streak rewards.
- r/Pokelike contains dated hints and solving discussions using generation, evolution stage, colour, type, and matchup relations. The community policy welcomes hints but discourages unmarked spoilers.
- `sh0gg/pokersort-solver` is a real six-Pokémon solver using PokéAPI data and permutation testing. The old statement that no strong matching solver existed was false.
- `pokesort.com`, Pokémon Connections, and PokeConnections remain real 4×4 grouping competitors. Those results justify maintaining a separate 4×4 cluster rather than conflating both mechanics.

## Dated SERP/source evidence

Observed on 2026-08-23. Result classes are recorded without inventing stable ranks.

| Query/task | Observed source | What it proves | Page implication |
|---|---|---|---|
| `pokelike pokesort` | `https://pokelike.xyz/` | Pokelike is parent; Daily Pokésort is an in-game six-Pokémon feature | BUILD `/pokelike-pokesort/` |
| `pokesort answer today` | `https://pokelike-guide.fr/en/pokesort/` | Live answer competition contains order plus five link explanations | HOLD `/pokelike-pokesort/today/` until verified data |
| `what is pokesort` | Pokelike home + FAQ | Entity definition and daily/streak task | MERGE into guide |
| `pokesort tips` | r/Pokelike tips and dated hint threads | Real six-link solving pain points and spoiler sensitivity | BUILD six-link tips within guide |
| `pokesort solver` | `https://github.com/sh0gg/pokersort-solver` | A functioning solver competitor and expected rule families exist | HOLD a distinct complete solver URL |
| `pokesort` / `pokesort game` | `https://pokesort.com/` plus Pokelike results | Brand query is mixed between 4×4 and Pokelike contexts | Homepage must say 4×4 and link the Pokelike guide |
| `pokemon connections game` | `https://pokemonconnections.com/` | Competitive playable 4×4 intent | Continue 4×4 product cluster |
| `pokemon connections puzzle` | `https://www.pokeconnections.com/` | Grouping-game competitors expose hints/reference features | Continue 4×4 product cluster |

## Publication boundary

Relevance does not justify fabrication. The guide can rank now because its evergreen entity/rules task is sourced and its worksheet is real. A Today answer page can rank only when it truthfully completes the volatile daily task. All hint, answer, solution, and order variants for the same day should consolidate into one stable `/pokelike-pokesort/today/` URL rather than several thin pages.
