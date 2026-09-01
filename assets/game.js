import { emitPokeSortEvent } from "./analytics.js";

const $ = (selector) => document.querySelector(selector);
const sprite = (id) => `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${id}.png`;
const scriptStartedAt = performance.now();

if ($("#puzzle-grid")) {
  const params = new URLSearchParams(location.search);
  const pathDate = location.pathname.match(/^\/daily\/(\d{4}-\d{2}-\d{2})\/$/)?.[1];
  const gameMode = location.pathname === "/infinite/" || params.get("mode") === "infinite" ? "infinite" : pathDate ? "archive" : "daily";
  const browserUtcDate = () => new Date().toISOString().slice(0, 10);
  const validDateKey = (value) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return false;
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
  };
  const storageGet = (key) => { try { return localStorage.getItem(key); } catch { return null; } };
  const storageSet = (key, value) => { try { localStorage.setItem(key, value); } catch { /* Storage is optional. */ } };
  const canonicalize = (value) => Array.isArray(value) ? value.map(canonicalize) : value && typeof value === "object"
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])])) : value;
  const sha256Hex = async (value) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(typeof value === "string" ? value : JSON.stringify(canonicalize(value)))))]
    .map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const memberSignature = (ids) => [...ids].sort((left, right) => left - right).join("-");
  const safeInteger = (value, maximum = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(value) && value >= 0 && value <= maximum;
  const colors = ["#f5d65b", "#8bc5f5", "#f6a2ae", "#a8dbb6"];
  const ruleFamilies = new Set(["type", "monotype", "dual_type", "generation", "color", "evolution_stage", "baby", "legendary", "mythical"]);
  const hintFamilyCopy = {
    type: "This group uses default-form typing.", monotype: "This group uses default-form typing.", dual_type: "This group uses default-form typing.",
    generation: "This group uses a species’ introduction generation.", color: "This group uses a Pokédex species property.",
    evolution_stage: "This group uses evolution-chain topology.", baby: "This group uses a verified species flag.",
    legendary: "This group uses a verified species flag.", mythical: "This group uses a verified species flag.",
  };

  const storedRound = Number(storageGet("pokesort-infinite-round"));
  let round = safeInteger(storedRound) ? storedRound : 0;
  let dateKey = pathDate || browserUtcDate();
  let selected = [], solved = [], cards = [], pack = [], history = [], hintLevels = {};
  let mistakes = 0, revealed = false, gameOver = false;
  let completionRecorded = false, analyticsCompletionSent = false;
  let loadVersion = 0, loadState = "idle", activeLoadController = null;
  let activePuzzleId = "", activeContentHash = "", activeValidQuartets = new Set();
  let boardReadyAt = 0, gameStartSent = false;
  const boardReadySent = new Set();

  const analyticsBase = () => ({ game_mode: gameMode, elapsed_ms: Math.max(0, Math.round(performance.now() - boardReadyAt)) });
  const track = (eventName, values = {}) => emitPokeSortEvent(eventName, { ...analyticsBase(), ...values });
  const contractError = (stage) => Object.assign(new Error("Verified puzzle data is unavailable"), { errorStage: stage });
  const hash = (text) => { let value = 2166136261; for (const character of text) value = Math.imul(value ^ character.charCodeAt(0), 16777619); return value >>> 0; };
  const rng = (seed) => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let value = Math.imul(seed ^ seed >>> 15, 1 | seed); value = value + Math.imul(value ^ value >>> 7, 61 | value) ^ value; return ((value ^ value >>> 14) >>> 0) / 4294967296; };
  const shuffle = (items, seed) => { const output = [...items], random = rng(seed); for (let index = output.length - 1; index > 0; index--) { const other = Math.floor(random() * (index + 1)); [output[index], output[other]] = [output[other], output[index]]; } return output; };
  const stateKey = () => `pokesort:game:v2:${gameMode}:${activePuzzleId}`;
  const oldStateKey = () => gameMode === "daily" ? `pokesort-daily-${dateKey}` : gameMode === "infinite" ? `pokesort-infinite-${round}` : "";
  const readWins = () => { try { const value = JSON.parse(storageGet("pokesort-wins") || "[]"); return Array.isArray(value) ? value.filter(validDateKey) : []; } catch { return []; } };
  const boardCardMap = () => new Map(pack.flatMap((group) => group.mons).map(([name, id]) => [id, name]));
  const unsolvedGroups = () => pack.filter((group) => !solved.includes(group.signature));

  function normalizeGroups(groups, stage) {
    if (!Array.isArray(groups) || groups.length !== 4) throw contractError(stage);
    const normalized = groups.map((group, index) => {
      const mons = group.mons ?? group.members?.map(({ name, id }) => [name, id]);
      const ids = mons?.map(([, id]) => id) ?? [];
      const signature = group.memberSignature || memberSignature(ids);
      const family = group.ruleFamily || group.predicateSignature?.split(":", 1)[0] || group.matchingRuleEvidence?.[0]?.ruleId;
      if ((!group.name && !group.label) || !group.hint || !group.explanation || !Array.isArray(mons) || mons.length !== 4
        || ids.some((id) => !Number.isSafeInteger(id)) || new Set(ids).size !== 4 || signature !== memberSignature(ids)
        || mons.some(([name]) => typeof name !== "string" || !name) || !ruleFamilies.has(family)) throw contractError(stage);
      return { name: group.name || group.label, hint: group.hint, explanation: group.explanation, color: group.color || colors[index], mons, signature, ruleFamily: family };
    });
    if (new Set(normalized.flatMap(({ mons }) => mons.map(([, id]) => id))).size !== 16) throw contractError(stage);
    return normalized;
  }

  function validateSignatures(signatures, cardIds, intended, stage, { excludeIntended = false } = {}) {
    if (!Array.isArray(signatures)) throw contractError(stage);
    const cardSet = new Set(cardIds), seen = new Set();
    for (const signature of signatures) {
      if (!/^\d+(?:-\d+){3}$/.test(signature || "") || seen.has(signature)) throw contractError(stage);
      const ids = signature.split("-").map(Number);
      if (ids.length !== 4 || new Set(ids).size !== 4 || signature !== memberSignature(ids) || ids.some((id) => !cardSet.has(id)) || (excludeIntended && intended.has(signature))) throw contractError(stage);
      seen.add(signature);
    }
    return signatures;
  }

  async function validateHashObject(value, expectedHash, stage) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw contractError(stage);
    const { contentHash, ...base } = value;
    if (!/^[a-f0-9]{64}$/.test(contentHash || "") || (expectedHash && contentHash !== expectedHash) || await sha256Hex(base) !== contentHash) throw contractError(stage);
  }

  async function inspectEmbeddedDaily(value, expectedDate, stage) {
    if (!value || value.schemaVersion !== 1 || value.date !== expectedDate || !validDateKey(value.date)
      || !/^[a-f0-9]{64}$/.test(value.contentHash || "") || value.puzzleId !== `daily-${value.date}-${value.contentHash.slice(0, 16)}`) throw contractError(stage);
    const { payloadHash, ...payload } = value;
    if (!/^[a-f0-9]{64}$/.test(payloadHash || "") || await sha256Hex(payload) !== payloadHash) throw contractError(stage);
    const cardIds = value.cards?.map(({ id }) => id) ?? [];
    if (value.cards?.length !== 16 || cardIds.some((id) => !Number.isSafeInteger(id)) || new Set(cardIds).size !== 16
      || value.cards.some(({ name }) => typeof name !== "string" || !name) || value.boardSignature !== memberSignature(cardIds)) throw contractError(stage);
    const groups = normalizeGroups(value.groups, stage);
    if (memberSignature(groups.flatMap(({ mons }) => mons.map(([, id]) => id))) !== value.boardSignature) throw contractError(stage);
    const intended = new Set(groups.map(({ signature }) => signature));
    const validQuartets = validateSignatures(value.validQuartets, cardIds, intended, stage);
    return { date: value.date, puzzleId: value.puzzleId, contentHash: value.contentHash, groups, validQuartets };
  }

  async function inspectCurrentDailyResponse(value, expectedDate) {
    const stage = "daily_api_payload";
    if (!value || value.schemaVersion !== 1 || value.status !== "ready" || value.utcDate !== expectedDate || !value.manifest
      || value.puzzleId !== value.manifest.puzzleId || value.contentHash !== value.manifest.contentHash) throw contractError(stage);
    const manifest = value.manifest;
    if (manifest.date !== expectedDate || manifest.calendarSchemaVersion !== 1 || manifest.puzzleSchemaVersion !== 1
      || manifest.solver?.solutionCount !== 1 || manifest.solver?.countComplete !== true || manifest.quality?.accepted !== true
      || /(?:sourceSeed|productionSeed|calendarSeed|privateSeed|"seed"\s*:)/i.test(JSON.stringify(manifest))) throw contractError(stage);
    const cardIds = manifest.cards?.map(({ id }) => id) ?? [];
    if (manifest.cards?.length !== 16 || cardIds.some((id) => !Number.isSafeInteger(id)) || new Set(cardIds).size !== 16 || manifest.boardSignature !== memberSignature(cardIds)) throw contractError(stage);
    const groups = normalizeGroups(manifest.groups, stage);
    if (memberSignature(groups.flatMap(({ mons }) => mons.map(([, id]) => id))) !== manifest.boardSignature) throw contractError(stage);
    const intended = new Set(groups.map(({ signature }) => signature));
    const validQuartets = validateSignatures(manifest.quality.validOverlapMemberSignatures, cardIds, intended, stage, { excludeIntended: true });
    const { puzzleId, contentHash, ...base } = manifest;
    if (!/^[a-f0-9]{64}$/.test(contentHash || "") || await sha256Hex(base) !== contentHash || puzzleId !== `daily-${expectedDate}-${contentHash.slice(0, 16)}`) throw contractError(stage);
    return { date: expectedDate, puzzleId, contentHash, groups, validQuartets };
  }

  async function fetchJson(path, { signal, cache = "force-cache", stage } = {}) {
    try {
      const response = await fetch(path, { cache, signal });
      if (!response.ok) throw new Error("request failed");
      return await response.json();
    } catch (error) {
      if (error?.name === "AbortError") throw error;
      throw contractError(stage);
    }
  }

  async function infinitePuzzleForRound(value, signal) {
    const index = await fetchJson("/assets/infinite/index.json", { signal, stage: "infinite_index" });
    await validateHashObject(index, null, "infinite_index");
    if (index.schemaVersion !== 2 || index.poolGeneratorVersion !== "qb4-infinite-pool-v2" || index.poolSize !== 1_000
      || !safeInteger(index.sequence?.step) || !safeInteger(index.sequence?.offset) || !Array.isArray(index.shards)) throw contractError("infinite_index");
    const overlapIndex = await fetchJson("/assets/infinite-overlaps/index.json", { signal, stage: "infinite_overlap_contract" });
    await validateHashObject(overlapIndex, null, "infinite_overlap_contract");
    if (overlapIndex.schemaVersion !== 1 || overlapIndex.sourcePoolGeneratorVersion !== index.poolGeneratorVersion
      || overlapIndex.sourcePoolContentHash !== index.contentHash || overlapIndex.puzzleCount !== index.poolSize || !Array.isArray(overlapIndex.shards)) throw contractError("infinite_overlap_contract");
    const poolIndex = (index.sequence.offset + (value % index.poolSize) * index.sequence.step) % index.poolSize;
    const shardEntry = index.shards.find((entry) => poolIndex >= entry.start && poolIndex < entry.start + entry.count);
    if (!shardEntry) throw contractError("infinite_index");
    const overlapEntry = overlapIndex.shards.find((entry) => entry.sourceShard === shardEntry.file && entry.start === shardEntry.start && entry.count === shardEntry.count);
    if (!overlapEntry || overlapEntry.file !== shardEntry.file) throw contractError("infinite_overlap_contract");
    const [shard, overlapShard] = await Promise.all([
      fetchJson(`/assets/infinite/${shardEntry.file}`, { signal, stage: "infinite_shard" }),
      fetchJson(`/assets/infinite-overlaps/${overlapEntry.file}`, { signal, stage: "infinite_overlap_contract" }),
    ]);
    await validateHashObject(shard, shardEntry.contentHash, "infinite_shard");
    if (shard.schemaVersion !== 2 || shard.poolGeneratorVersion !== index.poolGeneratorVersion || shard.puzzles?.length !== shardEntry.count) throw contractError("infinite_shard");
    await validateHashObject(overlapShard, overlapEntry.contentHash, "infinite_overlap_contract");
    if (overlapShard.schemaVersion !== 1 || overlapShard.sourcePoolGeneratorVersion !== index.poolGeneratorVersion
      || overlapShard.sourceShard !== shardEntry.file || overlapShard.puzzles?.length !== shardEntry.count) throw contractError("infinite_overlap_contract");
    const offset = poolIndex - shardEntry.start;
    const puzzle = shard.puzzles[offset], overlap = overlapShard.puzzles[offset];
    if (!puzzle || puzzle.poolIndex !== poolIndex || puzzle.puzzleId !== `infinite-${puzzle.contentHash?.slice(0, 20)}` || !/^[a-f0-9]{64}$/.test(puzzle.contentHash || "")) throw contractError("infinite_shard");
    const groups = normalizeGroups(puzzle.groups, "infinite_shard");
    const cardIds = puzzle.cards?.map(({ id }) => id) ?? [];
    if (puzzle.cards?.length !== 16 || new Set(cardIds).size !== 16 || cardIds.some((id) => !Number.isSafeInteger(id))
      || puzzle.boardSignature !== memberSignature(cardIds) || memberSignature(groups.flatMap(({ mons }) => mons.map(([, id]) => id))) !== puzzle.boardSignature) throw contractError("infinite_shard");
    const intended = new Set(groups.map(({ signature }) => signature));
    if (!overlap || overlap.puzzleId !== puzzle.puzzleId || overlap.sourceContentHash !== puzzle.contentHash) throw contractError("infinite_overlap_contract");
    const validQuartets = validateSignatures(overlap.validOverlapMemberSignatures, cardIds, intended, "infinite_overlap_contract", { excludeIntended: true });
    return { puzzleId: puzzle.puzzleId, contentHash: puzzle.contentHash, groups, validQuartets };
  }

  function sanitizeHistory(items) {
    if (!Array.isArray(items)) return [];
    const boardIds = new Set(boardCardMap().keys());
    return items.filter((item) => item && Array.isArray(item.selectedIds) && item.selectedIds.length === 4
      && item.selectedIds.every((id) => Number.isSafeInteger(id) && boardIds.has(id)) && new Set(item.selectedIds).size === 4
      && ["correct", "valid_overlap", "invalid"].includes(item.outcome) && safeInteger(item.guessMatchCount, 4)
      && (item.repeated == null || typeof item.repeated === "boolean"))
      .slice(-20).map((item) => ({ selectedIds: [...item.selectedIds], outcome: item.outcome, guessMatchCount: item.guessMatchCount, repeated: item.repeated === true }));
  }

  function sanitizeHintLevels(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const signatures = new Set(pack.map(({ signature }) => signature)), output = {};
    for (const [signature, level] of Object.entries(value)) if (signatures.has(signature) && safeInteger(level, 3)) output[signature] = level;
    return output;
  }

  function savedStateIsConsistent(stored) {
    if (!stored || !Array.isArray(stored.solved) || !Array.isArray(stored.cards) || !safeInteger(stored.mistakes, 4)
      || typeof stored.revealed !== "boolean" || typeof stored.gameOver !== "boolean" || typeof stored.completionRecorded !== "boolean"
      || typeof (stored.analyticsCompletionSent ?? stored.analyticsCompletionRecorded) !== "boolean") return false;
    const groupSignatures = new Set(pack.map(({ signature }) => signature));
    if (new Set(stored.solved).size !== stored.solved.length || stored.solved.some((signature) => !groupSignatures.has(signature))) return false;
    const expected = pack.filter(({ signature }) => !stored.solved.includes(signature)).flatMap(({ mons }) => mons.map(([name, id]) => ({ name, id })));
    const expectedIds = new Map(expected.map(({ id, name }) => [id, name]));
    if (stored.cards.length !== expected.length || new Set(stored.cards.map(({ id }) => id)).size !== stored.cards.length
      || stored.cards.some((card) => !card || expectedIds.get(card.id) !== card.name)) return false;
    if ((stored.revealed && stored.solved.length !== 4) || (stored.solved.length === 4 && stored.cards.length !== 0)) return false;
    if (!stored.gameOver && (stored.mistakes >= 4 || stored.solved.length === 4 || stored.revealed)) return false;
    return true;
  }

  function migrateLegacyState() {
    const legacyKey = oldStateKey();
    if (!legacyKey) return null;
    try {
      const legacy = JSON.parse(storageGet(legacyKey));
      if (!legacy || legacy.mode !== (gameMode === "infinite" ? "infinite" : "daily") || legacy.puzzleId !== activePuzzleId
        || legacy.contentHash !== activeContentHash || !Array.isArray(legacy.solved)) return null;
      const byName = new Map(pack.map((group) => [group.name, group.signature]));
      const migrated = { ...legacy, solved: legacy.solved.map((name) => byName.get(name)), analyticsCompletionSent: false };
      if (migrated.solved.some((signature) => !signature) || !savedStateIsConsistent(migrated)) return null;
      return { ...migrated, history: [], hintLevels: {} };
    } catch { return null; }
  }

  function restoreState(freshCards) {
    let stored = null;
    try {
      const parsed = JSON.parse(storageGet(stateKey()));
      if ((parsed?.schemaVersion === 2 || parsed?.stateVersion === 2) && parsed.gameMode === gameMode && parsed.puzzleId === activePuzzleId && parsed.contentHash === activeContentHash) stored = parsed;
    } catch { /* Invalid JSON starts clean. */ }
    if (!stored) stored = migrateLegacyState();
    if (!stored || !savedStateIsConsistent(stored)) {
      cards = freshCards; solved = []; mistakes = 0; revealed = false; gameOver = false;
      completionRecorded = false; analyticsCompletionSent = false; history = []; hintLevels = {};
      return;
    }
    cards = stored.cards.map(({ id, name }) => ({ id, name }));
    solved = [...stored.solved]; mistakes = stored.mistakes; revealed = stored.revealed; gameOver = stored.gameOver;
    completionRecorded = stored.completionRecorded; analyticsCompletionSent = stored.analyticsCompletionSent ?? stored.analyticsCompletionRecorded;
    history = sanitizeHistory(stored.history); hintLevels = sanitizeHintLevels(stored.hintLevels);
  }

  function save() {
    if (loadState !== "ready" || !activePuzzleId) return;
    storageSet(stateKey(), JSON.stringify({
      schemaVersion: 2, stateVersion: 2, gameMode, puzzleId: activePuzzleId, contentHash: activeContentHash,
      cards, solved, mistakes, revealed, gameOver, completionRecorded, analyticsCompletionSent,
      history: history.slice(-20), hintLevels,
    }));
  }

  function updateStreak(referenceDateKey = browserUtcDate()) {
    const set = new Set(readWins());
    let count = 0, date = new Date(`${validDateKey(referenceDateKey) ? referenceDateKey : browserUtcDate()}T00:00:00Z`);
    while (set.has(date.toISOString().slice(0, 10))) { count++; date.setUTCDate(date.getUTCDate() - 1); }
    $("#streak-count").textContent = count;
  }

  const controls = () => ["#submit-selection", "#shuffle-board", "#deselect-all", "#reveal-board", "#hint-button", "#new-infinite"].map($).filter(Boolean);
  function setLoadState(next) {
    loadState = next; $("#puzzle-grid").dataset.loadState = next; $("#puzzle-grid").setAttribute("aria-busy", String(next === "loading"));
    if (next === "loading") {
      $("#game-status").textContent = "Loading verified puzzle data…";
      $("#puzzle-grid").replaceChildren(Object.assign(document.createElement("p"), { textContent: "Loading verified puzzle data…" }));
      $("#solved-groups").replaceChildren(); $("#progress-label").textContent = "Loading puzzle"; $("#mistakes").textContent = ""; $("#share-result").classList.add("hidden");
    }
    if (next !== "ready") controls().forEach((button) => { button.disabled = true; });
  }

  function resetLoadedPuzzle() {
    pack = []; cards = []; solved = []; selected = []; history = []; hintLevels = {};
    mistakes = 0; revealed = false; gameOver = true; completionRecorded = false; analyticsCompletionSent = false;
    activePuzzleId = ""; activeContentHash = ""; activeValidQuartets = new Set(); boardReadyAt = 0;
  }

  function embeddedValue() { try { return JSON.parse($("#pokesort-puzzle-data")?.textContent || "null"); } catch { return null; } }

  async function load({ focusOnReady = false } = {}) {
    const requestedLoadVersion = ++loadVersion, loadStartedAt = performance.now();
    activeLoadController?.abort(); const controller = new AbortController(); activeLoadController = controller;
    setLoadState("loading"); resetLoadedPuzzle();
    try {
      let active, loadOutcome;
      if (gameMode === "archive") {
        active = await inspectEmbeddedDaily(embeddedValue(), pathDate, "archive_payload"); loadOutcome = "archive_manifest";
      } else if (gameMode === "daily") {
        const currentDate = browserUtcDate();
        try { active = await inspectEmbeddedDaily(embeddedValue(), currentDate, "embedded_payload"); loadOutcome = "embedded"; }
        catch {
          const api = await fetchJson("/api/daily/current", { signal: controller.signal, cache: "no-store", stage: "daily_api_fetch" });
          active = await inspectCurrentDailyResponse(api, currentDate); loadOutcome = "api";
        }
      } else { active = await infinitePuzzleForRound(round, controller.signal); loadOutcome = "infinite_pool"; }
      if (requestedLoadVersion !== loadVersion || controller.signal.aborted) return;
      if (!active?.puzzleId || !active?.contentHash) throw contractError(gameMode === "infinite" ? "infinite_shard" : gameMode === "archive" ? "archive_payload" : "daily_api_payload");
      if (gameMode !== "infinite") dateKey = active.date;
      pack = active.groups; activePuzzleId = active.puzzleId; activeContentHash = active.contentHash; activeValidQuartets = new Set(active.validQuartets);
      const seedText = gameMode === "infinite" ? `infinite-${round}|${activeContentHash}` : `${dateKey}|${activeContentHash}`;
      const fresh = shuffle(pack.flatMap((group) => group.mons.map(([name, id]) => ({ name, id }))), hash(seedText));
      restoreState(fresh); selected = []; setLoadState("ready");
      try { render(); } catch { throw contractError("render"); }
      boardReadyAt = performance.now();
      if (!boardReadySent.has(activePuzzleId)) {
        boardReadySent.add(activePuzzleId);
        emitPokeSortEvent("pokesort_board_ready", { game_mode: gameMode, load_ms: Math.max(0, Math.round(boardReadyAt - (loadVersion === 1 ? scriptStartedAt : loadStartedAt))), mistakes, groups_solved: solved.length, outcome: loadOutcome });
      }
      if (solved.length === 4) finish(revealed ? "revealed" : "solved");
      if (focusOnReady) $("#puzzle-grid").querySelector("button:not(:disabled)")?.focus();
    } catch (error) {
      if (requestedLoadVersion !== loadVersion || controller.signal.aborted || error?.name === "AbortError") return;
      const errorStage = error?.errorStage || (gameMode === "infinite" ? "infinite_overlap_contract" : gameMode === "archive" ? "archive_payload" : "daily_api_payload");
      resetLoadedPuzzle(); setLoadState("unavailable");
      const box = document.createElement("div"); box.setAttribute("role", "alert"); const message = document.createElement("p"); message.textContent = "This puzzle could not be loaded.";
      const retry = document.createElement("button"); retry.className = "control secondary"; retry.id = "retry-puzzle-load"; retry.type = "button"; retry.textContent = "Retry";
      box.append(message, retry); $("#puzzle-grid").replaceChildren(box); $("#game-status").textContent = "Verified puzzle data is unavailable; no fallback board was substituted."; $("#progress-label").textContent = "Puzzle unavailable";
      emitPokeSortEvent("pokesort_load_error", { game_mode: gameMode, error_stage: errorStage }); retry.addEventListener("click", () => load({ focusOnReady: true }), { once: true }); retry.focus();
    } finally { if (requestedLoadVersion === loadVersion) activeLoadController = null; }
  }

  function ensureHistorySection() {
    let section = $("#guess-history"); if (section) return section;
    section = document.createElement("section"); section.id = "guess-history"; section.className = "guess-history"; section.setAttribute("aria-labelledby", "guess-history-title");
    const heading = document.createElement("h3"); heading.id = "guess-history-title"; heading.textContent = "Guess history"; const list = document.createElement("ol"); list.id = "guess-history-list";
    section.append(heading, list); $("#game-status").after(section); return section;
  }

  function renderHistory() {
    const section = ensureHistorySection(), list = section.querySelector("ol"), names = boardCardMap(); list.replaceChildren();
    for (const item of [...sanitizeHistory(history)].reverse()) {
      const row = document.createElement("li"), pokemon = document.createElement("span"), outcome = document.createElement("strong");
      pokemon.className = "guess-history-names"; pokemon.textContent = item.selectedIds.map((id) => names.get(id)).join(" · ");
      const labels = { correct: "Correct", valid_overlap: "Valid fact — no penalty" };
      outcome.textContent = item.repeated ? "Repeated guess" : labels[item.outcome] || (item.guessMatchCount === 0 ? "No close match" : `${item.guessMatchCount} of 4 match one intended group`);
      row.append(pokemon, outcome); list.append(row);
    }
    section.hidden = list.children.length === 0;
  }

  function render(focusId) {
    const interactive = loadState === "ready" && !gameOver, grid = $("#puzzle-grid"); grid.replaceChildren();
    cards.forEach((monster, index) => {
      const button = document.createElement("button"); button.className = `poke-card${selected.includes(monster.id) ? " selected" : ""}`;
      button.dataset.id = String(monster.id); button.dataset.index = String(index); button.setAttribute("aria-pressed", String(selected.includes(monster.id))); button.disabled = !interactive;
      const image = document.createElement("img"); image.src = sprite(monster.id); image.alt = ""; image.width = 68; image.height = 68; const name = document.createElement("span"); name.textContent = monster.name;
      button.append(image, name); button.addEventListener("click", () => toggle(monster.id, true)); grid.append(button);
    });
    const solvedContainer = $("#solved-groups"); solvedContainer.replaceChildren();
    solved.forEach((signature) => {
      const group = pack.find((item) => item.signature === signature), row = document.createElement("div"); row.className = "solved-group"; row.style.background = group.color;
      const label = document.createElement("strong"); label.textContent = group.name; const names = document.createElement("span"); names.textContent = group.mons.map(([name]) => name).join(" · "); row.append(label, names); solvedContainer.append(row);
    });
    const remaining = Math.max(0, 4 - mistakes); $("#mistakes").textContent = `Mistakes remaining: ${remaining} `; const dots = document.createElement("span"); dots.setAttribute("aria-hidden", "true");
    for (let count = 0; count < remaining; count++) { const dot = document.createElement("i"); dot.className = "dot"; dots.append(dot); } $("#mistakes").append(dots);
    $("#progress-label").textContent = `${solved.length} of 4 groups`; $("#submit-selection").disabled = selected.length !== 4 || !interactive; $("#shuffle-board").disabled = !interactive;
    $("#deselect-all").disabled = !interactive || selected.length === 0; $("#reveal-board").disabled = loadState !== "ready" || solved.length === 4; $("#hint-button").disabled = loadState !== "ready" || solved.length === 4;
    $("#game-kicker").textContent = gameMode === "infinite" ? `Infinite puzzle · #${round + 1}` : `${gameMode === "archive" ? "Archive" : "Today"} · ${dateKey}`;
    $("#puzzle-number").textContent = gameMode === "infinite" ? `POKESORT · INFINITE #${round + 1}` : `POKESORT · DAILY ${dateKey.replaceAll("-", ".")}`;
    document.querySelectorAll("[data-mode]").forEach((button) => { const active = button.dataset.mode === (gameMode === "infinite" ? "infinite" : "daily"); button.classList.toggle("active", active); button.setAttribute("aria-pressed", String(active)); });
    $("#new-infinite").classList.toggle("hidden", gameMode !== "infinite"); $("#new-infinite").disabled = loadState !== "ready"; $("#share-result").classList.toggle("hidden", solved.length !== 4 || revealed); renderHistory();
    if (focusId != null) grid.querySelector(`[data-id="${focusId}"]`)?.focus();
  }

  function toggle(id, restoreFocus = false) {
    if (loadState !== "ready" || gameOver || !cards.some((card) => card.id === id)) return;
    if (!gameStartSent) { gameStartSent = true; track("pokesort_game_start"); }
    selected = selected.includes(id) ? selected.filter((item) => item !== id) : selected.length < 4 ? [...selected, id] : selected; render(restoreFocus ? id : undefined);
  }

  function maximumMatchCount(ids) { const selectedSet = new Set(ids); return Math.max(0, ...unsolvedGroups().map((group) => group.mons.filter(([, id]) => selectedSet.has(id)).length)); }
  function appendHistory(selectedIds, outcome, guessMatchCount) {
    const signature = memberSignature(selectedIds), repeated = history.some((item) => memberSignature(item.selectedIds) === signature);
    history = [...history, { selectedIds: [...selectedIds], outcome, guessMatchCount, repeated }].slice(-20);
  }
  function recordGameComplete() {
    if (analyticsCompletionSent) return; analyticsCompletionSent = true; track("pokesort_game_complete", { mistakes, groups_solved: solved.length, outcome: "solved" }); save();
  }

  function submit() {
    if (loadState !== "ready" || selected.length !== 4 || gameOver) return;
    const selectedIds = [...selected], signature = memberSignature(selectedIds), match = unsolvedGroups().find((group) => group.signature === signature);
    if (match) {
      solved.push(match.signature); cards = cards.filter((monster) => !selectedIds.includes(monster.id)); selected = []; if (solved.length === 4) gameOver = true;
      appendHistory(selectedIds, "correct", 4); save(); render(); track("pokesort_guess_submit", { mistakes, groups_solved: solved.length, guess_match_count: 4, outcome: "correct" });
      track("pokesort_group_solved", { mistakes, groups_solved: solved.length }); if (solved.length === 4) finish("solved"); else $("#game-status").textContent = "Correct connection!"; return;
    }
    const guessMatchCount = maximumMatchCount(selectedIds);
    if (activeValidQuartets.has(signature)) {
      selected = []; appendHistory(selectedIds, "valid_overlap", guessMatchCount); save(); render(); $("#game-status").textContent = "Valid Pokémon fact — not the intended group. No mistake charged.";
      track("pokesort_guess_submit", { mistakes, groups_solved: solved.length, guess_match_count: guessMatchCount, outcome: "valid_overlap" }); track("pokesort_valid_overlap", { mistakes, groups_solved: solved.length, guess_match_count: guessMatchCount }); return;
    }
    mistakes += 1; selected = []; gameOver = mistakes >= 4; appendHistory(selectedIds, "invalid", guessMatchCount); save(); render();
    track("pokesort_guess_submit", { mistakes, groups_solved: solved.length, guess_match_count: guessMatchCount, outcome: "invalid" });
    $("#game-status").textContent = gameOver ? "No mistakes left. Reveal the board or try Infinite mode." : guessMatchCount === 3 ? "One away…" : "Not the connection. Try another combination.";
    if (!gameOver) { const grid = $("#puzzle-grid"); grid.classList.remove("shake"); void grid.offsetWidth; grid.classList.add("shake"); }
  }

  function finish(outcome) {
    gameOver = true;
    if (outcome === "revealed") $("#game-status").textContent = "Board revealed.";
    else $("#game-status").textContent = gameMode === "infinite" ? `You solved Infinite puzzle #${round + 1}!` : gameMode === "daily" ? "You solved today’s PokeSort!" : `You solved the ${dateKey} PokeSort!`;
    if (outcome === "solved" && !completionRecorded) {
      completionRecorded = true;
      if (gameMode === "daily" && mistakes < 4) { const wins = new Set(readWins()); if (!wins.has(dateKey)) { wins.add(dateKey); storageSet("pokesort-wins", JSON.stringify([...wins])); } updateStreak(dateKey); }
    }
    if (outcome === "solved") recordGameComplete(); save();
  }

  function openHint() {
    if (loadState !== "ready") return; const group = unsolvedGroups()[0]; if (!group) { $("#game-status").textContent = "You found every connection!"; return; }
    const current = hintLevels[group.signature] || 0; if (current >= 3) { $("#game-status").textContent = "Maximum hint reached."; return; }
    const next = current + 1; hintLevels[group.signature] = next;
    if (next === 1) $("#game-status").textContent = hintFamilyCopy[group.ruleFamily]; else if (next === 2) $("#game-status").textContent = group.name;
    else { const names = [...group.mons].sort((left, right) => left[1] - right[1]).slice(0, 2).map(([name]) => name); $("#game-status").textContent = `Two members are ${names[0]} and ${names[1]}.`; }
    save(); track("pokesort_hint_open", { mistakes, groups_solved: solved.length, hint_level: next });
  }

  function reveal() {
    if (loadState !== "ready" || solved.length === 4) return; track("pokesort_reveal", { mistakes, groups_solved: solved.length });
    revealed = true; gameOver = true; solved = pack.map(({ signature }) => signature); cards = []; selected = []; save(); render(); finish("revealed");
  }

  async function newInfinite() {
    if (gameMode !== "infinite" || loadState === "unavailable" || loadState === "idle") return;
    round += 1; storageSet("pokesort-infinite-round", round); track("pokesort_new_infinite", { round_number: round + 1 }); await load({ focusOnReady: true });
  }

  async function share() {
    const squares = pack.map((group, index) => solved.includes(group.signature) ? ["🟨", "🟦", "🟥", "🟩"][index] : "⬜").join("");
    const label = gameMode === "infinite" ? `PokeSort Infinite #${round + 1}` : `PokeSort ${dateKey}`, sharePath = gameMode === "infinite" ? "/infinite/" : gameMode === "daily" ? "/" : `/daily/${dateKey}/`;
    const text = `${label}\n${squares}\n${mistakes}/4 mistakes\n${location.origin}${sharePath}`;
    try {
      if (navigator.share) { await navigator.share({ text }); track("pokesort_share", { mistakes, groups_solved: solved.length, share_method: "native" }); }
      else { await navigator.clipboard.writeText(text); $("#game-status").textContent = "Result copied!"; track("pokesort_share", { mistakes, groups_solved: solved.length, share_method: "clipboard" }); }
    } catch { /* Cancellation and sharing errors are not successes. */ }
  }

  document.querySelectorAll("[data-mode]").forEach((button) => button.addEventListener("click", () => { location.assign(button.dataset.mode === "infinite" ? "/infinite/#game" : "/#game"); }));
  $("#submit-selection").addEventListener("click", submit); $("#deselect-all").addEventListener("click", () => { if (loadState === "ready" && !gameOver) { selected = []; render(); } });
  $("#shuffle-board").addEventListener("click", () => { if (loadState === "ready" && !gameOver) { cards = shuffle(cards, Date.now()); save(); render(); } });
  $("#reveal-board").addEventListener("click", reveal); $("#hint-button").addEventListener("click", openHint); $("#new-infinite").addEventListener("click", newInfinite); $("#share-result").addEventListener("click", share);
  $("#puzzle-grid").addEventListener("keydown", (event) => {
    const buttons = [...$("#puzzle-grid").querySelectorAll("button")], current = Number(document.activeElement?.dataset.index || 0), moves = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -4, ArrowDown: 4 };
    if (moves[event.key] != null && buttons.length) { event.preventDefault(); buttons[(current + moves[event.key] + buttons.length) % buttons.length]?.focus(); }
    if (event.key === "Enter" && selected.length === 4) { event.preventDefault(); submit(); }
  });
  globalThis.__pokesortRuntime = {
    reload: load, newInfinite, submit,
    selectIds: (ids) => { if (Array.isArray(ids)) { selected = ids.filter((id) => cards.some((card) => card.id === id)).slice(0, 4); render(); } },
    state: () => ({ loadState, gameMode, dateKey, round, puzzleId: activePuzzleId, contentHash: activeContentHash, solved: [...solved], cards: cards.length, cardIds: cards.map(({ id }) => id), selected: [...selected], mistakes, revealed, gameOver, completionRecorded, analyticsCompletionSent, history: history.map((item) => ({ ...item, selectedIds: [...item.selectedIds] })), hintLevels: { ...hintLevels }, validOverlaps: [...activeValidQuartets] }),
  };
  if (gameMode === "daily") {
    const scheduleUtcRefresh = () => { const now = new Date(), nextUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 1); setTimeout(async () => { await load(); scheduleUtcRefresh(); }, Math.min(2_147_000_000, Math.max(0, nextUtc - now.getTime()))); };
    scheduleUtcRefresh();
  }
  updateStreak(); setLoadState("idle"); load();
}
