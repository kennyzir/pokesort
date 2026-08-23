# Puzzle fact evidence register

Review date: 2026-08-23. Scope: the 12 groups currently shipped in `assets/puzzle-data.js`.

This register makes the editorial check reproducible; it does not claim that PokeAPI or a community encyclopedia is an official Pokémon authority. PokeAPI is used as structured reference data for IDs, types, species flags, debut generation, and evolution chains. Bulbapedia is used for named game concepts and the explicitly community-defined pseudo-legendary convention. New or changed groups must update this table before publication. The machine-checked companion `puzzle-evidence.json` records every National ID, exact hint, exact explanation, definition, source URL/type, boundary, and review date; the test suite requires it to match the shipped data.

| Pack/group | Definition checked | Members checked | Source and type | Boundary / result |
|---|---|---|---|---|
| 1. Eeveelutions | Species that evolve from Eevee | Vaporeon, Jolteon, Flareon, Espeon | [Official Pokémon Eevee Evolution collection](https://www.pokemon.com/us/news/which-eevee-evolution-from-the-eevee-collection-should-you-bring-home) (publisher); [PokeAPI evolution-chain documentation](https://pokeapi.co/docs/v2#evolution-section) (structured reference) | PASS; family relationship, not shared type |
| 1. Restored fossils | Pokémon restored/revived from fossils | Omanyte, Kabuto, Aerodactyl, Cranidos | [Fossil](https://bulbapedia.bulbagarden.net/wiki/Fossil_Pok%C3%A9mon) (community encyclopedia) | PASS; direct restored species, not every descendant |
| 1. Baby Pokémon | Species whose structured species record has `is_baby: true` | Pichu, Cleffa, Igglybuff, Togepi | [PokeAPI Pokémon Species schema](https://pokeapi.co/docs/v2#pokemon-species) and member species endpoints keyed by stored National IDs (structured reference) | PASS; official-style classification represented as a species flag |
| 1. Ultra Beasts | Pokémon classified as Ultra Beasts | Nihilego, Buzzwole, Pheromosa, Xurkitree | [Ultra Beast](https://bulbapedia.bulbagarden.net/wiki/Ultra_Beast) (community encyclopedia) | PASS; classification, not typing |
| 2. Fire starter finals | Final forms of Fire-type first-partner families | Charizard, Typhlosion, Blaziken, Infernape | [First partner Pokémon](https://bulbapedia.bulbagarden.net/wiki/First_partner_Pok%C3%A9mon) (community encyclopedia); [PokeAPI evolution-chain documentation](https://pokeapi.co/docs/v2#evolution-section) (structured reference) | PASS; final evolutionary stage of the Fire partner line |
| 2. Water / Ground | Default forms with both Water and Ground types | Quagsire, Swampert, Whiscash, Gastrodon | [PokeAPI Pokémon and type schemas](https://pokeapi.co/docs/v2#pokemon) with member endpoints keyed by stored IDs (structured reference) | PASS; both types required |
| 2. Dragon pseudo-legendaries | Dragon-type members of the fan/community pseudo-legendary convention | Dragonite, Salamence, Garchomp, Hydreigon | [Powerhouse/Pseudo-legendary Pokémon](https://bulbapedia.bulbagarden.net/wiki/Pseudo-legendary_Pok%C3%A9mon) (community encyclopedia); [PokeAPI type schema](https://pokeapi.co/docs/v2#types) (structured reference) | PASS with label boundary: this is a community convention, not an official Pokédex flag |
| 2. Mythical Pokémon | Species whose structured species record has `is_mythical: true` | Mew, Celebi, Jirachi, Manaphy | [PokeAPI Pokémon Species schema](https://pokeapi.co/docs/v2#pokemon-species) (structured reference); [Mythical Pokémon](https://bulbapedia.bulbagarden.net/wiki/Mythical_Pok%C3%A9mon) (community encyclopedia) | PASS; Mythical, not the broader Legendary label |
| 3. Kanto Poison types | Generation I species whose default forms include Poison | Arbok, Nidoqueen, Muk, Weezing | [PokeAPI generation and Pokémon schemas](https://pokeapi.co/docs/v2#games-section) (structured reference) | PASS; “Kanto” means debut generation/region, not current habitat |
| 3. Classic trade evolutions | Species reached by the original no-item trade trigger | Alakazam, Machamp, Golem, Gengar | [Trade Evolution](https://bulbapedia.bulbagarden.net/wiki/Trade_Evolution) (community encyclopedia); [PokeAPI EvolutionDetail schema](https://pokeapi.co/docs/v2#evolution-section) (structured reference) | PASS; excludes later alternate methods |
| 3. Single-stage Normal types | Introduced without an evolution relative at debut and Normal-typed | Tauros, Kangaskhan, Snorlax, Miltank | [PokeAPI species, generation, and evolution-chain schemas](https://pokeapi.co/docs/v2#pokemon-section) (structured reference) | PASS only with “at debut”; later family additions do not rewrite the historical condition |
| 3. Stone evolutions | Species reached with an evolution-item trigger | Arcanine, Vileplume, Starmie, Chandelure | [Evolutionary items](https://bulbapedia.bulbagarden.net/wiki/Evolutionary_items) (community encyclopedia); [PokeAPI EvolutionDetail schema](https://pokeapi.co/docs/v2#evolution-section) (structured reference) | PASS; original stone method; Vileplume intentionally overlaps Kanto Poison |

## Review method

1. Match every displayed name and National Pokédex ID to the structured species record.
2. For type groups, require every stated type, not merely one overlapping type.
3. For evolution groups, inspect the family chain and trigger rather than inferring from appearance.
4. For time-sensitive family claims, state the version boundary (`at debut`, `original method`, or `default form`).
5. Treat fan terminology as a community convention in both the puzzle label and explanation.
