const PACKS = [
  [
    { name: "Eeveelutions", hint: "Evolutions of Eevee", color: "#ffe283", mons: ["Vaporeon", "Jolteon", "Flareon", "Espeon"] },
    { name: "Restored fossils", hint: "Pokémon revived from fossils", color: "#bcd5ff", mons: ["Omanyte", "Kabuto", "Aerodactyl", "Cranidos"] },
    { name: "Baby Pokémon", hint: "Introduced in an unevolved baby stage", color: "#ffc8c3", mons: ["Pichu", "Cleffa", "Igglybuff", "Togepi"] },
    { name: "Ultra Beasts", hint: "Visitors identified as Ultra Beasts", color: "#bde9d0", mons: ["Nihilego", "Buzzwole", "Pheromosa", "Xurkitree"] }
  ],
  [
    { name: "Fire-type starter finals", hint: "Fully evolved Fire starter Pokémon", color: "#ffe283", mons: ["Charizard", "Typhlosion", "Blaziken", "Infernape"] },
    { name: "Water / Ground", hint: "Share the Water and Ground typing", color: "#bcd5ff", mons: ["Quagsire", "Swampert", "Whiscash", "Gastrodon"] },
    { name: "Dragon pseudo-legendaries", hint: "Dragon-type members of pseudo-legendary lines", color: "#ffc8c3", mons: ["Dragonite", "Salamence", "Garchomp", "Hydreigon"] },
    { name: "Mythical Pokémon", hint: "Mythical Pokémon from Generations I–IV", color: "#bde9d0", mons: ["Mew", "Celebi", "Jirachi", "Manaphy"] }
  ],
  [
    { name: "Kanto Poison types", hint: "Poison-type Pokémon introduced in Kanto", color: "#ffe283", mons: ["Arbok", "Nidoqueen", "Muk", "Weezing"] },
    { name: "Classic trade evolutions", hint: "Originally evolved through trading", color: "#bcd5ff", mons: ["Alakazam", "Machamp", "Golem", "Gengar"] },
    { name: "Single-stage Normal types", hint: "Normal types with no evolution in their debut", color: "#ffc8c3", mons: ["Tauros", "Kangaskhan", "Snorlax", "Miltank"] },
    { name: "Stone evolutions", hint: "Evolve using an evolutionary stone", color: "#bde9d0", mons: ["Arcanine", "Vileplume", "Starmie", "Chandelure"] }
  ]
];

const $ = (selector) => document.querySelector(selector);
const grid = $("#puzzle-grid");
if (grid) {
  const dateKey = new Date().toISOString().slice(0, 10);
  let mode = "daily";
  let round = Number(localStorage.getItem("monsort-infinite-round") || 0);
  let selected = [];
  let solved = [];
  let mistakes = 0;
  let cards = [];
  let pack = [];

  function hash(text) {
    let value = 2166136261;
    for (const char of text) value = Math.imul(value ^ char.charCodeAt(0), 16777619);
    return value >>> 0;
  }
  function rng(seed) {
    return () => {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function shuffle(items, seed) {
    const result = [...items];
    const random = rng(seed);
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }
  function storageKey() { return mode === "daily" ? `monsort-daily-${dateKey}` : `monsort-infinite-${round}`; }
  function save() { localStorage.setItem(storageKey(), JSON.stringify({ cards, solved, mistakes })); }
  function load() {
    const seedText = mode === "daily" ? dateKey : `infinite-${round}`;
    const seed = hash(seedText);
    pack = PACKS[seed % PACKS.length];
    const freshCards = shuffle(pack.flatMap(group => group.mons), seed);
    try {
      const stored = JSON.parse(localStorage.getItem(storageKey()));
      cards = stored?.cards || freshCards;
      solved = stored?.solved || [];
      mistakes = stored?.mistakes || 0;
    } catch { cards = freshCards; solved = []; mistakes = 0; }
    selected = [];
    render();
  }
  function render() {
    grid.innerHTML = cards.map((name, index) => `<button class="poke-card${selected.includes(name) ? " selected" : ""}" data-name="${name}" data-index="${index}" aria-pressed="${selected.includes(name)}">${name}</button>`).join("");
    $("#solved-groups").innerHTML = solved.map(name => {
      const group = pack.find(item => item.name === name);
      return `<div class="solved-group" style="background:${group.color}"><strong>${group.name}</strong><span>${group.mons.join(" · ")}</span></div>`;
    }).join("");
    $("#mistakes").innerHTML = `Mistakes remaining: ${Array.from({ length: Math.max(0, 4 - mistakes) }, () => '<i class="dot"></i>').join("")}`;
    $("#submit-selection").disabled = selected.length !== 4;
    $("#game-kicker").textContent = mode === "daily" ? `Daily puzzle · ${dateKey}` : `Infinite puzzle · #${round + 1}`;
    grid.querySelectorAll("button").forEach(button => button.addEventListener("click", () => toggle(button.dataset.name)));
    if (!cards.length && solved.length === 4) finish(true);
  }
  function toggle(name) {
    if (selected.includes(name)) selected = selected.filter(item => item !== name);
    else if (selected.length < 4) selected.push(name);
    render();
  }
  function submit() {
    if (selected.length !== 4) return;
    const match = pack.find(group => selected.every(name => group.mons.includes(name)));
    if (match) {
      solved.push(match.name);
      cards = cards.filter(name => !selected.includes(name));
      selected = [];
      $("#game-status").textContent = "That group connects!";
      save(); render();
    } else {
      mistakes++;
      const near = pack.some(group => selected.filter(name => group.mons.includes(name)).length === 3);
      $("#game-status").textContent = near ? "One away…" : "Not the connection — try again.";
      grid.classList.remove("shake"); void grid.offsetWidth; grid.classList.add("shake");
      selected = [];
      save(); render();
      if (mistakes >= 4) finish(false);
    }
  }
  function finish(won) {
    $("#game-status").textContent = won ? "Perfect sort! Your result is saved on this device." : "No mistakes left — use Reveal to study the board.";
    if (won && mode === "daily") localStorage.setItem("monsort-last-win", dateKey);
  }
  function reveal() {
    solved = pack.map(group => group.name); cards = []; selected = []; save(); render();
    $("#game-status").textContent = "Board revealed. A fresh infinite puzzle is always ready.";
  }
  function newInfinite() {
    mode = "infinite"; round++; localStorage.setItem("monsort-infinite-round", round); load(); setModeButtons();
  }
  function setModeButtons() {
    document.querySelectorAll("[data-mode]").forEach(button => button.classList.toggle("active", button.dataset.mode === mode));
  }
  document.querySelectorAll("[data-mode]").forEach(button => button.addEventListener("click", () => { mode = button.dataset.mode; load(); setModeButtons(); }));
  $("#submit-selection").addEventListener("click", submit);
  $("#deselect-all").addEventListener("click", () => { selected = []; render(); });
  $("#shuffle-board").addEventListener("click", () => { cards = shuffle(cards, Date.now()); save(); render(); });
  $("#reveal-board").addEventListener("click", reveal);
  $("#new-infinite").addEventListener("click", newInfinite);
  grid.addEventListener("keydown", event => {
    const buttons = [...grid.querySelectorAll("button")];
    const current = Number(document.activeElement?.dataset.index ?? 0);
    const moves = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -4, ArrowDown: 4 };
    if (moves[event.key] !== undefined) { event.preventDefault(); buttons[(current + moves[event.key] + buttons.length) % buttons.length]?.focus(); }
    if (event.key === "Enter" && selected.length === 4) submit();
  });
  load(); setModeButtons();
}
