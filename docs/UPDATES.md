# Updates

Every install path (in-app updater, `npm run update`, `scripts/update.sh --apply`) ends in
`scripts/update.sh`. Its job is to make sure a failed, interrupted or corrupt update can never
leave a mirror that won't boot.

## Flow

| Step                 | What happens                                                                                                                                                                                                                                                              | If it fails                                                                |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| 1. Download          | The backend (`services/updater.ts`) or `--apply` fetches `skyglass-vX.Y.Z.tar.gz` and its `.sha256`                                                                                                                                                                       | Nothing changed. `--apply` refuses to continue if no checksum is published |
| 2. Verify            | `--sha256 <hex>` is checked with `sha256sum` or `shasum -a 256`                                                                                                                                                                                                           | Refused; nothing touched                                                   |
| 3. Stage + preflight | Extract to `.update-stage/`. The tree must contain `package.json`, `packages/backend/dist/server.js`, `packages/frontend/dist/index.html` and `config/pm2.config.cjs`. Free space must be at least 2× the staged size + 200 MB                                            | Refused; services never stopped                                            |
| 4. Backup            | Code is copied with rsync to `.backup/` (runtime state excluded). `.backup/.backup-complete` records the old version                                                                                                                                                      | Refused                                                                    |
| 5. Snapshot          | Only when `package-lock.json` or `requirements.txt` changed: hardlink copies (`cp -al`, or `cp -a` where hardlinks don't work) of every `node_modules` and of the venv go into `.update-snapshot/`                                                                        | Refused                                                                    |
| 6. Apply             | `.update-state` is written, services stop, files are rsynced over the install, and `VERSION` is written atomically. `npm install` runs only if the lockfile changed (timeout `SKYGLASS_NPM_TIMEOUT`, default 30 min). `pip install` runs only if the requirements changed | Rollback                                                                   |
| 7. Stability check   | `pm2 startOrRestart`. `/api/health` must answer and `/` must serve HTML, on 6 consecutive checks 5 s apart (within 120 s of the first)                                                                                                                                    | Rollback (this also catches crash loops)                                   |
| 8. Done              | `.update-state` is removed, then the lock                                                                                                                                                                                                                                 | —                                                                          |

**Rollback** stops the services and restores the code from `.backup/` (`rsync --delete`, which also
removes files the update added). It then moves the `node_modules` and venv snapshots back into
place by rename, so it needs no network. Finally it always restarts the services and logs
`Rolled back to vX` or `ROLLBACK FAILED: …` in `logs/update.log`. Rollback is idempotent: running it
again after a partial rollback ends in the same place. SIGTERM, SIGINT and SIGHUP during step 6 or
7 trigger a rollback too.

Runtime state is never copied, backed up, restored or deleted: `data/`, `logs/`,
`config/config.yaml`, `face_data/`, `node_modules/`, `venv/`, `.env*` and the updater's own files.
See `UPDATE_EXCLUDES` in `scripts/update.sh`.

## State and lock files

| File                | Meaning                                                                                                                                                                                                                                                                                                                 |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.update-lock/pid`  | The PID (bare decimal) of the running `update.sh`, held for a whole apply or a whole `--recover`. A second update is refused while that process is alive. A lock whose PID is dead, or isn't an `update.sh` process, is taken over                                                                                      |
| `.update-state`     | `key=value` (`phase`, `version`, `from`, `pid`, `started`, `attempts`, and `kind`/`node_from` for a Node.js upgrade). It exists from just before the services stop until the update has succeeded or been rolled back. If it exists and no `update.sh` holds the lock, the update was interrupted (power loss, SIGKILL) |
| `.backup/`          | The previous version's code. Kept after success, for manual rollback                                                                                                                                                                                                                                                    |
| `.update-snapshot/` | `node_modules` and venv snapshots. Removed on success or after a completed rollback                                                                                                                                                                                                                                     |

## Recovery: `update.sh --recover`

- If there is no `.update-state`, it exits 0 immediately.
- If another live `update.sh` holds the lock, it refuses (exit 1).
- Otherwise it takes the lock and rolls back as described above, offline. It exits 0 when the old version was restored.
- If the backup is missing, it says so and still starts the services. After 3 failed attempts (`attempts=` in the state file) it clears the state, so the services don't loop.

It runs automatically:

- **At boot.** `scripts/boot-mode.sh` (skyglass-boot.service, as root) runs it as the install user before it starts the PM2 apps or provisioning. PM2's resurrect unit may already have started the apps on the half-installed tree; `--recover` stops them first.
- **From the watchdog.** While `.update-lock/pid` names a live process, or `.update-state` exists, `watchdog_service.py` does not restart PM2 apps. If `.update-state` has had no live lock holder for more than 60 s, the watchdog runs `update.sh --recover` as the PM2 user.
- **On the next update.** If `.update-state` is found, that update recovers first and then exits so it can be retried.

## Node.js upgrades

The mirror runs the Node.js major in the root `package.json` `engines` (24; `.nvmrc` matches, and
`scripts/setup-pi.sh` installs it from NodeSource). Moving an installed mirror to a newer major is
an update of its own:

- `scripts/update.sh --upgrade-node [MAJOR]` (default: the `engines` minimum), or automatically when
  a release's `package.json` needs a newer major than the one installed: Node.js is upgraded first,
  health-checked on the current release, and then the release installs.
- It snapshots `node_modules`, records `.update-state` (`kind=node`, `node_from=<old major>`), stops
  the services, installs the major from NodeSource (`sudo -n`, apt), runs `npm rebuild` for native
  modules (`better-sqlite3`), refreshes the PM2 daemon (`pm2 update`) and requires the usual stable
  health check.
- On failure, a signal, or `--recover` after a crash, it reinstalls the previous major and puts the
  `node_modules` snapshot back. Reinstalling needs the network; if it fails, `.update-state` stays
  and the boot and watchdog `--recover` runs retry it later.

Upgrade Node.js in its own release (bump `engines`, nothing else), so a problem is clearly the
runtime and not the code.

## Tuning (env)

`SKYGLASS_HEALTH_URL`, `SKYGLASS_UI_URL` (default: `/` on the same host),
`SKYGLASS_HEALTH_TIMEOUT` (120), `SKYGLASS_HEALTH_INTERVAL` (5), `SKYGLASS_HEALTH_STABLE_CHECKS` (6),
`SKYGLASS_NPM_TIMEOUT` / `SKYGLASS_PIP_TIMEOUT` (1800), `SKYGLASS_UPDATE_DISK_MARGIN_MB` (200),
`SKYGLASS_MAX_RECOVER_ATTEMPTS` (3), `SKYGLASS_NODE_INSTALLER` (command that installs the Node.js
major given as its argument; tests only). Without `pm2` installed (a dev machine) the health check is
skipped with a warning.

## Failure tests

```bash
npm run test:update     # node --test scripts/tests/*.test.mjs (~15 s, also runs in CI)
```

Each test builds a fake install and release tarballs in a temp dir and puts stub `pm2`, `npm` and
`curl`, `node` and a Node.js installer first on `PATH` (`scripts/tests/lib/world.mjs`). The scenarios cover:

- the happy paths (lockfile unchanged or changed, and `--apply` with a checksum)
- corrupt, truncated and incomplete tarballs, a checksum mismatch, a missing checksum, and low disk space
- a network drop or hang during `npm install`, health that never comes up, a crash loop, the UI returning 500, and pm2 failing to start
- SIGTERM, SIGKILL followed by `--recover`, and lock contention
- interrupted rollbacks and a missing backup
- Node.js upgrades: success, already current, a failed rebuild, an unhealthy new runtime, an offline
  rollback finished later by `--recover`, SIGKILL right after the switch, and a release that needs a
  newer Node.js (upgraded first, or not installed when that upgrade fails)

The tests run on macOS (bash 3.2, openrsync, BSD tools) and on Linux.

## Limits

- Snapshots are hardlinks. They protect against npm and pip, which replace files rather than rewriting them in place, but not against a tool that edits an existing file in place.
- `--recover` runs the `scripts/update.sh` currently on disk, which may already be the new version's. Every version from this one on supports `--recover`.
- A failing SD card, or a filesystem corrupted by power loss, is outside what the script can repair.
