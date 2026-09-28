# Accepted security advisories

Each entry has an owner decision and an expiry date. Re-check on or before the
expiry; remove the entry when the advisory no longer appears in
`npm audit --omit=dev`.

| Advisory | Package path | Why accepted | Expires |
|---|---|---|---|
| GHSA-w5hq-g745-h8pq (uuid < 11.1.1, missing buffer bounds check in v3/v5/v6 when `buf` is passed) | `sequelize → uuid@8`, `gaxios → uuid@9` | The app never calls uuid's v3/v5/v6 with a caller-supplied buffer. `npm audit fix --force` would downgrade Sequelize to an incompatible major. An `overrides` entry for uuid 11 is possible but must be tested against Sequelize first. | 2026-12-31 |

CI runs `npm audit --omit=dev --audit-level=high`, so these moderate
advisories do not fail the build; anything high or critical does.

## Firebase Web SDK (not covered by npm audit)

The browser loads the Firebase JS SDK 10.14.1 from `www.gstatic.com`
(`public/js/auth/app.js`, `public/js/account/app.js`, pinned in the CSP). Check the
Firebase JS SDK release notes for security fixes every quarter, and upgrade
the pinned version in all three places together. Next check: 2026-12-31.
