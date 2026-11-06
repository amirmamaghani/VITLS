/** Apple Universal Links: the AASA must be served without an extension and as JSON; static serving skips extensionless files. */
import { defineEventHandler, setHeader } from "h3";

import aasa from "../../lib/apple-app-site-association.json";

export default defineEventHandler((event) => {
  setHeader(event, "content-type", "application/json");
  setHeader(event, "cache-control", "public, max-age=3600");
  return aasa;
});
