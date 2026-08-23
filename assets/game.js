import { GROUPS } from "./puzzle-data.js";

const $ = (selector) => document.querySelector(selector);
const sprite = (id) => `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${id}.png`;

if ($("#puzzle-grid")) {
  const params = new URLSearchParams(location.search);
  const today = new Date().toISOString().slice(0, 10);
  const pathDate = location.pathname.match(/^\/daily\/(\d{4}-\d{2}-\d{2})\/$/)?.[1];
  const requested = pathDate || params.get("date");
  const validDateKey = (value) => { if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return false; const date = new Date(`${value}T00:00:00Z`); return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value; };
  const dateKey = validDateKey(requested) && requested <= today ? requested : today;
  let mode = location.pathname === "/infinite/" || params.get("mode") === "infinite" ? "infinite" : "daily";
  const storageGet = (key) => { try { return localStorage.getItem(key); } catch { return null; } };
  const storageSet = (key, value) => { try { localStorage.setItem(key, value); } catch { /* The game remains playable when storage is unavailable. */ } };
  const storedRound = Number(storageGet("pokesort-infinite-round"));
  let round = Number.isSafeInteger(storedRound) && storedRound >= 0 ? storedRound : 0;
  let selected = [], solved = [], cards = [], pack = [];
  let mistakes = 0, revealed = false, gameOver = false;

  const hash = (text) => { let value = 2166136261; for (const character of text) value = Math.imul(value ^ character.charCodeAt(0), 16777619); return value >>> 0; };
  const rng = (seed) => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let value = Math.imul(seed ^ seed >>> 15, 1 | seed); value = value + Math.imul(value ^ value >>> 7, 61 | value) ^ value; return ((value ^ value >>> 14) >>> 0) / 4294967296; };
  const shuffle = (items, seed) => { const output = [...items], random = rng(seed); for (let index = output.length - 1; index > 0; index--) { const other = Math.floor(random() * (index + 1)); [output[index], output[other]] = [output[other], output[index]]; } return output; };
  const key = () => mode === "daily" ? `pokesort-daily-${dateKey}` : `pokesort-infinite-${round}`;
  const save = () => storageSet(key(), JSON.stringify({ cards, solved, mistakes, revealed, gameOver }));
  const readWins = () => { try { const value = JSON.parse(storageGet("pokesort-wins") || "[]"); return Array.isArray(value) ? value.filter(validDateKey) : []; } catch { return []; } };

  function updateStreak() {
    const set = new Set(readWins());
    let count = 0, date = new Date();
    while (set.has(date.toISOString().slice(0, 10))) { count++; date.setUTCDate(date.getUTCDate() - 1); }
    $("#streak-count").textContent = count;
  }

  function load() {
    const seedText = mode === "daily" ? dateKey : `infinite-${round}`, seed = hash(seedText);
    pack = GROUPS[seed % GROUPS.length];
    const fresh = shuffle(pack.flatMap((group) => group.mons.map(([name, id]) => ({ name, id }))), seed);
    try {
      const stored = JSON.parse(storageGet(key()));
      const groupNames = new Set(pack.map((group) => group.name));
      if (!stored || !Array.isArray(stored.solved) || new Set(stored.solved).size !== stored.solved.length || stored.solved.some((name) => !groupNames.has(name)) || !Number.isInteger(stored.mistakes) || stored.mistakes < 0 || stored.mistakes > 4 || !Array.isArray(stored.cards)) throw new Error("Invalid saved state");
      const expected = pack.filter((group) => !stored.solved.includes(group.name)).flatMap((group) => group.mons);
      const expectedIds = new Map(expected.map(([name, id]) => [name, id]));
      if (stored.cards.length !== expected.length || new Set(stored.cards.map((card) => card?.name)).size !== stored.cards.length || stored.cards.some((card) => !card || expectedIds.get(card.name) !== card.id)) throw new Error("Invalid saved cards");
      cards = stored.cards; solved = stored.solved; mistakes = stored.mistakes;
      revealed = Boolean(stored.revealed); gameOver = Boolean(stored.gameOver) || mistakes >= 4 || revealed || (!cards.length && solved.length === 4);
    } catch { cards = fresh; solved = []; mistakes = 0; revealed = false; gameOver = false; }
    selected = [];
    render();
  }

  function render(focusName) {
    $("#puzzle-grid").innerHTML = cards.map((monster, index) => `<button class="poke-card${selected.includes(monster.name) ? " selected" : ""}" data-name="${monster.name}" data-index="${index}" aria-pressed="${selected.includes(monster.name)}"${gameOver ? " disabled" : ""}><img src="${sprite(monster.id)}" alt="" width="68" height="68"><span>${monster.name}</span></button>`).join("");
    $("#solved-groups").innerHTML = solved.map((name) => { const group = pack.find((item) => item.name === name); return `<div class="solved-group" style="background:${group.color}"><strong>${group.name}</strong><span>${group.mons.map((monster) => monster[0]).join(" · ")}</span></div>`; }).join("");
    const remaining = Math.max(0, 4 - mistakes);
    $("#mistakes").innerHTML = `Mistakes remaining: ${remaining} <span aria-hidden="true">${Array.from({ length: remaining }, () => '<i class="dot"></i>').join("")}</span>`;
    $("#progress-label").textContent = `${solved.length} of 4 groups`;
    $("#submit-selection").disabled = selected.length !== 4 || gameOver;
    $("#shuffle-board").disabled = gameOver;
    $("#deselect-all").disabled = gameOver || selected.length === 0;
    $("#reveal-board").disabled = solved.length === 4;
    $("#hint-button").disabled = solved.length === 4;
    $("#game-kicker").textContent = mode === "daily" ? `${dateKey === today ? "Today" : "Archive"} · ${dateKey}` : `Infinite puzzle · #${round + 1}`;
    $("#puzzle-number").textContent = mode === "daily" ? `POKESORT · DAILY ${dateKey.replaceAll("-", ".")}` : `POKESORT · INFINITE #${round + 1}`;
    document.querySelectorAll("[data-mode]").forEach((button) => { const active = button.dataset.mode === mode; button.classList.toggle("active", active); button.setAttribute("aria-pressed", String(active)); });
    $("#new-infinite").classList.toggle("hidden", mode !== "infinite");
    $("#share-result").classList.toggle("hidden", solved.length !== 4 || revealed);
    $("#puzzle-grid").querySelectorAll("button").forEach((button) => button.addEventListener("click", () => toggle(button.dataset.name, true)));
    if (focusName) [...$("#puzzle-grid").querySelectorAll("button")].find((button) => button.dataset.name === focusName)?.focus();
    if (!cards.length && solved.length === 4) finish(true);
  }

  function toggle(name, restoreFocus = false) {
    if (gameOver) return;
    selected = selected.includes(name) ? selected.filter((item) => item !== name) : selected.length < 4 ? [...selected, name] : selected;
    render(restoreFocus ? name : undefined);
  }

  function submit() {
    if (selected.length !== 4 || gameOver) return;
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
    gameOver = mistakes >= 4; selected = []; save(); render();
    $("#game-status").textContent = gameOver ? "No mistakes left. Reveal the board or try Infinite mode." : near ? "One away…" : "Not the connection. Try another combination.";
    if (!gameOver) { const grid = $("#puzzle-grid"); grid.classList.remove("shake"); void grid.offsetWidth; grid.classList.add("shake"); }
  }

  function finish(won) {
    if (!won) { $("#game-status").textContent = "No mistakes left. Reveal the board or try Infinite mode."; return; }
    gameOver = true;
    if (revealed) { $("#game-status").textContent = "Board revealed."; save(); return; }
    $("#game-status").textContent = mode === "infinite" ? `You solved Infinite puzzle #${round + 1}!` : dateKey === today ? "You solved today’s PokeSort!" : `You solved the ${dateKey} PokeSort!`;
    if (mode === "daily" && dateKey === today && mistakes < 4) { const wins = new Set(readWins()); wins.add(today); storageSet("pokesort-wins", JSON.stringify([...wins])); updateStreak(); }
    save();
  }

  function newInfinite() { round++; storageSet("pokesort-infinite-round", round); selected = []; solved = []; mistakes = 0; revealed = false; gameOver = false; load(); }

  async function share() {
    const squares = pack.map((group, index) => solved.includes(group.name) ? ["🟨", "🟦", "🟥", "🟩"][index] : "⬜").join("");
    const label = mode === "infinite" ? `PokeSort Infinite #${round + 1}` : `PokeSort ${dateKey}`;
    const sharePath = mode === "infinite" ? "/infinite/" : dateKey === today ? "/" : pathDate === dateKey ? `/daily/${dateKey}/` : `/?date=${encodeURIComponent(dateKey)}`;
    const text = `${label}\n${squares}\n${mistakes}/4 mistakes\n${location.origin}${sharePath}`;
    try { if (navigator.share) await navigator.share({ text }); else { await navigator.clipboard.writeText(text); $("#game-status").textContent = "Result copied!"; } } catch { /* Sharing can be cancelled by the player. */ }
  }

  document.querySelectorAll("[data-mode]").forEach((button) => button.addEventListener("click", () => { location.assign(button.dataset.mode === "infinite" ? "/infinite/#game" : "/#game"); }));
  $("#submit-selection").addEventListener("click", submit);
  $("#deselect-all").addEventListener("click", () => { if (!gameOver) { selected = []; render(); } });
  $("#shuffle-board").addEventListener("click", () => { if (!gameOver) { cards = shuffle(cards, Date.now()); save(); render(); } });
  $("#reveal-board").addEventListener("click", () => { revealed = true; gameOver = true; solved = pack.map((group) => group.name); cards = []; selected = []; save(); render(); });
  $("#hint-button").addEventListener("click", () => { $("#game-status").textContent = pack.find((group) => !solved.includes(group.name))?.hint || "You found every connection!"; });
  $("#new-infinite").addEventListener("click", newInfinite);
  $("#share-result").addEventListener("click", share);
  $("#puzzle-grid").addEventListener("keydown", (event) => {
    const buttons = [...$("#puzzle-grid").querySelectorAll("button")], current = Number(document.activeElement?.dataset.index || 0), moves = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -4, ArrowDown: 4 };
    if (moves[event.key] != null && buttons.length) { event.preventDefault(); buttons[(current + moves[event.key] + buttons.length) % buttons.length]?.focus(); }
    if (event.key === "Enter" && selected.length === 4) { event.preventDefault(); submit(); }
  });
  updateStreak(); load();
}
