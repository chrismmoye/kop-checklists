# 🍭 King of Pops · Ops Checklists (v3)

A Jolt-style operations platform with King of Pops branding. Checklists auto-populate from the Square schedule, overdue tasks alert notifiers by push notification, and the dashboard shows which carts are open and closed.

## User levels

- **👑 Admin** — full control. Can opt in as a notifier on any location.
- **🧭 Manager** — runs one or more territories: dashboards + Reports (company-wide view available), edits checklists (can't create/delete them), adds/manages Slingers, auto-alerted for overdue checklists in their territories. Can't touch locations/territories or Square settings.
- **🍭 Slinger** — their checklists, schedule, clock in/out, and chat.

## Reports

📈 Reports (managers + admins): presets for **Today / This week / This month / Custom**, three views — **By checklist**, **By team member**, **By territory** — each with a real completion rate (done ÷ expected), plus filters by checklist/territory — completion rates by checklist and by person, flagged answers with drill-down, and **Export CSV** (one row per answer) for feeding other systems. The same data is available programmatically at `GET /api/reports` (JSON) and `GET /api/reports/export.csv` — authenticate with an admin session cookie from `POST /api/login`.

Everyone can use **⚡ Pick up a shift** (My checklists tab) when they work a shift that isn't in the schedule — it spawns their opening checklist immediately and the closing checklist 30 minutes before the end time they enter.

## Territories

Create territories in the Carts tab and assign each cart to one. Assign a Manager to a territory in the Team tab (edit their profile). Each territory automatically gets its own chat channel. Overdue alerts go to: the cart's extra notifiers + the territory's managers (admins as fallback if nobody is set).

## Chat

💬 Chat for all levels: **#general**, **#Bar**, **#Retail Ops**, **#Catering Ops**, **#Outpost Ops**, and **#Leadership** (managers + admins only 🔒), plus private DMs. Admins can add/rename/delete channels. Attach photos or files with 📎. DMs trigger an alert + push notification.

## Signing in

- **Password**: everyone can change their own via ☰ menu → 🔑 Change my password.
- **Email link (passwordless)**: on the login screen, "Email me a sign-in link" sends a one-time link valid 15 minutes. Set this up once: Schedule → **✉️ Email sign-in setup** → paste a [Resend](https://resend.com) API key (free tier is plenty) and a verified From address.

## Opportunities

✨ Opportunities (everyone): three boards — 🎪 Events & Festivals, ⭐ Flagship Spots, 💼 Open Roles — each posting showing when/where/requirements with an **Apply** button. Team members can also **🤝 Refer a friend** and **💡 Suggest a spot**. Managers and admins post opportunities and get an inbox of applications, referrals, and suggestions; accepting or declining notifies the applicant automatically.

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
5. The **Dashboard** lists every spot in one box with a status light — 🟢 blinking = open now · 🟢 solid = closed with all checklists complete · 🟡 = clocked out but checklists missing · 🔴 = scheduled but never opened · ⚪ = no shift today. It also lists every spot with its status — 🟢 Open · ⚫ Closed · 🟡 Not opened yet · 🔴 Needs attention · ⚪ No shift today — sorted so problems float to the top. Tap any spot to see who is working it, their clock-in times, each checklist with answers, and the day's setup photos.

## Connecting Square

1. Go to [developer.squareup.com](https://developer.squareup.com) → sign in with your Square account → create an app (call it "KOP Checklists") → copy the **Production Access Token**.
2. Paste it in the **Schedule tab → Square connection → Save token**, then **Sync now**.
3. Matching rules:
   - **People**: Square team members are matched to app users **by email** — make sure each teammate's email in the Team tab matches their Square email.
   - **Carts**: put the cart's name in the **shift notes** in Square (e.g., "Piedmont Park"). The cart name in the Carts tab must match. Unmatched shifts show a ❓ in the Schedule tab.
4. Shifts re-sync automatically every 10 minutes (published, assigned shifts only).

## Spots, territories & shift matching

- A **territory** = a Square location (people clock into it in Square). Link them in Spots → each territory row → ⬛ Link Square.
- A **spot** = the physical place a cart works (e.g. "Piedmont Park — 12th Street"). Spots belong to a territory.
- Shifts map to a spot by scanning the Square shift notes for the spot's name, any part of its name after a dash (so "Piedmont Park — Active Oval" matches a note saying just "Active Oval"), or a learned **keyword**. Add keywords when editing a spot, or teach one on the fly: open a shift → set the spot → pick the note phrase to remember. Use **🧠 Re-match shifts** in Spots to re-run matching over unmatched shifts.

## Flavor strategy

🍦 Flavors (managers + admins): each flavor has a **profile** (Fruity / Creamy), **availability** (Full-time / Part-time), **pricing** (Everyday $4 / Extra-Special $5), and in-stock status. Assign a flavor to whole **spot categories** right from the flavor form (fastest), or to individual spots when editing a spot — a spot's pack list merges both. The strategy board appears on the dashboard under Announcements, and slingers see their **Flavors to pack** card when they're on a shift at that spot.

## Flagged answers

Every checklist question can be set to flag an answer for review — in the builder, each item has a **⚑ flag rule**: never flag, the automatic rule for its type (number outside its OK range, a "No" answer, an unchecked box), or **specific answers** you list (e.g. flag `Needs repair, Okay`). The dashboard's "Flagged answers" stat is clickable and shows each flag with the question, the answer, who submitted it, the spot, the shift time, and the expected range — tap through to the full checklist.

## Wasted pops

Everyone can log waste from the ☰ menu → **🗑️ Log wasted pops** (also at the bottom of the checklist screen): how many, and why (Melted / Expired / Opened). Admins get a **Waste Log** view in Reports with total pops wasted, top waster, top reason, breakdowns by reason and spot, and every entry with date, time, person, count, reason, and spot.

## View as (admins)

☰ menu → **👁️ View app as…** → Manager or Slinger. The whole app — menus, permissions, API access — behaves exactly as that level, so you can check the team's experience without a dummy account. A black banner across the top shows you're previewing; tap "back to admin" to exit. Your real account stays admin, and preview can only downgrade, never escalate.

## HQ (or any team-specific) checklists

Create a spot for **HQ**, then build a daily checklist scoped to it and use **👥 Assign to specific people** in the builder to pick your ops leads. Assigned people get it every day regardless of role or home spot; nobody else sees it. This works for shift-triggered checklists too.

## Exporting checklists

Checklists menu → **⬇️ Export (readable)** gives a Markdown outline that shows the full logic tree — each conditional question nested under the answer that triggers it, with OK ranges, options, and flag rules. **⬇️ Export (JSON)** gives the machine-readable definition (`show_if` + `flag_rule` per item) for handing to another system. The ⬇️ on any single checklist row exports just that one. Both are available at `GET /api/checklists/export.md` and `GET /api/checklists/export.json` (add `?id=` for one).

## Profile photos

Anyone can tap their avatar in the ☰ menu to upload a photo of themselves; it replaces the placeholder in the menu, the team list, and DM lists.

## Populating checklists manually

- Anyone: **➕ Add a checklist** on My checklists — limited to checklists for their job role (or role-agnostic ones).
- Managers/admins: **📋 Assign checklist** on the Dashboard to push one to a specific teammate (they get a notification).

## Fresh start

Admins can wipe checklist history for a clean completion rate: Schedule → **🧹 Clear checklist history** (clears submissions + populated checklists only; users, checklists, spots, shifts and chat are untouched).

## Structure

- **Spots** (Spots menu) are grouped into categories: Everyday Carts, Extra Special Carts, Catering Carts, Brick & Mortar (edit/add as you like). Each cart has **notifiers** — the people alerted when its checklists go overdue.
- **Checklists** have a trigger: ☀️ Opening (start of shift), 🌙 Closing (30 min before end), or 📅 Daily (fixed schedule, like kitchen sanitation). Scope any checklist to a specific cart, a category, or a role.
- Item types: checkbox, yes/no, multiple choice, number (with OK-range + unit — out-of-range answers get flagged ⚑), text, photo.
- **If/then branching**: any item can be set to show only when an earlier answer matches a condition — `is` / `is not` for choice, yes/no and checkbox, and `is below / at most / above / at least / equals / is not` for numbers. Example: *Freezer temperature* → if above 0°F, show *What did you find?* → if that's *Unit failure*, show *Photo of the unit*. Conditions chain as deep as you like; hidden questions aren't required and are recorded as skipped.

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
