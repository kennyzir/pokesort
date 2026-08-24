import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const SOURCE_REPOSITORY = "https://github.com/PokeAPI/pokeapi";
const SOURCE_COMMIT = "f15414790832c88d784d1537658b957fd73cbbbd";
const SOURCE_COMMIT_TIMESTAMP = "2026-08-23T12:46:45Z";
const SOURCE_DIRECTORY = "data/v2/csv";
const SOURCE_FILES = [
  "pokemon_species.csv",
  "pokemon.csv",
  "pokemon_types.csv",
  "types.csv",
  "pokemon_species_names.csv",
  "pokemon_colors.csv",
  "generations.csv",
];
const ENGLISH_LANGUAGE_ID = 9;
const NATIONAL_DEX_MAX_ID = 1025;
const outputUrl = new URL("../../data/pokemon/pokemon-facts.v1.json", import.meta.url);

function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.replace(/\r$/, ""));
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }
  if (quoted) throw new Error("CSV ended inside a quoted field");
  if (field || row.length) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }
  const [header, ...body] = rows;
  if (!header?.length) throw new Error("CSV has no header");
  return body.map((values, rowIndex) => {
    if (values.length !== header.length) throw new Error(`CSV row ${rowIndex + 2} has ${values.length} fields; expected ${header.length}`);
    return Object.fromEntries(header.map((name, columnIndex) => [name, values[columnIndex]]));
  });
}

function integer(value, context, { nullable = false } = {}) {
  if (nullable && value === "") return null;
  if (!/^-?\d+$/.test(value)) throw new Error(`${context} is not an integer: ${value}`);
  return Number(value);
}

function booleanFlag(value, context) {
  const parsed = integer(value, context);
  if (parsed !== 0 && parsed !== 1) throw new Error(`${context} must be 0 or 1`);
  return parsed === 1;
}

async function downloadSourceFile(fileName) {
  const url = `https://raw.githubusercontent.com/PokeAPI/pokeapi/${SOURCE_COMMIT}/${SOURCE_DIRECTORY}/${fileName}`;
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { "User-Agent": "pokesort-facts-refresh/1.0" } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const text = await response.text();
      return {
        fileName,
        url,
        text,
        sha256: createHash("sha256").update(text).digest("hex"),
      };
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 500));
    }
  }
  throw new Error(`Could not download ${url} after 3 attempts`, { cause: lastError });
}

function uniqueMap(rows, keyName, label) {
  const result = new Map();
  for (const row of rows) {
    const key = integer(row[keyName], `${label}.${keyName}`);
    if (result.has(key)) throw new Error(`Duplicate ${label} key ${key}`);
    result.set(key, row);
  }
  return result;
}

