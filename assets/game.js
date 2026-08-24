const $ = (selector) => document.querySelector(selector);
const sprite = (id) => `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${id}.png`;

if ($("#puzzle-grid")) {
  const params = new URLSearchParams(location.search);
  const edgeDailyConfigured = document.querySelector('meta[name="pokesort-edge-daily"]')?.content === "enabled";
  const edgeDailyActivationDate = document.querySelector('meta[name="pokesort-edge-daily-activation-date"]')?.content || "0000-01-01";
  const browserUtcDate = () => new Date().toISOString().slice(0, 10);
  const edgeDailyEnabled = () => edgeDailyConfigured && browserUtcDate() >= edgeDailyActivationDate;
  const today = browserUtcDate();
  const embeddedPuzzle = (() => {
    try {
      const value = JSON.parse($("#pokesort-puzzle-data")?.textContent || "null");
      if (!value || value.schemaVersion !== 1 || !/^\d{4}-\d{2}-\d{2}$/.test(value.date || "") || !value.puzzleId || !/^[a-f0-9]{64}$/.test(value.contentHash || "") || value.groups?.length !== 4 || value.cards?.length !== 16) return null;
      const members = value.groups.flatMap((group) => group.mons || []);
      if (members.length !== 16 || new Set(members.map(([, id]) => id)).size !== 16) return null;
      if (value.validQuartets != null && (!Array.isArray(value.validQuartets) || value.validQuartets.some((signature) => !/^\d+(?:-\d+){3}$/.test(signature)))) return null;
      return value;
    } catch { return null; }
  })();
  const pathDate = location.pathname.match(/^\/daily\/(\d{4}-\d{2}-\d{2})\/$/)?.[1];
  const requested = pathDate || params.get("date");
  const validDateKey = (value) => { if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return false; const date = new Date(`${value}T00:00:00Z`); return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value; };
  let dateKey = validDateKey(requested) && requested <= today && embeddedPuzzle?.date === requested ? requested : today;
  let mode = location.pathname === "/infinite/" || params.get("mode") === "infinite" ? "infinite" : "daily";
  const storageGet = (key) => { try { return localStorage.getItem(key); } catch { return null; } };
  const storageSet = (key, value) => { try { localStorage.setItem(key, value); } catch { /* The game remains playable when storage is unavailable. */ } };
  const storedRound = Number(storageGet("pokesort-infinite-round"));
  let round = Number.isSafeInteger(storedRound) && storedRound >= 0 ? storedRound : 0;
  let selected = [], solved = [], cards = [], pack = [];
  let mistakes = 0, revealed = false, gameOver = false;
  let loadVersion = 0, loadState = "idle", activeLoadController = null;
  let activePuzzleId = "", activeContentHash = "", completionRecorded = false;
  let activeValidQuartets = new Set();

  const hash = (text) => { let value = 2166136261; for (const character of text) value = Math.imul(value ^ character.charCodeAt(0), 16777619); return value >>> 0; };
  const rng = (seed) => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let value = Math.imul(seed ^ seed >>> 15, 1 | seed); value = value + Math.imul(value ^ value >>> 7, 61 | value) ^ value; return ((value ^ value >>> 14) >>> 0) / 4294967296; };
  const shuffle = (items, seed) => { const output = [...items], random = rng(seed); for (let index = output.length - 1; index > 0; index--) { const other = Math.floor(random() * (index + 1)); [output[index], output[other]] = [output[other], output[index]]; } return output; };
  const key = () => mode === "daily" ? `pokesort-daily-${dateKey}` : `pokesort-infinite-${round}`;
  const save = () => { if (loadState === "ready") storageSet(key(), JSON.stringify({ mode, puzzleId: activePuzzleId, contentHash: activeContentHash, cards, solved, mistakes, revealed, gameOver, completionRecorded })); };
  const readWins = () => { try { const value = JSON.parse(storageGet("pokesort-wins") || "[]"); return Array.isArray(value) ? value.filter(validDateKey) : []; } catch { return []; } };

  const canonicalize = (value) => Array.isArray(value) ? value.map(canonicalize) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map((keyName) => [keyName, canonicalize(value[keyName])])) : value;
  const sha256Hex = async (value) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(typeof value === "string" ? value : JSON.stringify(canonicalize(value)))))]
    .map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const memberSignature = (ids) => [...ids].sort((left, right) => left - right).join("-");

  async function inspectCurrentDailyResponse(value) {
    if (!value || value.schemaVersion !== 1 || value.status !== "ready" || !validDateKey(value.utcDate) || !value.manifest || value.puzzleId !== value.manifest.puzzleId || value.contentHash !== value.manifest.contentHash) throw new Error("Invalid Daily API envelope");
    const manifest = value.manifest;
    if (manifest.date !== value.utcDate || manifest.calendarSchemaVersion !== 1 || manifest.puzzleSchemaVersion !== 1 || manifest.solver?.solutionCount !== 1 || manifest.solver?.countComplete !== true || manifest.quality?.accepted !== true) throw new Error("Invalid Daily manifest proof");
    if (/(?:sourceSeed|productionSeed|calendarSeed|privateSeed|\"seed\"\s*:)/i.test(JSON.stringify(manifest))) throw new Error("Daily manifest contains private derivation material");
    const cards = Array.isArray(manifest.cards) ? manifest.cards : [], cardIds = cards.map(({ id }) => id);
    if (cards.length !== 16 || cardIds.some((id) => !Number.isSafeInteger(id)) || new Set(cardIds).size !== 16 || manifest.boardSignature !== memberSignature(cardIds)) throw new Error("Invalid Daily cards");
    const groups = Array.isArray(manifest.groups) ? manifest.groups : [], partition = [];
    if (groups.length !== 4) throw new Error("Invalid Daily groups");
    for (const group of groups) {
      const ids = group.memberIds || [];
      if (ids.length !== 4 || new Set(ids).size !== 4 || group.memberSignature !== memberSignature(ids) || !Array.isArray(group.members) || group.members.some((member, index) => member.id !== ids[index]) || !group.label || !group.hint || !group.explanation) throw new Error("Invalid Daily group evidence");
      partition.push(...ids);
    }
    if (partition.length !== 16 || new Set(partition).size !== 16 || partition.some((id) => !cardIds.includes(id))) throw new Error("Invalid Daily partition");
    const validQuartets = manifest.quality.validOverlapMemberSignatures;
    if (!Array.isArray(validQuartets) || validQuartets.some((signature) => {
      if (!/^\d+(?:-\d+){3}$/.test(signature)) return true;
      const ids = signature.split("-").map(Number);
      return new Set(ids).size !== 4 || ids.some((id) => !cardIds.includes(id)) || signature !== memberSignature(ids);
    })) throw new Error("Invalid Daily overlap evidence");
    const { puzzleId, contentHash, ...base } = manifest;
    if (!/^[a-f0-9]{64}$/.test(contentHash) || await sha256Hex(base) !== contentHash || puzzleId !== `daily-${value.utcDate}-${contentHash.slice(0, 16)}`) throw new Error("Invalid Daily content hash");
    return {
      date: value.utcDate,
      puzzleId,
      contentHash,
      validQuartets,
      groups: groups.map((group, index) => ({ name: group.label, hint: group.hint, explanation: group.explanation, color: ["#f5d65b", "#8bc5f5", "#f6a2ae", "#a8dbb6"][index], mons: group.members.map(({ name, id }) => [name, id]) })),
    };
  }

  async function fetchJson(path, { signal, cache = "force-cache" } = {}) {
    const response = await fetch(path, { cache, signal });
    if (!response.ok) throw new Error(`Puzzle data request failed: ${response.status}`);
    return response.json();
  }

  async function infinitePuzzleForRound(value, signal) {
    const index = await fetchJson("/assets/infinite/index.json", { signal });
    if (![1, 2].includes(index.schemaVersion) || index.poolSize < 1000 || !Number.isSafeInteger(index.sequence?.step) || !Number.isSafeInteger(index.sequence?.offset)) throw new Error("Invalid Infinite pool index");
    const poolIndex = (index.sequence.offset + (value % index.poolSize) * index.sequence.step) % index.poolSize;
    const shardEntry = index.shards.find((entry) => poolIndex >= entry.start && poolIndex < entry.start + entry.count);
    if (!shardEntry) throw new Error("Infinite pool shard is missing");
    const shard = await fetchJson(`/assets/infinite/${shardEntry.file}`, { signal });
    const puzzle = shard.puzzles?.[poolIndex - shardEntry.start];
    if (!puzzle || puzzle.poolIndex !== poolIndex || puzzle.groups?.length !== 4 || puzzle.cards?.length !== 16) throw new Error("Invalid Infinite puzzle payload");
    return {
      puzzleId: puzzle.puzzleId,
      contentHash: puzzle.contentHash,
      validQuartets: [],
      groups: puzzle.groups.map((group, indexNumber) => ({
        name: group.label,
        hint: group.hint,
        explanation: group.explanation,
        color: ["#f5d65b", "#8bc5f5", "#f6a2ae", "#a8dbb6"][indexNumber],
        mons: group.members.map(({ name, id }) => [name, id]),
      })),
    };
  }

  function updateStreak(referenceDateKey = browserUtcDate()) {
    const set = new Set(readWins());
    let count = 0, date = new Date(`${validDateKey(referenceDateKey) ? referenceDateKey : browserUtcDate()}T00:00:00Z`);
    while (set.has(date.toISOString().slice(0, 10))) { count++; date.setUTCDate(date.getUTCDate() - 1); }
    $("#streak-count").textContent = count;
  }

  const controls = () => ["#submit-selection", "#shuffle-board", "#deselect-all", "#reveal-board", "#hint-button", "#new-infinite"].map($).filter(Boolean);
  function setLoadState(next) {
    loadState = next;
    $("#puzzle-grid").dataset.loadState = next;
    $("#puzzle-grid").setAttribute("aria-busy", String(next === "loading"));
    if (next === "loading") {
      $("#game-status").textContent = "Loading verified puzzle data…";
      $("#puzzle-grid").querySelectorAll("button").forEach((button) => { button.disabled = true; });
      $("#puzzle-grid").innerHTML = '<p role="status">Loading verified puzzle data…</p>';
      $("#solved-groups").innerHTML = "";
      $("#progress-label").textContent = "Loading puzzle";
      $("#mistakes").textContent = "";
      $("#share-result").classList.add("hidden");
    }
    if (next !== "ready") controls().forEach((button) => { button.disabled = true; });
  }

  const resetLoadedPuzzle = () => {
    pack = []; cards = []; solved = []; selected = [];
    mistakes = 0; revealed = false; gameOver = true; completionRecorded = false;
    activePuzzleId = ""; activeContentHash = ""; activeValidQuartets = new Set();
  };

  const savedStateIsConsistent = (stored) => {
    if (typeof stored.revealed !== "boolean" || typeof stored.gameOver !== "boolean" || typeof stored.completionRecorded !== "boolean") return false;
    const solvedComplete = stored.solved.length === 4 && stored.cards.length === 0;
    const active = !solvedComplete && !stored.gameOver && !stored.revealed && !stored.completionRecorded && stored.mistakes < 4;
    const failed = !solvedComplete && stored.gameOver && !stored.revealed && !stored.completionRecorded && stored.mistakes === 4;
    const revealedTerminal = solvedComplete && stored.gameOver && stored.revealed && !stored.completionRecorded;
    const solvedTerminal = solvedComplete && stored.gameOver && !stored.revealed && stored.mistakes < 4;
    return active || failed || revealedTerminal || solvedTerminal;
  };

  async function load({ focusOnReady = false } = {}) {
    const requestedLoadVersion = ++loadVersion;
    activeLoadController?.abort();
    const controller = new AbortController();
    activeLoadController = controller;
    setLoadState("loading");
    resetLoadedPuzzle();
    try {
      let active;
      if (mode === "daily" && (pathDate || !edgeDailyEnabled())) {
        const embeddedDate = pathDate || embeddedPuzzle?.date;
        if (!embeddedDate || embeddedPuzzle?.date !== embeddedDate) throw new Error("Embedded Daily puzzle is unavailable");
        if (!pathDate && embeddedDate !== browserUtcDate()) throw new Error("Embedded Daily puzzle is stale");
        active = { date: embeddedPuzzle.date, puzzleId: embeddedPuzzle.puzzleId, contentHash: embeddedPuzzle.contentHash, groups: embeddedPuzzle.groups, validQuartets: embeddedPuzzle.validQuartets || [] };
      } else if (mode === "daily") {
        active = await inspectCurrentDailyResponse(await fetchJson("/api/daily/current", { signal: controller.signal, cache: "no-store" }));
      } else active = await infinitePuzzleForRound(round, controller.signal);
      if (requestedLoadVersion !== loadVersion || controller.signal.aborted) return;
      if (!active?.puzzleId || !active?.contentHash) throw new Error("Puzzle identity is unavailable");
      if (mode === "daily") dateKey = active.date;
      pack = active.groups;
      activePuzzleId = active.puzzleId;
      activeContentHash = active.contentHash;
      activeValidQuartets = new Set(active.validQuartets || []);
      const seedText = mode === "daily" ? `${dateKey}|${activeContentHash}` : `infinite-${round}|${activeContentHash}`, seed = hash(seedText);
      const fresh = shuffle(pack.flatMap((group) => group.mons.map(([name, id]) => ({ name, id }))), seed);
      try {
        const stored = JSON.parse(storageGet(key()));
        const groupNames = new Set(pack.map((group) => group.name));
        if (!stored || stored.mode !== mode || stored.puzzleId !== activePuzzleId || stored.contentHash !== activeContentHash || !Array.isArray(stored.solved) || new Set(stored.solved).size !== stored.solved.length || stored.solved.some((name) => !groupNames.has(name)) || !Number.isInteger(stored.mistakes) || stored.mistakes < 0 || stored.mistakes > 4 || !Array.isArray(stored.cards)) throw new Error("Invalid saved state");
        const expected = pack.filter((group) => !stored.solved.includes(group.name)).flatMap((group) => group.mons);
        const expectedIds = new Map(expected.map(([name, id]) => [name, id]));
        if (stored.cards.length !== expected.length || new Set(stored.cards.map((card) => card?.name)).size !== stored.cards.length || stored.cards.some((card) => !card || expectedIds.get(card.name) !== card.id)) throw new Error("Invalid saved cards");
        if (!savedStateIsConsistent(stored)) throw new Error("Inconsistent saved state");
        cards = stored.cards; solved = stored.solved; mistakes = stored.mistakes;
        revealed = stored.revealed; gameOver = stored.gameOver; completionRecorded = stored.completionRecorded;
      } catch { cards = fresh; solved = []; mistakes = 0; revealed = false; gameOver = false; completionRecorded = false; }
      selected = [];
      setLoadState("ready");
      render();
      if (focusOnReady) $("#puzzle-grid").querySelector("button:not(:disabled)")?.focus();
    } catch (error) {
      if (requestedLoadVersion !== loadVersion || controller.signal.aborted || error?.name === "AbortError") return;
      resetLoadedPuzzle();
      setLoadState("unavailable");
      $("#puzzle-grid").innerHTML = '<div role="alert"><p>This puzzle could not be loaded.</p><button class="control secondary" id="retry-puzzle-load" type="button">Retry</button></div>';
      $("#game-status").textContent = "Verified puzzle data is unavailable; no fallback board was substituted.";
      $("#progress-label").textContent = "Puzzle unavailable";
      const retry = $("#retry-puzzle-load");
      retry.addEventListener("click", () => load({ focusOnReady: true }), { once: true });
      retry.focus();
    } finally { if (requestedLoadVersion === loadVersion) activeLoadController = null; }
  }

  function render(focusName) {
    const interactive = loadState === "ready" && !gameOver;
    $("#puzzle-grid").innerHTML = cards.map((monster, index) => `<button class="poke-card${selected.includes(monster.name) ? " selected" : ""}" data-name="${monster.name}" data-index="${index}" aria-pressed="${selected.includes(monster.name)}"${!interactive ? " disabled" : ""}><img src="${sprite(monster.id)}" alt="" width="68" height="68"><span>${monster.name}</span></button>`).join("");
    $("#solved-groups").innerHTML = solved.map((name) => { const group = pack.find((item) => item.name === name); return `<div class="solved-group" style="background:${group.color}"><strong>${group.name}</strong><span>${group.mons.map((monster) => monster[0]).join(" · ")}</span></div>`; }).join("");
    const remaining = Math.max(0, 4 - mistakes);
    $("#mistakes").innerHTML = `Mistakes remaining: ${remaining} <span aria-hidden="true">${Array.from({ length: remaining }, () => '<i class="dot"></i>').join("")}</span>`;
    $("#progress-label").textContent = `${solved.length} of 4 groups`;
    $("#submit-selection").disabled = selected.length !== 4 || !interactive;
    $("#shuffle-board").disabled = !interactive;
    $("#deselect-all").disabled = !interactive || selected.length === 0;
    $("#reveal-board").disabled = loadState !== "ready" || solved.length === 4;
    $("#hint-button").disabled = loadState !== "ready" || solved.length === 4;
    $("#game-kicker").textContent = mode === "daily" ? `${!pathDate ? "Today" : "Archive"} · ${dateKey}` : `Infinite puzzle · #${round + 1}`;
    $("#puzzle-number").textContent = mode === "daily" ? `POKESORT · DAILY ${dateKey.replaceAll("-", ".")}` : `POKESORT · INFINITE #${round + 1}`;
    document.querySelectorAll("[data-mode]").forEach((button) => { const active = button.dataset.mode === mode; button.classList.toggle("active", active); button.setAttribute("aria-pressed", String(active)); });
    $("#new-infinite").classList.toggle("hidden", mode !== "infinite");
    $("#new-infinite").disabled = loadState !== "ready";
    $("#share-result").classList.toggle("hidden", solved.length !== 4 || revealed);
    $("#puzzle-grid").querySelectorAll("button").forEach((button) => button.addEventListener("click", () => toggle(button.dataset.name, true)));
    if (focusName) [...$("#puzzle-grid").querySelectorAll("button")].find((button) => button.dataset.name === focusName)?.focus();
    if (!cards.length && solved.length === 4) finish(true);
  }

  function toggle(name, restoreFocus = false) {
    if (loadState !== "ready" || gameOver) return;
    selected = selected.includes(name) ? selected.filter((item) => item !== name) : selected.length < 4 ? [...selected, name] : selected;
    render(restoreFocus ? name : undefined);
  }

  function submit() {
    if (loadState !== "ready" || selected.length !== 4 || gameOver) return;
    const match = pack.find((group) => selected.every((name) => group.mons.some((monster) => monster[0] === name)));
    if (match) {
      solved.push(match.name); cards = cards.filter((monster) => !selected.includes(monster.name)); selected = [];
      if (solved.length === 4) gameOver = true;
      save(); render();
      if (!gameOver) $("#game-status").textContent = "Correct connection!";
      return;
    }
    mistakes++;
    const near = pack.some((group) => selected.filter((name) => group.mons.some((monster) => monster[0] === name)).length === 3);
    const selectedIds = selected.map((name) => cards.find((card) => card.name === name)?.id).sort((left, right) => left - right).join("-");
    const validOverlap = activeValidQuartets.has(selectedIds);
    gameOver = mistakes >= 4; selected = []; save(); render();
    $("#game-status").textContent = gameOver ? "No mistakes left. Reveal the board or try Infinite mode." : validOverlap ? "That quartet shares a real canonical fact, but this overlap cannot complete the board’s unique four-group solution." : near ? "One away…" : "Not the connection. Try another combination.";
    if (!gameOver) { const grid = $("#puzzle-grid"); grid.classList.remove("shake"); void grid.offsetWidth; grid.classList.add("shake"); }
  }

  function finish(won) {
    if (!won) { $("#game-status").textContent = "No mistakes left. Reveal the board or try Infinite mode."; return; }
    gameOver = true;
    if (revealed) { $("#game-status").textContent = "Board revealed."; save(); return; }
    $("#game-status").textContent = mode === "infinite" ? `You solved Infinite puzzle #${round + 1}!` : !pathDate ? "You solved today’s PokeSort!" : `You solved the ${dateKey} PokeSort!`;
    if (completionRecorded) return;
    completionRecorded = true;
    if (mode === "daily" && !pathDate && mistakes < 4) {
      const wins = new Set(readWins());
      if (!wins.has(dateKey)) { wins.add(dateKey); storageSet("pokesort-wins", JSON.stringify([...wins])); }
      updateStreak(dateKey);
    }
    save();
  }

  async function newInfinite() {
    if (mode !== "infinite" || loadState === "unavailable" || loadState === "idle") return;
    round++;
    storageSet("pokesort-infinite-round", round);
    await load({ focusOnReady: true });
  }

  async function share() {
    const squares = pack.map((group, index) => solved.includes(group.name) ? ["🟨", "🟦", "🟥", "🟩"][index] : "⬜").join("");
    const label = mode === "infinite" ? `PokeSort Infinite #${round + 1}` : `PokeSort ${dateKey}`;
    const sharePath = mode === "infinite" ? "/infinite/" : !pathDate ? "/" : pathDate === dateKey ? `/daily/${dateKey}/` : `/?date=${encodeURIComponent(dateKey)}`;
    const text = `${label}\n${squares}\n${mistakes}/4 mistakes\n${location.origin}${sharePath}`;
    try { if (navigator.share) await navigator.share({ text }); else { await navigator.clipboard.writeText(text); $("#game-status").textContent = "Result copied!"; } } catch { /* Sharing can be cancelled by the player. */ }
  }

  document.querySelectorAll("[data-mode]").forEach((button) => button.addEventListener("click", () => { location.assign(button.dataset.mode === "infinite" ? "/infinite/#game" : "/#game"); }));
  $("#submit-selection").addEventListener("click", submit);
  $("#deselect-all").addEventListener("click", () => { if (loadState === "ready" && !gameOver) { selected = []; render(); } });
  $("#shuffle-board").addEventListener("click", () => { if (loadState === "ready" && !gameOver) { cards = shuffle(cards, Date.now()); save(); render(); } });
  $("#reveal-board").addEventListener("click", () => { if (loadState !== "ready") return; revealed = true; gameOver = true; solved = pack.map((group) => group.name); cards = []; selected = []; save(); render(); });
  $("#hint-button").addEventListener("click", () => { if (loadState === "ready") $("#game-status").textContent = pack.find((group) => !solved.includes(group.name))?.hint || "You found every connection!"; });
  $("#new-infinite").addEventListener("click", newInfinite);
  $("#share-result").addEventListener("click", share);
  $("#puzzle-grid").addEventListener("keydown", (event) => {
    const buttons = [...$("#puzzle-grid").querySelectorAll("button")], current = Number(document.activeElement?.dataset.index || 0), moves = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -4, ArrowDown: 4 };
    if (moves[event.key] != null && buttons.length) { event.preventDefault(); buttons[(current + moves[event.key] + buttons.length) % buttons.length]?.focus(); }
    if (event.key === "Enter" && selected.length === 4) { event.preventDefault(); submit(); }
  });
  globalThis.__pokesortRuntime = { reload: load, newInfinite, state: () => ({ loadState, mode, dateKey, round, puzzleId: activePuzzleId, contentHash: activeContentHash, solved: [...solved], cards: cards.length, mistakes, revealed, gameOver, completionRecorded }) };
  if (edgeDailyConfigured && mode === "daily" && !pathDate) {
    const scheduleUtcRefresh = () => {
      const now = new Date(), nextUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 1);
      setTimeout(async () => { await load(); scheduleUtcRefresh(); }, Math.min(2_147_000_000, Math.max(0, nextUtc - now.getTime())));
    };
    scheduleUtcRefresh();
  }
  updateStreak(); setLoadState("idle"); load();
}
