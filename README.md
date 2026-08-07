# AVNIDEEP CRM PRO — Telecaller CRM

Offline-first e-commerce COD CRM built with React + Vite + TypeScript. Works 100% offline (Dexie/IndexedDB) with optional online multi-user sync via **Cloudflare D1 + Workers** (see `D1_MIGRATION_GUIDE.md`). Also ships as a Windows desktop app (Electron).

## 🌟 Features

- 🔐 **Phone + PIN Login** — Admin & Telecaller roles
- 📞 **Telecaller Module** — 10+ telecallers, individual logins, per-telecaller lead isolation (never see others' leads)
- 🎯 **Lead Assignment** — single / bulk (50–500) / reassign / remove — no duplicate assignments
- 📋 **16 Lead Statuses** — New Lead → Assigned → Calling → Interested → Follow-up → Order Confirmed → Delivered / RTO / Closed
- 📝 **Call Logging** — full call history per lead, notes never overwritten (append-only)
- ⏰ **Follow-up System** — date/time/reminder/reason + missed follow-up alerts
- 📊 **Dashboards** — Admin (new/unassigned, today's calls/confirmed/cancelled, follow-ups due, top telecallers, conversion rate) & Telecaller (my assigned, today's calls, conversion %, pending follow-ups)
- 🏆 **Performance Reports** — assigned / calls done / confirmed / cancelled / conversion % / avg response time per telecaller
- 🔍 **Filters & Search** — by telecaller, state, status, date, product; search by name, mobile, order ID
- 🔔 **Smart Notifications** — lead pending, follow-up pending, telecaller inactive
- 📦 **Orders Pipeline** — Packing → Packed → Ready To Ship → Shipped → In Transit → Out For Delivery → Delivered / RTO / NDR
- ☁️ **Online Sync (optional)** — bidirectional Dexie ↔ Cloudflare D1 sync via Worker API (30s polling; Realtime replaced) — see `D1_MIGRATION_GUIDE.md`
- 🖥️ **Electron desktop build** — see `ELECTRON_BUILD_INSTRUCTIONS.md`

## 🚀 Live Demo

Deployed on GitHub Pages: **https://ayurvedaavni-a11y.github.io/Avnideepcrm/**

> Note: the browser version stores data in your browser's IndexedDB (offline-first). For shared multi-user data, enable the Cloudflare D1 online mode (set `VITE_API_URL` in `.env`).

## 🛠️ Local Development

```bash
npm install
npm run dev        # http://localhost:5173
```

## 📦 Production Build

```bash
npm run build      # outputs to dist/
npm run dist       # Windows Electron installer
npm run dist:portable
```

## ☁️ Online Multi-User Setup (Cloudflare D1)

1. Deploy the Worker + D1 database (see `worker/` + `D1_MIGRATION_GUIDE.md`)
2. Copy `.env.example` → `.env` and set `VITE_API_URL=https://avnideep-crm-api.ayurvedaavni.workers.dev`
3. `npm run build` — the app syncs Dexie ↔ Cloudflare D1 automatically (every 30s)

Full guide: `D1_MIGRATION_GUIDE.md`

## 🧪 Stress Testing

In the app: **Settings → Run Tests → "📞 Telecaller CRM Stress Test"**
Verifies 10 telecallers × 100 / 500 / 1000 leads — no duplicate assignments, no missing leads, no permission leaks.

## 📁 Key Modules

| Module | Purpose |
|--------|---------|
| `src/db/lifecycle.ts` | Lead/order status engine (single source of truth) |
| `src/db/assignmentEngine.ts` | Lead assignment + call logging (append-only history) |
| `src/db/telecallerStats.ts` | Per-telecaller performance stats |
| `src/db/notificationEngine.ts` | Auto alerts (follow-ups, pending, inactive) |
| `src/db/onlineSync.ts` | Bidirectional Dexie ↔ Cloudflare D1 sync (Worker API) |
| `src/pages/LeadCenter.tsx` | Lead table + assignment UI + Log Call |
| `src/pages/TelecallerPerformance.tsx` | Performance reports |

## 📄 Report

See `TELECALLER_CRM_REPORT.md` for the full audit & implementation report.
