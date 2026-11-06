# apps/web — backlog

State as of 2026-10-01: first version of the landing page in 6 locales, GSAP motion, liquid glass,
agent instructions at `/llms.txt`. Lint, typecheck and `next build` pass.

## To do

### Blocking launch

- [ ] **GLP-1 marketing is ahead of the product.** `/glp1`, the home section, hero chip, persona and
      goal market the GLP-1 module from `docs/design/06-nutrition.md` §7, which is plan 4 (not built yet).
      Ship it (or label it "coming") before paid campaigns. Copy follows the research guardrails: generic
      drug names first, brands only in FAQ #2 + trademark note, no dose advice, no "protects muscle", no
      prices/pharmacy/telehealth links, no pen imagery. **Legal review by a CZ lawyer who handles medicines
      advertising (zákon 40/1995 Sb., SÚKL UST-27) and MDR qualification is required before ads.**
      GDPR art. 9: medication and symptom data need explicit consent in the app's GLP-1 onboarding.

- [ ] **App agent card is empty.** `apps/app` serves `/.well-known/agent-card.json` as
      `"name": "App"`, `"skills": []`, so external agents can't discover what VITLS does over A2A.
      Give it a VITLS name, description and skills (coach readout, health reads, dashboard,
      profile). This is an `apps/app` change: it goes through the `agent-native-first` gate.
- [ ] **Translation review.** sk, cs, es, it, ru were written by the agent; get a native read,
      especially sk/cs (formal vs informal "ty" is used everywhere).
- [ ] **Domain DNS.** Vercel project `vitls-web` (team Finteractive, root `apps/web`) is live at
      https://vitls-web.vercel.app; `vitls.ai` and `www.vitls.ai` are added but wait for Namecheap DNS:
      `A @ 216.150.1.1`, `A @ 216.150.16.1`, `CNAME www 374af1c1e5f9f44e.vercel-dns-016.com.`
      (remove the parking records). Check with `vercel domains verify vitls.ai`.
- [ ] **Deploy the app at `https://app.vitls.ai`.** `NEXT_PUBLIC_APP_URL` already points there, so
      every CTA and the agent-card rewrite (502 today) fail until the app is live.
- [ ] **Git-based deploys.** Production was deployed from the CLI; run `vercel git connect` once
      `origin` (`amirmamaghani/VITLS`) has `main` pushed.
- [ ] **Legal review.** `/legal` (operator details of VERTISPACE s.r.o. from the ARES register + the
      website privacy notice, cs/sk/en; es/it/ru show English) was drafted by the agent from what the
      site actually does: one session language cookie, no analytics, Vercel hosting, Google Workspace
      email. Have a lawyer check it, and add the app's own privacy notice and terms before launch of the
      app. Update the notice whenever analytics, forms or embeds are added.
- [ ] **Search consoles (needs your accounts).** Verify vitls.ai in Google Search Console and Bing
      Webmaster Tools, submit `https://vitls.ai/sitemap.xml`, turn on IndexNow in Bing. Paste the
      verification codes into `metadata.verification` in `app/[locale]/layout.tsx`. Bing matters for AI
      search: ChatGPT's citations largely follow Bing results, and Bing's AI Performance report shows
      Copilot citations.
- [ ] **Off-site presence for AI citations.** Real profiles (LinkedIn, X, Instagram, YouTube) → add them
      to `sameAs` in `components/structured-data.tsx`; aim for "best AI health coach 2026" roundups and
      honest participation in r/Garmin, r/whoop, r/AppleWatchFitness, r/longevity.
- [ ] **FAQ facts to confirm.** Companion app availability for Apple Health (App Store?), photo food
      logging wording, and the neutral WHOOP/Oura comparison in FAQ #8 (comparative claims, EU rules).
- [ ] **Pricing in machine-readable form** (`/pricing.md`) once pricing is decided; AI agents skip
      products without parseable pricing.

- [ ] Higher-resolution clay renders: the current Gemini exports are 1024–1584 px, a bit soft on
      retina screens (the hero is shown up to 1152 css px wide). Re-export at 2048+ px and re-run the
      background match (see "Clay images" below).

- [ ] Early-access flow: every CTA links to the app root, which goes to sign-in. Decide whether
      the site needs its own waitlist or the app signup is the waitlist.
