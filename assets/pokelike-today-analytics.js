export const TODAY_EVENT_CONTRACT = Object.freeze({
  pokelike_today_view: Object.freeze({ today_state: ["published", "preview", "unavailable"] }),
  pokelike_today_hint_open: Object.freeze({ today_state: ["published", "preview"], hint_level: "non_negative_integer" }),
  pokelike_today_answer_reveal: Object.freeze({ today_state: ["published", "preview"] }),
  pokelike_today_official_click: Object.freeze({ today_state: ["published", "preview", "unavailable"] }),
  pokelike_today_community_click: Object.freeze({ today_state: ["published", "preview", "unavailable"] }),
  pokelike_today_unavailable: Object.freeze({ today_state: ["unavailable"], availability_reason: ["not_published", "stale_record", "local_date_mismatch", "verification_failed", "build_failed"] }),
});

export function validateTodayEvent(eventName, parameters = {}) {
  const definition = TODAY_EVENT_CONTRACT[eventName];
  if (!definition) throw new TypeError(`Unsupported Today analytics event: ${eventName}`);
  const expected = Object.keys(definition).sort();
  const actual = Object.keys(parameters).sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) throw new TypeError(`${eventName} parameters must be exactly: ${expected.join(", ")}`);
  for (const [key, rule] of Object.entries(definition)) {
    const value = parameters[key];
    if (rule === "non_negative_integer") {
      if (!Number.isInteger(value) || value < 0) throw new TypeError(`${eventName}.${key} must be a non-negative integer`);
    } else if (!rule.includes(value)) throw new TypeError(`${eventName}.${key} is not an allowed value`);
  }
  return Object.freeze({ ...parameters });
}

export function emitTodayEvent(eventName, parameters, browserWindow = window) {
  const safeParameters = validateTodayEvent(eventName, parameters);
  if (typeof browserWindow.gtag === "function") browserWindow.gtag("event", eventName, safeParameters);
  else {
    browserWindow.dataLayer = browserWindow.dataLayer || [];
    browserWindow.dataLayer.push(["event", eventName, safeParameters]);
  }
}

export function bindTodayAnalytics(documentRoot = document, browserWindow = window) {
  const main = documentRoot.querySelector("main[data-today-state]");
  if (!main || main.dataset.todayAnalyticsBound === "true") return false;
  main.dataset.todayAnalyticsBound = "true";
  const todayState = main.dataset.todayState;
  emitTodayEvent("pokelike_today_view", { today_state: todayState }, browserWindow);
  if (todayState === "unavailable") emitTodayEvent("pokelike_today_unavailable", { today_state: "unavailable", availability_reason: main.dataset.availabilityReason || "not_published" }, browserWindow);
  for (const disclosure of main.querySelectorAll("details[data-hint-level]")) disclosure.addEventListener("toggle", () => {
    if (disclosure.open) emitTodayEvent("pokelike_today_hint_open", { today_state: todayState, hint_level: Number(disclosure.dataset.hintLevel) }, browserWindow);
  });
  const answer = main.querySelector("details[data-answer-reveal]");
  answer?.addEventListener("toggle", () => {
    if (answer.open) emitTodayEvent("pokelike_today_answer_reveal", { today_state: todayState }, browserWindow);
  });
  for (const link of main.querySelectorAll("a[data-today-analytics-target]")) link.addEventListener("click", () => {
    const eventName = link.dataset.todayAnalyticsTarget === "community" ? "pokelike_today_community_click" : "pokelike_today_official_click";
    emitTodayEvent(eventName, { today_state: todayState }, browserWindow);
  });
  return true;
}
