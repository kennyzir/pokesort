import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validatePublicDailyHistory } from "./public-daily-history.mjs";

const result = await validatePublicDailyHistory({ asOfDate: new Date().toISOString().slice(0, 10), verifySolver: true });
const today = new Date().toISOString().slice(0, 10);
if (result.newestDate !== today) throw new Error(`PUBLIC_HISTORY_NOT_CURRENT:expected=${today}:received=${result.newestDate}`);
console.log(JSON.stringify({ gate: "PASS", utcDate: today, historyDates: result.dates.length, newestDate: result.newestDate }));

if (!process.argv[1] || resolve(process.argv[1]) !== fileURLToPath(import.meta.url)) throw new Error("verify-public-current is CLI-only");
