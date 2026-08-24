import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { computeContentSha256, inspectManifest } from "./verify-manifest.mjs";

export const OFFICIAL_URL = "https://pokelike.xyz/pokesort";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const iso = (value = new Date()) => value.toISOString();

export function localDateAt(instant, timezone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function assertTimezone(timezone) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone }).format();
  } catch {
    throw new Error(`Invalid IANA timezone: ${timezone}`);
  }
  if (timezone !== "UTC" && !timezone.includes("/")) throw new Error(`Timezone must be UTC or an IANA area/location: ${timezone}`);
}

function explanation(relation, left, right) {
  switch (relation) {
    case "color": return `${left.name} and ${right.name} share the ${left.color} body colour.`;
    case "type": return `${left.name} and ${right.name} share at least one type.`;
    case "gen_eq": return `${left.name} and ${right.name} were introduced in generation ${left.generation}.`;
    case "gen_gt": return `${left.name} is generation ${left.generation}; ${right.name} is generation ${right.generation}.`;
    case "gen_lt": return `${left.name} is generation ${left.generation}; ${right.name} is generation ${right.generation}.`;
    case "stage_eq": return `${left.name} and ${right.name} are both evolution stage ${left.stage}.`;
    case "stage_gt": return `${left.name} is stage ${left.stage}; ${right.name} is stage ${right.stage}.`;
    case "stage_lt": return `${left.name} is stage ${left.stage}; ${right.name} is stage ${right.stage}.`;
    case "se": return `${left.name}'s primary type is super-effective against ${right.name}'s primary type.`;
    default: return `Unsupported relation ${relation}.`;
  }
}

function stableState(snapshot) {
  return {
    day: snapshot.day,
    puzzleNumber: snapshot.puzzleNumber,
    slots: snapshot.state.slots,
    conditions: snapshot.state.conds,
    solution: snapshot.state.solution,
    candidates: snapshot.candidates,
    conditionDefinitions: snapshot.conditionDefinitions,
    officialSolutionCount: snapshot.officialSolutionCount,
  };
}

export function sampleIdentity(sample) {
  return sha256(JSON.stringify({
    state: stableState(sample.snapshot),
    sourceUrl: sample.source.url,
    sourceSha256: sample.source.bodySha256,
    bundleUrl: sample.bundle.url,
    bundleSha256: sample.bundle.bodySha256,
  }));
}

export function compareSamples(samples) {
  if (!Array.isArray(samples) || samples.length < 2) throw new Error("At least two samples are required for consistency verification.");
  const identities = samples.map(sampleIdentity);
  if (!identities.every((identity) => identity === identities[0])) {
    throw new Error(`Official samples were inconsistent: ${identities.join(", ")}`);
  }
  return identities[0];
}

export function normalizeSample(sample, timezone, verifiedAt = new Date()) {
  assertTimezone(timezone);
  const { snapshot } = sample;
  const observedAt = new Date(sample.source.date ?? sample.capturedAt);
  if (!Number.isFinite(observedAt.valueOf())) throw new Error("Official response Date and capturedAt are both invalid.");
  const localDate = new Date(snapshot.day * 86_400_000).toISOString().slice(0, 10);
  const candidates = snapshot.candidates.map(({ id, name, gen, stage, color, types }) => ({
    id,
    name,
    generation: gen,
    stage,
    color,
    types: types.map((type) => type.toLowerCase()),
  }));
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const links = snapshot.state.conds.map((relation, index) => {
    const leftId = snapshot.state.solution[index];
    const rightId = snapshot.state.solution[index + 1];
    return { relation, leftId, rightId, explanation: explanation(relation, byId.get(leftId), byId.get(rightId)) };
  });
  const manifest = {
    schemaVersion: 1,
    game: "pokelike-pokesort",
    status: "EXTRACTED",
    localDate,
    timezone,
    day: snapshot.day,
    puzzleNumber: snapshot.puzzleNumber,
    observedAt: observedAt.toISOString(),
    verifiedAt: verifiedAt.toISOString(),
    candidates,
    startOrder: [...snapshot.state.slots],
    links,
    solutionOrder: [...snapshot.state.solution],
    hints: {
      noSpoiler: "Use the five displayed relation symbols as directional constraints before revealing the order.",
      progressive: snapshot.conditionDefinitions.map(({ desc }, index) => `Link ${index + 1}: ${desc}`),
    },
    provenance: {
      sourceUrl: sample.source.url,
      sourceSha256: sample.source.bodySha256,
      bundleUrl: sample.bundle.url,
      bundleSha256: sample.bundle.bodySha256,
      stateSha256: sha256(JSON.stringify(stableState(snapshot))),
      contentSha256: "0".repeat(64),
    },
  };
  manifest.provenance.contentSha256 = computeContentSha256(manifest);
  return manifest;
}

