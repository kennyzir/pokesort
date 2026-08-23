const root = document.querySelector("#pokelike-slots");

if (root) {
  const key = "pokesort-pokelike-worksheet";
  const date = document.querySelector("#worksheet-date"), notes = document.querySelector("#worksheet-notes"), status = document.querySelector("#worksheet-status");
  const slots = [...document.querySelectorAll("[data-slot]")], links = [...document.querySelectorAll("[data-link]")];
  const read = () => { try { return JSON.parse(localStorage.getItem(key) || "{}"); } catch { return {}; } };
  const render = () => { const state = read(); date.value = state.date || new Date().toISOString().slice(0, 10); notes.value = state.notes || ""; slots.forEach((input, index) => { input.value = state.slots?.[index] || ""; }); links.forEach((select, index) => { select.value = state.links?.[index] || ""; }); };
  const save = () => { localStorage.setItem(key, JSON.stringify({ date: date.value, notes: notes.value, slots: slots.map((input) => input.value), links: links.map((select) => select.value) })); status.textContent = "Worksheet saved locally."; };
  [...slots, ...links, date, notes].forEach((field) => field.addEventListener("input", save));
  document.querySelector("#clear-worksheet").addEventListener("click", () => { localStorage.removeItem(key); render(); status.textContent = "Worksheet cleared."; slots[0].focus(); });
  render();
}
