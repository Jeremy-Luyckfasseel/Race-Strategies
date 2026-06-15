# Landing page (Phase 4 — validation slice)

A **standalone, static** one-page site for the fake-door validation. Fully
decoupled from the strategy app — no build step, no imports from `src/`. Deploy it
independently.

## Files

- `index.html` — the page
- `styles.css` — styling (matches the app: dark base, racing-red accent, Barlow
  Condensed / Space Mono)
- `app.js` — i18n strings, the swappable `CONFIG` block, event tracking, and the
  fake-door / email handlers

## Owner TODO before going live (all in the `CONFIG` block at the top of `app.js`)

| Constant | What to set |
|----------|-------------|
| `BRAND` | The final product name. **PENDING** — currently the `Race Strategies` placeholder (see `docs/DECISIONS.md` "Product name"). |
| `PRICE` | The fake-door price (`€9.99`). |
| `DOWNLOAD_URL` | Link to the Windows installer (GitHub release / R2 / Pages asset from Phase 3). |
| `TALLY_URL` | Your Tally form URL — email capture → Google Sheet. When set, the email field hands off to Tally (prefilled). |
| `COLLECT_URL` | *(optional)* a Cloudflare Worker / webhook that logs `{event, detail}` if you want clicks in your own sink as well as analytics. |

Plus: paste your **Cloudflare Web Analytics** beacon token into the commented
`<script>` in `index.html` and uncomment it.

## How events are recorded (no silent console.log)

`track(event)` in `app.js`:

1. **Pushes a distinct URL hash** (`#/fake_door_click`, `#/email_submit`,
   `#/download_click`, …) so each action lands as its **own attributable entry in
   Cloudflare Web Analytics**.
2. If `COLLECT_URL` is set, `navigator.sendBeacon`s the event there too.

The season-pass button is a **fake door**: it records the click and opens an honest
"you're early — join the list" email state. **No checkout, no charge, no payment
code anywhere.**

## Deploy to Cloudflare Pages

This folder is plain static files — no framework build.

- **Dashboard:** Cloudflare Pages → Create project → Direct upload (or connect the
  repo) → set the **build output / root directory to `landing/`**, no build command.
- **Wrangler (CLI):**
  ```bash
  npx wrangler pages deploy landing --project-name <your-project>
  ```

Then add the **Web Analytics** site in the Cloudflare dashboard and paste its token
into `index.html` (above).

## Local preview

```bash
npx vite landing --port 5180     # or any static server, e.g. `npx serve landing`
```

## i18n

English is the source of truth (`STRINGS.en` in `app.js`). To add French / Dutch
later, add `STRINGS.fr` / `STRINGS.nl` objects and set `CONFIG.LANG` — no markup
changes (the page is driven by `data-i18n` attributes).