function responseEvidence(response, body, capturedAt) {
  const headers = response.headers();
  return {
    url: response.url(),
    status: response.status(),
    date: headers.date ?? null,
    etag: headers.etag ?? null,
    bodyBytes: body.byteLength,
    bodySha256: sha256(body),
    capturedAt,
  };
}

export async function captureOnce({ timezone, chromium }) {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ timezoneId: timezone });
    const page = await context.newPage();
    const bundleResponses = [];
    page.on("response", (response) => {
      if (/\/js\/bundle\.[a-f0-9]+\.js(?:\?|$)/i.test(response.url())) bundleResponses.push(response);
    });
    const documentResponse = await page.goto(OFFICIAL_URL, { waitUntil: "networkidle", timeout: 60_000 });
    if (!documentResponse || !documentResponse.ok()) throw new Error(`Official page returned ${documentResponse?.status() ?? "no response"}.`);
    const capturedAt = iso();
    const snapshot = await page.evaluate(() => {
      const state = eval("_pcState");
      const definitions = eval("POKECHAIN_CONDITIONS");
      const conditionDefinitions = state.conds.map((key) => {
        const definition = definitions.find((candidate) => candidate.key === key);
        if (!definition) throw new Error(`Missing official condition definition: ${key}`);
        return { key: definition.key, label: definition.label, cmp: definition.cmp, desc: definition.desc };
      });
      const candidates = state.slots.map((id) => pcMon(id));
      return {
        day: typeof pcDayNumber === "function" ? pcDayNumber() : pcDayNumber,
        puzzleNumber: typeof pcPuzzleNumber === "function" ? pcPuzzleNumber() : pcPuzzleNumber,
        state: { slots: [...state.slots], conds: [...state.conds], solution: [...state.solution] },
        candidates: candidates.map(({ id, name, types, color, gen, stage }) => ({ id, name, types, color, gen, stage })),
        conditionDefinitions,
        officialSolutionCount: pcCountSolutions(candidates, state.conds.map((key) => definitions.find((candidate) => candidate.key === key)), 721),
      };
    });
    const bundleResponse = bundleResponses.at(-1);
    if (!bundleResponse || !bundleResponse.ok()) throw new Error("Versioned official bundle response was not captured.");
    const [sourceBody, bundleBody] = await Promise.all([documentResponse.body(), bundleResponse.body()]);
    return {
      capturedAt,
      source: responseEvidence(documentResponse, sourceBody, capturedAt),
      bundle: responseEvidence(bundleResponse, bundleBody, capturedAt),
      snapshot,
    };
  } finally {
    await browser.close();
  }
}

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function captureWithRetry(options, dependencies) {
  let error;
  for (let attempt = 1; attempt <= options.retries; attempt += 1) {
    try {
      return await dependencies.captureOnce({ timezone: options.timezone, chromium: dependencies.chromium });
    } catch (caught) {
      error = caught;
      if (attempt < options.retries) await dependencies.delay(options.retryDelayMs);
    }
  }
  throw error;
}

