# Upstream issue draft — BuilderIO/agent-native

**Title:** Auth guard matches public paths against the raw (non-normalized) request path; dot segments let requests skip the guard

**Version:** `@agent-native/core` 0.198.8 (Node adapter, `agent-native dev`)

## Summary

The auth guard decides whether a request is public by prefix-matching `createAuthPlugin({ publicPaths })` against the
raw request URL, while the router later resolves dot segments (`..`, `%2e%2e`). A request whose raw path starts with a
public prefix but resolves to a protected route therefore passes the guard and reaches that route's handler without the
guard's session check. Handlers that enforce auth themselves (actions, org routes) still reject the request, but any
handler that relies solely on the guard would be reachable unauthenticated.

## Details

- `dist/server/auth.js` (guard, ~L2701): the path comes from `event.node?.req?.url`, then
  `stripAppBasePath(canonicalFrameworkPathname(rawPath))` — neither step resolves dot segments or percent-encoded dots.
- `dist/server/auth.js` `matchesPathList` (~L3553): `path === normalized || path.startsWith(normalized + "/")`, so an
  exact public path such as `/api/devices/redeem` also admits `/api/devices/redeem/../../<anything>`.
- Routing then normalizes: h3 decodes `%2e` and srvx resolves dot segments via the WHATWG URL parser, so the request
  is dispatched to `/<anything>`.
- The same applies to the framework's own prefix/suffix allowances (e.g. `/assets/`, `.js`).

## Reproduction (local)

App with `createAuthPlugin({ publicPaths: ["/api/devices/redeem"] })`, no session cookie:

```
curl --path-as-is http://localhost:8080/_agent-native/org/members
# 401 {"error":"Unauthorized","hint":"No valid session cookie reached the dev server ..."}   <- guard

curl --path-as-is http://localhost:8080/api/devices/redeem/../../_agent-native/org/members
# 401 {"error":"Unauthorized"}   <- different response: guard skipped, handler rejected

curl --path-as-is http://localhost:8080/settings
# 302 (guard redirect to sign-in)

curl --path-as-is http://localhost:8080/api/devices/redeem/../../settings
# 401 {"error":"Unauthorized"}   <- not the guard's redirect
```

We did not find a handler that is reachable without auth this way; the concern is defense in depth for routes and
app-defined handlers that assume the guard ran.

## Suggested fix

Match against the normalized pathname the router will use (e.g. `new URL(url, "http://x").pathname` after decoding
`%2e`), and/or reject requests whose raw path contains dot segments (`/./`, `/../`, `%2e`) before the public-path check.
