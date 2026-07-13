# 🍭 King of Pops · Ops Checklists (v3)

A Jolt-style operations platform with King of Pops branding. Checklists auto-populate from the Square schedule, overdue tasks alert notifiers by push notification, and the dashboard shows which carts are open and closed.

## User levels

- **👑 Admin** — full control. Can opt in as a notifier on any cart.
- **🧭 Manager** — runs a territory: views dashboards/completed checklists (defaults to their territory, can see company-wide), adds/manages Slingers, and is automatically alerted when checklists in their territory go overdue. Can't edit checklists, carts, or Square settings.
- **🍭 Slinger** — sees only their checklists to complete, plus chat.

Everyone can use **⚡ Pick up a shift** (My checklists tab) when they work a shift that isn't in the schedule — it spawns their opening checklist immediately and the closing checklist 30 minutes before the end time they enter.

## Territories

Create territories in the Carts tab and assign each cart to one. Assign a Manager to a territory in the Team tab (edit their profile). Each territory automatically gets its own chat channel. Overdue alerts go to: the cart's extra notifiers + the territory's managers (admins as fallback if nobody is set).

## Chat

💬 Chat tab for all levels: **#general** for everyone, a channel per territory, and private DMs (+ DM button). Attach photos or files with 📎. DMs trigger an alert + push notification for the recipient.

**Zero dependencies** — pure Node.js. No `npm install`, no database server.

## Run it

Requires [Node.js 18+](https://nodejs.org).

```bash
node server.js
```

Open http://localhost:3000 — admin login: **chris.moye@kingofpops.com / popsicle1** (⚠️ change it in the Team tab).

## How the shift flow works

1. **Shifts** come from Square (or manual entry in the Schedule tab).
2. When a shift **starts**, the worker's ☀️ **Opening checklist** pops up on their phone.
3. **30 minutes before shift end**, the 🌙 **Closing checklist** appears.
4. Each checklist is due **1 hour after it appears**. After that it's **overdue** and every **notifier** for that cart gets an in-app alert + phone push notification.
5. The **Dashboard** shows a live cart board: 🟢 Open · ⚫ Closed · 🟡 Not opened yet · 🔴 Overdue — plus every checklist's status and answers.

## Connecting Square

1. Go to [developer.squareup.com](https://developer.squareup.com) → sign in with your Square account → create an app (call it "KOP Checklists") → copy the **Production Access Token**.
2. Paste it in the **Schedule tab → Square connection → Save token**, then **Sync now**.
3. Matching rules:
   - **People**: Square team members are matched to app users **by email** — make sure each teammate's email in the Team tab matches their Square email.
   - **Carts**: put the cart's name in the **shift notes** in Square (e.g., "Piedmont Park"). The cart name in the Carts tab must match. Unmatched shifts show a ❓ in the Schedule tab.
4. Shifts re-sync automatically every 10 minutes (published, assigned shifts only).

## Structure

- **Carts & Spots** (Carts tab) are grouped into categories: Everyday Carts, Extra Special Carts, Catering Carts, Brick & Mortar (edit/add as you like). Each cart has **notifiers** — the people alerted when its checklists go overdue.
- **Checklists** have a trigger: ☀️ Opening (start of shift), 🌙 Closing (30 min before end), or 📅 Daily (fixed schedule, like kitchen sanitation). Scope any checklist to a specific cart, a category, or a role.
- Item types: checkbox, yes/no, number (with OK-range + unit — out-of-range answers get flagged ⚑), text, photo.

## Push notifications on phones

Each notifier taps the 🔔 bell → **Enable push on this device**.

- **Android / desktop Chrome**: works immediately.
- **iPhone**: first add the app to the Home Screen (Share → Add to Home Screen), open it from there, then enable push. Requires iOS 16.4+. Push also requires the site to be served over **HTTPS** (any host below provides this; plain `localhost` also works for testing).

## Data & backups

Everything lives in the `data/` folder: `db.json` (all records) and `uploads/` (photos). **Backup = copy that folder.** Delete it to start fresh (reseeds samples).

## Deploying for the team

Any Node host with a persistent disk:

**Render / Railway**
1. Push this folder to a GitHub repo.
2. New Web Service → build command: *(none)* → start command: `node server.js`.
3. Attach a persistent disk and set env var `DATA_DIR` to its mount path (e.g. `/data`).
4. HTTPS is automatic — required for push notifications.

### Environment variables (optional)

| Var | Default | Purpose |
|---|---|---|
| `PORT` | 3000 | Port |
| `DATA_DIR` | `./data` | Data + photo storage |
| `TZ_NAME` | `America/New_York` | Business-day timezone |
| `SESSION_SECRET` | auto | Cookie signing secret |

## Sample logins

| Who | Email | Password |
|---|---|---|
| Admin | chris.moye@kingofpops.com | popsicle1 |
| Cart operator | maya@kingofpops.com | pops1234 |
| Cart operator | jordan@kingofpops.com | pops1234 |
| Kitchen | sam@kingofpops.com | pops1234 |

Delete the samples before real use. Deleting users/carts/checklists deactivates them — history is preserved.
