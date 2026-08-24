import { bindTodayAnalytics } from "./pokelike-today-analytics.js";

const parts = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
const localDate = `${values.year}-${values.month}-${values.day}`;
const page = document.querySelector("[data-puzzle-date]");
if (page) {
  if (localDate !== page.dataset.puzzleDate) {
    const replacement = document.querySelector("#date-mismatch-template")?.content.cloneNode(true);
    const date = replacement?.querySelector("[data-local-date]");
    if (date) { date.dateTime = localDate; date.textContent = localDate; }
    if (replacement) page.replaceWith(replacement);
  }
}
for (const date of document.querySelectorAll("main[data-today-state='unavailable'] [data-local-date]")) { date.dateTime = localDate; date.textContent = localDate; }
for (const label of document.querySelectorAll("main[data-today-state='unavailable'] [data-date-label]")) label.textContent = "Your browser’s local date";
bindTodayAnalytics();
