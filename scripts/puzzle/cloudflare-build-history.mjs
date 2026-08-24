import { cp, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { publishElapsedHistory } from "./publish-elapsed-history.mjs";
import { validatePublicDailyHistory } from "./public-daily-history.mjs";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const validDate = (value) => ISO_DATE.test(value || "") && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;
const addDays = (value, days) => {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};
const datesAfter = (startExclusive, endInclusive) => {
  const dates = [];
  for (let date = addDays(startExclusive, 1); date <= endInclusive; date = addDays(date, 1)) dates.push(date);
  return dates;
};

export const DEFAULT_EDGE_ACTIVATION_DATE = "2026-08-25";

export async function prepareCloudflareBuildHistory({
  sourceDirectory,
  outputDirectory,
  asOfDate = new Date().toISOString().slice(0, 10),
  activationDate = DEFAULT_EDGE_ACTIVATION_DATE,
  apiBaseUrl = "https://pokesort.org/api/daily",
  fetchImplementation = fetch,
} = {}) {
  if (!sourceDirectory || !outputDirectory) throw new Error("CLOUDFLARE_BUILD_DIRECTORIES_REQUIRED");
  if (!validDate(asOfDate) || !validDate(activationDate)) throw new Error("CLOUDFLARE_BUILD_DATE_INVALID");
  await mkdir(resolve(outputDirectory), { recursive: true });
  await cp(resolve(sourceDirectory), resolve(outputDirectory), { recursive: true });

  const initial = await validatePublicDailyHistory({ directory: outputDirectory, asOfDate, verifySolver: true });
  if (initial.newestDate > asOfDate) throw new Error("CLOUDFLARE_BUILD_HISTORY_IN_FUTURE");
  const missingDates = datesAfter(initial.newestDate, asOfDate);
  const preActivationGaps = missingDates.filter((date) => date < activationDate);
  if (preActivationGaps.length) throw new Error(`CLOUDFLARE_PREACTIVATION_HISTORY_GAP:${preActivationGaps[0]}`);
  const apiDates = missingDates;

  for (const date of apiDates) {
    const response = await fetchImplementation(`${apiBaseUrl.replace(/\/$/, "")}/${date}`, {
      headers: { accept: "application/json", "cache-control": "no-cache" },
    });
    if (!response.ok) throw new Error(`CLOUDFLARE_DAILY_API_UNAVAILABLE:${date}:${response.status}`);
    const payload = await response.json();
    await publishElapsedHistory({ payload, publicDirectory: outputDirectory, asOfDate: date, write: true });
  }

  const finalHistory = await validatePublicDailyHistory({ directory: outputDirectory, asOfDate, verifySolver: true });
  if (finalHistory.newestDate !== asOfDate) throw new Error(`CLOUDFLARE_BUILD_HISTORY_INCOMPLETE:${finalHistory.newestDate}:${asOfDate}`);
  return {
    gate: "PASS",
    asOfDate,
    activationDate,
    sourceNewestDate: initial.newestDate,
    finalNewestDate: finalHistory.newestDate,
    historyDates: finalHistory.dates.length,
    fetchedApiDates: apiDates,
  };
}
