# apps/web — vitls.ai marketing site

Next.js (App Router) + next-intl + GSAP + a liquid-glass port. Scaffolded with `create-next-app`.

```bash
pnpm web            # from the repo root, http://localhost:3000
pnpm --filter @vitls/web typecheck
```

`NEXT_PUBLIC_APP_URL` points every "Get early access" button, `/llms.txt` and the agent-card rewrite at
the VITLS app (default `http://localhost:8081`, i.e. `apps/app` in dev).

Open work and known pitfalls: [BACKLOG.md](BACKLOG.md).

## Layout

| Path | What |
| --- | --- |
| `app/[locale]/` | The single landing page; `proxy.ts` negotiates the locale and redirects `/` |
| `messages/*.json` | Copy per locale. `en.json` is the source and types the keys (`global.d.ts`) |
| `components/` | One file per section; `*-motion.tsx` / client components hold the GSAP code |
| `components/liquid-glass.tsx` | WebGL glass from dashersw/liquid-glass-js (MIT), see header comment for limits |
| `components/clay-image.tsx` | Image slot: drop `public/images/<slot>.png` and it replaces the placeholder |
| `app/llms.txt/route.ts` | Agent instructions: A2A + MCP access to the VITLS app |

## Design rules

- Type: Google Sans Flex (variable, up to 1000) with the `ROND` axis at 100 on headlines so they echo
  the clay renders. Russian falls back to Google Sans (Cyrillic, max 700).
- Colour: white paper, one ink (`#202124`), clay pastels (`sage`, `peach`, `lilac`, `sky`, `butter`) as
  stage backgrounds — tokens live in `app/globals.css`.
- Motion: one orchestrated hero intro, one scroll-scrubbed scene (`#signal`), and motion that answers
  clicks (goal composer via Flip, coach picker). Everything respects `prefers-reduced-motion`.
- Liquid glass refracts a snapshot of the page taken ~1.8 s after load, so keep content under glass
  surfaces static at that moment (no hidden-until-scrolled reveals behind the nav), and don't add
  ScrollSmoother — transformed scrolling desyncs the glass.

## Clay images (Gemini)

PNG, transparent or matching background, ideally 2048 px on the long side. Shared style suffix for
every prompt:

> soft clay 3D render, matte plasticine texture, rounded chunky shapes, gentle studio lighting, soft
> contact shadow, pastel palette, minimal composition, centered, plain background `<hex>`, no text

| File | Background | Subject |
| --- | --- | --- |
| `hero.png` (16:9) | `#d7e6ff` | A runner figure mid-stride next to an oversized smartwatch showing a heart-rate line |
| `nutrition.png` (1:1) | `#ffe2d1` | A plate with salmon, rice and greens, a phone camera hovering above |
| `training.png` (21:9) | `#d7e6ff` | A dumbbell, a running shoe and a kettlebell arranged in a row |
| `recovery.png` (4:3) | `#e7e0fa` | A crescent moon on a pillow with a calm heart-rate wave |
| `body.png` (4:3) | `#fff0c2` | A bathroom scale with a measuring tape curled around it |
| `coach-strict.png` (1:1) | `#ffe2d1` | Coach character with a whistle and crossed arms, determined |
| `coach-scientist.png` (1:1) | `#d7e6ff` | Coach character with round glasses holding a small chart |
| `coach-supportive.png` (1:1) | `#d9eedf` | Coach character smiling with a thumbs-up |
| `coach-longevity.png` (1:1) | `#e7e0fa` | Calm older coach character with a small bonsai tree |
| `cta.png` (1:1) | `#d9eedf` | A phone showing a chat bubble, a small runner figure waving next to it |