export async function runShadowCapture(options, dependencies) {
  const startedAt = iso(dependencies.now());
  const transitions = [{ state: "PENDING", at: startedAt }];
  const samples = [];
  try {
    for (let index = 0; index < options.samples; index += 1) {
      samples.push(await captureWithRetry(options, dependencies));
      if (index + 1 < options.samples) await dependencies.delay(options.intervalMs);
    }
    transitions.push({ state: "EXTRACTED", at: iso(dependencies.now()) });
    const consistencySha256 = compareSamples(samples);
    const manifest = normalizeSample(samples[0], options.timezone, dependencies.now());
    const officialDate = new Date(samples[0].source.date ?? samples[0].capturedAt);
    const currentLocalDate = localDateAt(officialDate, options.timezone);
    if (manifest.localDate !== currentLocalDate) {
      manifest.status = "STALE";
      transitions.push({ state: "STALE", at: iso(dependencies.now()), reason: `official puzzle date ${manifest.localDate} is older than ${currentLocalDate}` });
      return { ok: false, status: "STALE", timezone: options.timezone, transitions, consistencySha256, samples, manifest };
    }
    const inspection = inspectManifest({ ...manifest, status: "VERIFIED" }, { now: new Date(manifest.verifiedAt) });
    if (!inspection.valid || snapshotCount(samples[0]) !== 1 || inspection.solutionCount !== 1) {
      throw new Error(`Independent verification failed: official=${snapshotCount(samples[0])}; local=${inspection.solutionCount}; ${inspection.issues.map((item) => item.code).join(", ")}`);
    }
    manifest.status = "VERIFIED";
    transitions.push({ state: "VERIFIED", at: manifest.verifiedAt });
    return { ok: true, status: "VERIFIED", timezone: options.timezone, transitions, consistencySha256, samples, manifest, verification: { localSolutionCount: inspection.solutionCount, officialSolutionCount: snapshotCount(samples[0]), permutationsChecked: 720 } };
  } catch (error) {
    transitions.push({ state: "BLOCKED", at: iso(dependencies.now()), reason: error.message });
    return { ok: false, status: "BLOCKED", timezone: options.timezone, transitions, samples, error: { name: error.name, message: error.message } };
  }
}

const snapshotCount = (sample) => sample.snapshot.officialSolutionCount;

export function parseArgs(argv) {
  const options = { timezone: "UTC", samples: 2, intervalMs: 2_000, retries: 3, retryDelayMs: 1_000, write: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--write") options.write = true;
    else if (arg === "--timezone") options.timezone = argv[++index];
    else if (arg === "--samples") options.samples = Number(argv[++index]);
    else if (arg === "--interval-ms") options.intervalMs = Number(argv[++index]);
    else if (arg === "--retries") options.retries = Number(argv[++index]);
    else if (arg === "--retry-delay-ms") options.retryDelayMs = Number(argv[++index]);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  assertTimezone(options.timezone);
  if (!Number.isInteger(options.samples) || options.samples < 2) throw new Error("--samples must be an integer of at least 2.");
  if (!Number.isInteger(options.retries) || options.retries < 1) throw new Error("--retries must be a positive integer.");
  for (const key of ["intervalMs", "retryDelayMs"]) if (!Number.isFinite(options[key]) || options[key] < 0) throw new Error(`--${key} must be non-negative.`);
  return options;
}

export function evidencePath(record, root = path.resolve("data", "pokelike", "shadow")) {
  const timezone = record.manifest?.timezone ?? "unknown";
  const localDate = record.manifest?.localDate ?? localDateAt(new Date(record.transitions[0].at), timezone === "unknown" ? "UTC" : timezone);
  const stamp = record.transitions[0].at.replaceAll(":", "-");
  return path.join(root, timezone.replaceAll("/", "__"), localDate, `${stamp}.${record.status.toLowerCase()}.json`);
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
    const { chromium } = await import("playwright");
    const record = await runShadowCapture(options, { chromium, captureOnce, delay, now: () => new Date() });
    const rendered = `${JSON.stringify(record, null, 2)}\n`;
    if (options.write) {
      const output = evidencePath(record);
      await mkdir(path.dirname(output), { recursive: true });
      await writeFile(output, rendered, { encoding: "utf8", flag: "wx" });
      process.stdout.write(`${output}\n`);
    } else {
      process.stdout.write(rendered);
    }
    if (!record.ok) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
