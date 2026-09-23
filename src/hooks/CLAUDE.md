# src/hooks — guidance

Loaded when working under `src/hooks/`.

| File | Purpose |
|------|---------|
| `useTrackMap.js` | Records the circuit from **every connected car**, not one. Points dedup into a 3 m grid, so ten cars on the same line cost nothing over one — they only add cells where the lines differ, which gives the track its real width and completes it ~10× faster (the whole value of a lobby session before the race). Per-car recording state lives in `map.cars`; the grid, segments and bounds are shared, and each car extends **its own** segment — appending to whichever segment was last welds two cars' traces into one stroke. Only `strategyIp`'s pit entry fires `onPitEntry`. Covered by `tests/test_ui_trackmap_record.js` |
| `useStintLog.js` | Thin adapter over `stintLog.js`: opens a stint on pit exit (driver left `null` until `assignDriver(ip, driverId)` is called), closes it on the next pit entry, persists to `localStorage` (`gt7-stint-log`); returns `{ logs, pendingDriverIps, assignDriver, resetAll }`. A fresh log's first stint that "began" after the lap the car is on is dropped and reopened: after "Start race" the car's last lobby packet is still held, and without this the race's first stint opened at the lobby's lap number |
