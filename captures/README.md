# captures/

Recorded validation sessions land here as `session-YYYYMMDD-HHMMSS.json`, written
by `npm run record` (`scripts/record-session.js`).

These are **data, not source** — the `.json` files are git-ignored. Only this
README and `.gitkeep` are tracked. Run the comparison with:

```bash
npm run validate captures/session-YYYYMMDD-HHMMSS.json
```

See `docs/ENGINE_VALIDATION.md` for the full capture + comparison protocol.
