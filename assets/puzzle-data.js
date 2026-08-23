export const ARCHIVE_HISTORY_DAYS = 30;

export const GROUPS = [
  [
    { name: "Eeveelutions", hint: "Every member evolves from the same Pokémon.", explanation: "Vaporeon, Jolteon, Flareon, and Espeon all evolve directly from Eevee.", color: "#f5d65b", mons: [["Vaporeon", 134], ["Jolteon", 135], ["Flareon", 136], ["Espeon", 196]] },
    { name: "Restored fossils", hint: "Think about how these Pokémon are obtained.", explanation: "Omanyte, Kabuto, Aerodactyl, and Cranidos are obtained by restoring their corresponding fossils.", color: "#8bc5f5", mons: [["Omanyte", 138], ["Kabuto", 140], ["Aerodactyl", 142], ["Cranidos", 408]] },
    { name: "Baby Pokémon", hint: "These Pokémon sit before a familiar evolution.", explanation: "Pichu, Cleffa, Igglybuff, and Togepi are officially classified as baby Pokémon at the start of their evolution families.", color: "#f6a2ae", mons: [["Pichu", 172], ["Cleffa", 173], ["Igglybuff", 174], ["Togepi", 175]] },
    { name: "Ultra Beasts", hint: "Their classification comes from another dimension.", explanation: "Nihilego, Buzzwole, Pheromosa, and Xurkitree are all classified as Ultra Beasts.", color: "#a8dbb6", mons: [["Nihilego", 793], ["Buzzwole", 794], ["Pheromosa", 795], ["Xurkitree", 796]] },
  ],
  [
    { name: "Fire starter finals", hint: "They are the last stage of the same starter type.", explanation: "Charizard, Typhlosion, Blaziken, and Infernape are fully evolved Fire-type starter partners.", color: "#f5d65b", mons: [["Charizard", 6], ["Typhlosion", 157], ["Blaziken", 257], ["Infernape", 392]] },
    { name: "Water / Ground", hint: "Each has the same dual typing.", explanation: "Quagsire, Swampert, Whiscash, and Gastrodon all have the exact Water/Ground type combination.", color: "#8bc5f5", mons: [["Quagsire", 195], ["Swampert", 260], ["Whiscash", 340], ["Gastrodon", 423]] },
    { name: "Dragon pseudo-legendaries", hint: "Look at powerful late-game evolution families.", explanation: "Dragonite, Salamence, Garchomp, and Hydreigon are Dragon-type final evolutions commonly classified as pseudo-legendary Pokémon.", color: "#f6a2ae", mons: [["Dragonite", 149], ["Salamence", 373], ["Garchomp", 445], ["Hydreigon", 635]] },
    { name: "Mythical Pokémon", hint: "Rarity—not ordinary typing—is the link.", explanation: "Mew, Celebi, Jirachi, and Manaphy are all Mythical Pokémon rather than ordinary legendary or high-stat species.", color: "#a8dbb6", mons: [["Mew", 151], ["Celebi", 251], ["Jirachi", 385], ["Manaphy", 490]] },
  ],
  [
    { name: "Kanto Poison types", hint: "They share a type and debut region.", explanation: "Arbok, Nidoqueen, Muk, and Weezing are Poison-type Pokémon introduced in Kanto's first generation.", color: "#f5d65b", mons: [["Arbok", 24], ["Nidoqueen", 31], ["Muk", 89], ["Weezing", 110]] },
    { name: "Classic trade evolutions", hint: "Their original evolution method required another player.", explanation: "Alakazam, Machamp, Golem, and Gengar originally evolved only when their previous stages were traded.", color: "#8bc5f5", mons: [["Alakazam", 65], ["Machamp", 68], ["Golem", 76], ["Gengar", 94]] },
    { name: "Single-stage Normal types", hint: "On debut, none evolved from or into another Pokémon.", explanation: "Tauros, Kangaskhan, Snorlax, and Miltank were single-stage Normal-type Pokémon when each debuted.", color: "#f6a2ae", mons: [["Tauros", 128], ["Kangaskhan", 115], ["Snorlax", 143], ["Miltank", 241]] },
    { name: "Stone evolutions", hint: "An item triggers the final evolution.", explanation: "Arcanine, Vileplume, Starmie, and Chandelure evolve from their previous stages when an evolution stone is used.", color: "#a8dbb6", mons: [["Arcanine", 59], ["Vileplume", 45], ["Starmie", 121], ["Chandelure", 609]] },
  ],
];

export const PACK_NOTES = [
  "The intended groups use evolution origin and official classifications, not a broad shared type. Several members also share debut generations, so a generation-only guess will not leave four complete groups.",
  "A broad Fire or high-power guess is not enough: the Fire group requires fully evolved starters, Water/Ground requires both types, and Mythical is not interchangeable with pseudo-legendary.",
  "Vileplume is also a Kanto Poison type, but it belongs with the stone evolutions here. That overlap is why the intended Poison group must still leave a complete four-member stone group.",
];

export function hash(text) {
  let value = 2166136261;
  for (const character of text) value = Math.imul(value ^ character.charCodeAt(0), 16777619);
  return value >>> 0;
}

export function puzzleFor(seedText) {
  return GROUPS[hash(seedText) % GROUPS.length];
}
