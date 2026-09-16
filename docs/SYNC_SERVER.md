# SYNC_SERVER.md — optional team file-sharing server (v2)

> The self-hosted way to share recorded sessions across a team without a shared
> Dropbox/Drive folder. Each driver records at home and **uploads** their capture
> to the team **GROUP**; the strategist **fetches** a race's captures in the app.
> This is the deferred **v2** — the local folder import still works with no server.
> Tiny footprint: ~zero dependencies, captures are small JSON files.

## What it is

- `server/sync-store.js` — filesystem store (pure Node, no deps), node-tested.
- `server/sync-server.js` — minimal Node HTTP API over it (no deps).
- **No accounts.** A group is identified by a random **join code** that doubles as
  the access secret. **Multi-team:** every team is an isolated group — many codes,
  no rework.

Data layout (under `DATA_DIR`):
```
<code>/group.json
<code>/<raceId>/race.json
<code>/<raceId>/s_<driver>.json     # one current session per driver (re-upload overwrites)
```

## API

| Method + path | Body | Returns |
|---|---|---|
| `GET /api/health` | | `{ ok: true }` |
| `POST /api/groups` | `{ name }` | `{ code, name }` |
| `GET /api/groups/:code` | | `{ code, name }` |
| `POST /api/groups/:code/races` | `{ name }` | `{ id, name }` |
| `GET /api/groups/:code/races` | | `[ races ]` |
| `POST /api/groups/:code/races/:raceId/sessions` | `{ driver, capture }` | `{ sessionId }` |
| `GET /api/groups/:code/races/:raceId/sessions` | | `[ { driver, capture, uploadedAt } ]` |

`code` / `raceId` are validated against a strict token pattern (no path traversal);
uploads are capped (`MAX_BODY`, default 2 MB) and must contain a `laps` array.

## Run it locally

```bash
npm run sync                 # PORT=8787  DATA_DIR=./sync-data  (defaults)
curl localhost:8787/api/health
```

Config via env: `PORT`, `DATA_DIR`, `MAX_BODY` (bytes/upload), `CORS_ORIGIN`
(default `*`), `RATE_MAX` (requests/IP/min, default 240), `MAX_GROUPS` (cap on
total groups, default 1000).

## Deploy on a small VPS (e.g. Hetzner €5)

It will sit happily alongside your other services — one new port, one process, a
few MB of data. It does **not** touch your existing apps.

1. **Copy the code** (just `server/` + `package.json`) and make sure Node ≥ 20 is
   installed. No `npm install` is needed — the server has zero dependencies.

2. **Run it as a dedicated service** with `systemd` (its own user + data dir):
   ```ini
   # /etc/systemd/system/gt7-sync.service
   [Unit]
   Description=GT7 team sync
   After=network.target
   [Service]
   ExecStart=/usr/bin/node /opt/gt7-sync/server/sync-server.js
   Environment=PORT=8787
   Environment=DATA_DIR=/var/lib/gt7-sync
   User=gt7sync
   Restart=always
   [Install]
   WantedBy=multi-user.target
   ```
   ```bash
   sudo useradd -r -s /usr/sbin/nologin gt7sync
   sudo mkdir -p /var/lib/gt7-sync && sudo chown gt7sync /var/lib/gt7-sync
   sudo systemctl enable --now gt7-sync
   ```

3. **HTTPS — pick one:**
   - **Domain + Caddy (recommended for real use):** point a (cheap) domain at the
     VPS, then a 3-line Caddyfile reverse-proxies it with automatic Let's Encrypt:
     ```
     sync.yourteam.example {
       reverse_proxy localhost:8787
     }
     ```
     The app/recorder then use `https://sync.yourteam.example`.
   - **Plain IP (early testing only):** open the port in the firewall and use
     `http://<vps-ip>:8787`. Fine for testing on your own machine; browsers will
     warn about non-HTTPS, and the desktop app should use TLS before real use.

4. **Firewall:** allow the chosen port (and 80/443 if using Caddy).

## Security notes (lightweight, but real)

- The **join code is the secret** — anyone with it can read/write that group. Treat
  it like a shared password; rotate by making a new group if it leaks.
- Body size is capped; only JSON with a `laps` array is accepted; bad codes 404.
- **Rate limiting is built in** (`RATE_MAX` requests/IP/min → HTTP 429) and **group
  creation is capped** (`MAX_GROUPS`) so a flood can't fill the disk. Tune both via env.
- Run it as the **dedicated unprivileged user** above so a compromise can't reach
  your other services. Pair with the domain/TLS below.
- Back up `DATA_DIR` if you care about keeping past races.

## Status

This is the **server**. The app/recorder integration — recorder `--server/--group`
upload on stop, and a TeamPanel "connect to group" fetch — is the next step; until
then, use the local folder/file import in the Team panel.