- [ ] Accessibility pass: contrast of `graphite` on `mist`, focus order through the pinned
      `#signal` scene, screen-reader text for the goal widgets.
- [ ] Performance pass: Lighthouse on mobile; measure the html2canvas snapshot cost on long pages
      and consider CSS-only glass (no WebGL) on low-end or small devices.
- [ ] Smoke tests (Playwright): each locale renders, `/` redirects by `Accept-Language`,
      `/llms.txt` returns markdown, `/.well-known/agent-card.json` proxies the app card.
- [ ] Decide `/cs` vs `/cz` for Czech (ISO code `cs` is used now).
- [ ] Privacy-friendly analytics, if any: decide before adding a cookie banner.

### Later

- [ ] More locales: add the code to `i18n/routing.ts`, a `messages/<code>.json`, and a name to
      `localeNames`. Non-Latin scripts need a font check (see the Russian note below).
- [ ] Generate `/llms.txt`'s capability list from the app (MCP `tools/list` or the actions
      registry) instead of the hand-written mirror.
- [ ] A visible "Use VITLS from your AI agent" section for humans (Claude/ChatGPT/MCP connect),
      once the agent card and MCP onboarding are polished.

## Watch out for

- **Motion and chat style (user rule).** Show the coach conversation as typography (ink question
  pill, large answer text), never as a framed chat widget; no elements sliding horizontally. Motion is
  radial or vertical: rings closing, bars rising, words rising, numbers counting.

- **Clay images must sit on the exact tile colour.** Gemini drifts from the requested hex, so the
  renders were post-processed: pixels close to the background colour are shifted to the tile token
  (subject untouched; `scripts/match-clay-bg.py`), and `ClayImage` feathers the image edges. Re-run
  the script for any new render, and save real PNGs (Gemini exports JPEG data with a .png name).
  `hero.png` is the exception: a tight cut-out with a transparent background (rendered with
  `feather={false}`) so the runner fills the hero stage; recreate it the same way if the render changes.

- **Liquid glass shows a snapshot, not live content.** The page is captured once, ~1.8 s after
  fonts load, and re-captured on resize. Keep the content under glass static at that moment: no
  hidden-until-scrolled reveals near the nav, and the hero intro must finish within 1.8 s. Don't
  add ScrollSmoother or other transform-based scrolling; it desyncs the glass. Without WebGL the
  CSS backdrop blur underneath is the fallback.
- **Snapshot size.** The snapshot is scaled down to the GPU's max texture size (often 4096 px on
  phones), so very long pages get a blurrier glass on mobile.
- **Images are detected at build time.** `ClayImage` checks `public/images/<slot>.png` with
  `existsSync` during render; static pages need a rebuild after adding images. The
  `public/images/...` label on placeholders only renders in development.
- **Russian typography.** Google Sans Flex has no Cyrillic; Russian falls back to Google Sans,
  max weight 700, so Russian headlines are bold, not Black.
- **Server/client boundary.** Plain constants imported from a `"use client"` module into a server
  component arrive as client references (this broke the footer once). Shared data lives in
  `i18n/routing.ts` or `lib/`.
- **`/llms.txt` mirrors `apps/app/AGENTS.md`.** When coach tools change, update it, or agents will
  be told about tools that no longer exist.
- **All numbers on the page are illustrative.** Goal widgets (`goals.tsx`), the live readout
  (`live-agent.tsx`), audience answers and long-term progress (`progress.tsx`) use sample values;
  numbers are locale-formatted but units (kg, kcal, bpm) are not translated.
- **Dev-only globals.** `lib/gsap.ts` puts `gsap`/`ScrollTrigger` on `window` in development
  for browser automation; never rely on it in app code.
- **Background-tab testing.** In a hidden Chrome tab, requestAnimationFrame stops, so GSAP and
  the glass freeze. Use headless Playwright for screenshots.
- **Concurrent sessions.** Other agents work in this repo at the same time; stage only your own
  files (never `git add -A`). Early web files landed inside unrelated `app/*` commits.
- **Font warnings.** `next build` warns "Failed to find font override values" for both Google Sans
  fonts; harmless (no metric-matched fallback font is generated).
