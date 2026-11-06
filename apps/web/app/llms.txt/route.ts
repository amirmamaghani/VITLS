import { appUrl, repoUrl } from "@/lib/app-url";
import en from "@/messages/en.json";

// Same Q&A as the visible FAQ and the FAQPage JSON-LD (English source copy).
const faq = Object.values(en.faq.items)
  .map(({ q, a }) => `### ${q}\n\n${a.replace(/\u00a0/g, " ")}\n`)
  .join("\n");

export const dynamic = "force-static";

/**
 * Agent-facing instructions (llms.txt convention): what VITLS is and how an AI agent
 * reaches the VITLS app (apps/app, agent-native) over A2A and MCP. Endpoints mirror
 * what @agent-native/core mounts; keep in sync on framework upgrades.
 */
export function GET() {
  const body = `# VITLS

> VITLS is an AI health and longevity coach that runs the user's whole body: it reads their vitals
> (HRV, sleep, resting heart rate, weight, workouts), remembers their story, and tells them what to do
> today. One coach for nutrition, training, recovery and body composition. Coaching, not medical advice.

## Product facts

- Category: AI health and longevity coach (chat-first), not a wearable device and not a medical service.
- Available now (early access): chat coach with four personas (strict, scientist, supportive, longevity
  mentor), three strictness levels and long-term memory, answering in the user's language; guided onboarding
  that builds the first dashboard; morning readout at a chosen time (in-app inbox + Web Push); weekly training
  plan from a 1,324-exercise library (sets, reps, RIR, injury-safe notes); food logging in chat with 18
  nutrients, barcode lookup and open food databases (USDA, CIQUAL, BLS, Open Food Facts); dashboards the
  coach designs and edits; manual entry of weight, blood pressure, workouts and other metrics; trend vs a
  60-day personal baseline and the water-vs-fat check for overnight weight jumps.
- Coming soon: companion app reading Apple Health and Android Health Connect, so devices that sync there
  (e.g. Garmin, Polar, Suunto, Samsung, Oura, WHOOP, Fitbit, Withings, Strava) come along; no direct vendor APIs; photo food logging;
  nutrition targets and protein nudges; export to share with a doctor.
- Operator: VERTISPACE s.r.o., Lidická 700/19, 602 00 Brno, Czech Republic (IČO 21095566). Contact: hey@vitls.ai.
- What it does: reads HRV, sleep, resting heart rate, weight and workouts; separates day-to-day weight noise
  from real body-composition change; balances training load against recovery; tracks long-term goals
  (fat loss, endurance, strength, VO2max, longevity); remembers injuries, goals and life events.
- Coaching styles: strict, scientist, supportive, longevity mentor.
- Who it's for: gym-goers, longevity enthusiasts, biohackers and everyday people who want to feel better.
- Privacy: launching on EU infrastructure; data encrypted in transit; sensitive records (sleep stages,
  workouts, meal notes) encrypted with a per-account key; optional bring-your-own AI key.
- Open source: AGPL-3.0, code at ${repoUrl}. Self-hosting and contributions welcome; a modified version run
  as a network service must publish its source.
- Status: early access. Pricing has not been announced.
- Languages: English, Slovak, Czech, Spanish, Italian, Russian.

## FAQ

${faq}
## For AI agents

This site (the marketing site) has no API. The product is the VITLS app at ${appUrl}, built on
agent-native. Agents interact with it in two ways:

- **MCP** — call the app's actions directly as tools, on behalf of a signed-in user. Use this to read
  health data, update the coach profile or edit the dashboard.
- **A2A** — hand a task to the VITLS coach agent, which reasons over it with its own tools and replies.
  Use this when the coach should think (interpret a readout, plan a training day).

## A2A (agent-to-agent)

- Agent card: ${appUrl}/.well-known/agent-card.json (also served at /.well-known/agent-card.json on this site)
- JSON-RPC 2.0 endpoint: POST ${appUrl}/_agent-native/a2a
- Methods: \`message/send\`, \`message/stream\` (SSE), \`tasks/get\`, \`tasks/cancel\`
- Always send \`"async": true\` with \`message/send\`, then poll \`tasks/get\` until the task is
  \`completed\`, \`failed\` or \`canceled\`. Coach turns can outlast serverless gateway timeouts.
- Auth: \`Authorization: Bearer <token>\` using a scheme listed in the agent card's \`securitySchemes\`
  (JWT signed with the deployment's shared A2A secret for agent-native peers). Production refuses
  unauthenticated calls.
- Message parts: \`{ "type": "text" }\` for instructions, \`{ "type": "data" }\` for structured input.
  Reuse \`contextId\` to continue the same conversation.

Example:

\`\`\`json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "message/send",
  "params": {
    "message": {
      "role": "user",
      "parts": [{ "type": "text", "text": "Give me today's morning readout and training directive." }]
    },
    "async": true
  }
}
\`\`\`

## MCP (tools)

- Server URL: ${appUrl}/mcp (streamable HTTP)
- Setup page with per-host instructions: ${appUrl}/mcp/connect
- Auth: OAuth 2.1 with PKCE and dynamic client registration. Discovery:
  ${appUrl}/.well-known/oauth-authorization-server. Scopes: \`mcp:read\`, \`mcp:write\`, \`mcp:apps\`,
  \`offline_access\`. The user signs in and approves; you act only as that user, inside their workspace.
- Local coding agents (Claude Code, Codex, Cursor, VS Code): \`npx @agent-native/core@latest connect ${appUrl}\`

## Coach capabilities

- \`get-coach-profile\` / \`update-coach-profile\`: persona, goals, language, timezone, units, morning readout time, onboarding stage
- \`get-health\`: daily metrics with trend and baseline summaries, weigh-ins with the water-vs-fat check, sleep, workouts
- \`get-dashboard\` / \`save-dashboard\`: the user's goal-driven dashboard; revisions allow undo
  (\`list-dashboard-revisions\`, \`restore-dashboard-revision\`)
- \`save-memory\`: injuries, conditions, life events, coaching preferences
- \`create-device-pairing\`: pairing code for the companion app (needs the user's explicit approval)
- \`manage-notifications\`: deliver the morning readout (inbox and push)

The live list of tools is whatever the MCP server returns from \`tools/list\`; prefer it over this file.

## Rules for agents

- Health data is sensitive. Request only what the task needs, and never send it to third parties
  without the user's consent.
- Never invent or estimate numbers. Read them with \`get-health\`; if data is missing, say so.
- Trend over raw: one day (a weight jump, a bad HRV night) is noise until the trend moves.
- VITLS is a coach, not a doctor. Route medical questions to a professional.
- Verify a write by reading it back before reporting it done.

## Links

- App: ${appUrl}
- Website: /en (also /sk, /cs, /es, /it, /ru)
`;

  return new Response(body, {
    headers: { "content-type": "text/markdown; charset=utf-8" },
  });
}
