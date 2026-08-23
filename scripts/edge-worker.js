export const ARCHIVE_NEWEST_DATE = "__ARCHIVE_NEWEST_DATE__";
export const ARCHIVE_OLDEST_DATE = "__ARCHIVE_OLDEST_DATE__";

function validDateKey(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.hostname === "www.pokesort.org") {
      url.protocol = "https:";
      url.hostname = "pokesort.org";
      return Response.redirect(url.toString(), 308);
    }

    if (url.pathname === "/" && url.searchParams.get("mode") === "infinite") {
      return Response.redirect(new URL("/infinite/", url).toString(), 308);
    }

    const requestedDate = url.pathname === "/" ? url.searchParams.get("date") : null;
    if (validDateKey(requestedDate)) {
      if (requestedDate >= ARCHIVE_OLDEST_DATE && requestedDate <= ARCHIVE_NEWEST_DATE) {
        return Response.redirect(new URL(`/daily/${requestedDate}/`, url).toString(), 308);
      }
    }

    return env.ASSETS.fetch(request);
  },
};
