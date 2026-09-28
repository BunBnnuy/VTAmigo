# Project notes

## Frontend visual design

`frontend/DESIGN.md` is the source of truth for colors, fonts, and window
chrome (buttons, inputs, toggles, titlebars). Read it before making any
visual change to `frontend/src/**`, and keep it in sync if a design
decision changes — component styles should reference the CSS custom
properties defined in `frontend/src/index.css` rather than hardcoding hex
values.

## Environments and promotion workflow

The app runs as three instances of this repo on one VPS. Work moves
**Fast → Dev → Master**; each tier has one job.

| Tier | Checkout | Branch | URL | Job |
|---|---|---|---|---|
| **Fast** | `/opt/vtamigo-fast` (`:3003`) | `dev` | https://fast.vtamigo.top | Edit files and see them live. **Never commit here** — it absorbs the dozens of tiny edits so history stays clean. |
| **Dev** | `/opt/vtamigo-dev` (`:3002`) | `dev` | https://dev.vtamigo.top | Test a change set as a whole. Push the finished work to `origin/dev`; CI runs, then `deploy-dev.yml` pulls and builds it here. |
| **Master** | `/opt/vtamigo` (`:3001`) | `master` | https://vtamigo.top | Production. Once Dev confirms the change, squash `dev` into `master` and push; `deploy.yml` ships it. |

Promotion:

```bash
# Fast: edit /opt/vtamigo-fast in place; nothing to commit while iterating.

# Dev: promote the whole change set once it's ready.
cd /opt/vtamigo-fast
git add -A && git commit -m "<summary>"
git fetch origin && git merge --ff-only origin/dev   # stay current before pushing
git push origin dev                                  # CI -> deploy-dev.yml -> dev.vtamigo.top

# Master: release after Dev is confirmed. Use a scratch worktree so the Fast
# checkout stays on dev.
git worktree add /tmp/vtamigo-release origin/master
cd /tmp/vtamigo-release
git merge --squash origin/dev
git commit -m "Release: <summary>"
git push origin HEAD:master                          # deploy.yml -> vtamigo.top
cd /opt/vtamigo-fast && git worktree remove /tmp/vtamigo-release
```

Notes:

- There is no `main` branch; `master` is production.
- On this box `ubuntu` holds the read/write deploy key at
  `~/.ssh/vtamigo_deploy_key_rw` (SSH alias `github-vtamigo`) and commits as
  `BunBnnuy <saratoga.yuu@gmail.com>`.
- Fast's code is owned by `ubuntu` (so it can be edited in place); its runtime
  state (`backend/data`, `backend/memories`) stays owned by the `vtamigo`
  service user.