function buildSnapshot(downloads) {
  const csv = Object.fromEntries(downloads.map(({ fileName, text }) => [fileName, parseCsv(text)]));
  const speciesRows = csv["pokemon_species.csv"]
    .filter((row) => integer(row.id, "pokemon_species.id") <= NATIONAL_DEX_MAX_ID)
    .sort((left, right) => Number(left.id) - Number(right.id));
  const speciesById = uniqueMap(speciesRows, "id", "pokemon_species");
  if (speciesRows.length !== NATIONAL_DEX_MAX_ID || speciesRows[0].id !== "1" || speciesRows.at(-1).id !== String(NATIONAL_DEX_MAX_ID)) {
    throw new Error(`Expected continuous National Pokédex species 1-${NATIONAL_DEX_MAX_ID}; found ${speciesRows.length}`);
  }

  const defaultPokemonBySpeciesId = new Map();
  for (const row of csv["pokemon.csv"]) {
    if (!booleanFlag(row.is_default, `pokemon ${row.id}.is_default`)) continue;
    const speciesId = integer(row.species_id, `pokemon ${row.id}.species_id`);
    if (!speciesById.has(speciesId)) continue;
    if (defaultPokemonBySpeciesId.has(speciesId)) throw new Error(`Species ${speciesId} has multiple default Pokémon rows`);
    defaultPokemonBySpeciesId.set(speciesId, row);
  }

  const typeById = new Map(csv["types.csv"].map((row) => [integer(row.id, "types.id"), row.identifier]));
  const typesByPokemonId = new Map();
  for (const row of csv["pokemon_types.csv"]) {
    const pokemonId = integer(row.pokemon_id, "pokemon_types.pokemon_id");
    const type = typeById.get(integer(row.type_id, "pokemon_types.type_id"));
    if (!type) throw new Error(`Unknown type for pokemon_types row ${pokemonId}`);
    const entries = typesByPokemonId.get(pokemonId) ?? [];
    entries.push({ slot: integer(row.slot, "pokemon_types.slot"), type });
    typesByPokemonId.set(pokemonId, entries);
  }

  const englishNameBySpeciesId = new Map(
    csv["pokemon_species_names.csv"]
      .filter((row) => integer(row.local_language_id, "pokemon_species_names.local_language_id") === ENGLISH_LANGUAGE_ID)
      .map((row) => [integer(row.pokemon_species_id, "pokemon_species_names.pokemon_species_id"), row.name]),
  );
  const colorById = new Map(csv["pokemon_colors.csv"].map((row) => [integer(row.id, "pokemon_colors.id"), row.identifier]));
  const generationById = new Map(csv["generations.csv"].map((row) => [integer(row.id, "generations.id"), row.identifier]));

  const childrenBySpeciesId = new Map(speciesRows.map((row) => [integer(row.id, "pokemon_species.id"), []]));
  for (const row of speciesRows) {
    const id = integer(row.id, "pokemon_species.id");
    const parentId = integer(row.evolves_from_species_id, `pokemon_species ${id}.evolves_from_species_id`, { nullable: true });
    if (parentId !== null) {
      if (!childrenBySpeciesId.has(parentId)) throw new Error(`Species ${id} evolves from missing species ${parentId}`);
      childrenBySpeciesId.get(parentId).push(id);
    }
  }
  for (const children of childrenBySpeciesId.values()) children.sort((left, right) => left - right);

  const depthMemo = new Map();
  function evolutionDepth(speciesId, active = new Set()) {
    if (depthMemo.has(speciesId)) return depthMemo.get(speciesId);
    if (active.has(speciesId)) throw new Error(`Evolution cycle includes species ${speciesId}`);
    active.add(speciesId);
    const row = speciesById.get(speciesId);
    const parentId = integer(row.evolves_from_species_id, `pokemon_species ${speciesId}.evolves_from_species_id`, { nullable: true });
    const depth = parentId === null ? 0 : evolutionDepth(parentId, active) + 1;
    active.delete(speciesId);
    depthMemo.set(speciesId, depth);
    return depth;
  }

  const pokemon = speciesRows.map((row) => {
    const id = integer(row.id, "pokemon_species.id");
    const defaultPokemon = defaultPokemonBySpeciesId.get(id);
    if (!defaultPokemon) throw new Error(`Species ${id} has no default Pokémon row`);
    const defaultPokemonId = integer(defaultPokemon.id, `pokemon species ${id}.defaultPokemonId`);
    const types = (typesByPokemonId.get(defaultPokemonId) ?? []).sort((left, right) => left.slot - right.slot).map(({ type }) => type);
    if (types.length < 1 || types.length > 2 || new Set(types).size !== types.length) throw new Error(`Species ${id} has invalid default-form types: ${types.join(",")}`);
    const generation = integer(row.generation_id, `pokemon_species ${id}.generation_id`);
    if (!generationById.has(generation)) throw new Error(`Species ${id} references missing generation ${generation}`);
    const color = colorById.get(integer(row.color_id, `pokemon_species ${id}.color_id`));
    if (!color) throw new Error(`Species ${id} references a missing color`);
    const parentId = integer(row.evolves_from_species_id, `pokemon_species ${id}.evolves_from_species_id`, { nullable: true });
    const childIds = childrenBySpeciesId.get(id);
    const stage = parentId === null ? (childIds.length ? "base" : "single") : (childIds.length ? "middle" : "final");
    return {
      id,
      identifier: row.identifier,
      name: englishNameBySpeciesId.get(id) ?? row.identifier,
      generation,
      color,
      types,
      evolution: {
        chainId: integer(row.evolution_chain_id, `pokemon_species ${id}.evolution_chain_id`),
        evolvesFromSpeciesId: parentId,
        evolvesToSpeciesIds: childIds,
        depth: evolutionDepth(id),
        stage,
      },
      flags: {
        isBaby: booleanFlag(row.is_baby, `pokemon_species ${id}.is_baby`),
        isLegendary: booleanFlag(row.is_legendary, `pokemon_species ${id}.is_legendary`),
        isMythical: booleanFlag(row.is_mythical, `pokemon_species ${id}.is_mythical`),
      },
      sourceRows: {
        pokemonSpeciesId: id,
        defaultPokemonId,
      },
      provenanceRefs: ["species", "englishName", "defaultFormTypes", "evolutionTopology"],
    };
  });

  const values = {
    types: [...new Set(pokemon.flatMap((entry) => entry.types))].sort(),
    generations: [...new Set(pokemon.map((entry) => entry.generation))].sort((left, right) => left - right),
    colors: [...new Set(pokemon.map((entry) => entry.color))].sort(),
    evolutionStages: [...new Set(pokemon.map((entry) => entry.evolution.stage))].sort(),
  };

  return {
    schemaVersion: 1,
    datasetId: `pokeapi-national-species-${SOURCE_COMMIT.slice(0, 12)}`,
    scope: {
      entity: "National Pokédex species",
      minSpeciesId: 1,
      maxSpeciesId: NATIONAL_DEX_MAX_ID,
      includedGenerations: values.generations,
      formPolicy: "Species-level facts use each species' PokeAPI default Pokémon row for typing; alternate forms are outside v1 scope.",
    },
    source: {
      provider: "PokéAPI",
      documentationUrl: "https://pokeapi.co/docs/v2",
      repository: SOURCE_REPOSITORY,
      commit: SOURCE_COMMIT,
      commitUrl: `${SOURCE_REPOSITORY}/commit/${SOURCE_COMMIT}`,
      commitTimestamp: SOURCE_COMMIT_TIMESTAMP,
      licenseUrl: `${SOURCE_REPOSITORY}/blob/${SOURCE_COMMIT}/LICENSE.md`,
      files: downloads.map(({ fileName, url, sha256 }) => ({ path: `${SOURCE_DIRECTORY}/${fileName}`, url, sha256 })),
    },
    fieldProvenance: {
      species: {
        fields: ["id", "identifier", "generation", "color", "flags", "evolution.chainId", "evolution.evolvesFromSpeciesId"],
        sourceFile: `${SOURCE_DIRECTORY}/pokemon_species.csv`,
        transformation: "Direct normalized columns; integer and 0/1 boolean conversion only.",
      },
      englishName: {
        fields: ["name"],
        sourceFile: `${SOURCE_DIRECTORY}/pokemon_species_names.csv`,
        transformation: `Row with local_language_id=${ENGLISH_LANGUAGE_ID}; identifier is a declared fallback if absent.`,
      },
      defaultFormTypes: {
        fields: ["types", "sourceRows.defaultPokemonId"],
        sourceFiles: [`${SOURCE_DIRECTORY}/pokemon.csv`, `${SOURCE_DIRECTORY}/pokemon_types.csv`, `${SOURCE_DIRECTORY}/types.csv`],
        transformation: "Select is_default=1 Pokémon row for the species, join slot-ordered type identifiers.",
      },
      evolutionTopology: {
        fields: ["evolution.evolvesToSpeciesIds", "evolution.depth", "evolution.stage"],
        sourceFile: `${SOURCE_DIRECTORY}/pokemon_species.csv`,
        transformation: "Invert evolves_from_species_id to obtain children; depth is root distance. Stage is single (no parent/children), base (children only), middle (parent and children), or final (parent only).",
      },
    },
    enumerations: values,
    pokemon,
  };
}

async function main() {
  const downloads = [];
  for (const fileName of SOURCE_FILES) {
    process.stdout.write(`Downloading ${fileName}... `);
    const download = await downloadSourceFile(fileName);
    downloads.push(download);
    console.log(download.sha256.slice(0, 12));
  }
  const snapshot = buildSnapshot(downloads);
  await mkdir(new URL("../../data/pokemon/", import.meta.url), { recursive: true });
  const json = `${JSON.stringify(snapshot, null, 2)}\n`;
  await writeFile(outputUrl, json, "utf8");
  console.log(`Wrote ${snapshot.pokemon.length} species to ${fileURLToPath(outputUrl)}`);
}

await main();
