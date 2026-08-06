# AVNIDEEP CRM PRO — Telecaller CRM

Offline-first e-commerce COD CRM built with React + Vite + TypeScript. Works 100% offline (Dexie/IndexedDB) with optional online multi-user sync via Supabase. Also ships as a Windows desktop app (Electron).

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
- ☁️ **Online Sync (optional)** — bidirectional Dexie ↔ Supabase sync + Realtime (see `SUPABASE_SYNC_GUIDE.md`)
- 🖥️ **Electron desktop build** — see `ELECTRON_BUILD_INSTRUCTIONS.md`

## 🚀 Live Demo

Deployed on GitHub Pages: **https://ayurvedaavni-a11y.github.io/Avnideepcrm/**

> Note: the browser version stores data in your browser's IndexedDB (offline-first). For shared multi-user data, enable the Supabase online mode.

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

## ☁️ Online Multi-User Setup (Optional)

1. Create a free Supabase project (supabase.com)
2. Run `supabase/schema.sql` in the SQL Editor
3. Run `supabase/schema_v2_telecaller.sql` (telecaller columns, call_logs, per-telecaller RLS)
4. Copy `.env.example` → `.env` and fill in your Supabase URL + anon key
5. Restart the app — it will sync Dexie ↔ Supabase automatically

Full guide: `SUPABASE_SYNC_GUIDE.md` + `ONLINE_MULTIUSER_GUIDE.md`

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
| `src/db/onlineSync.ts` | Bidirectional Dexie ↔ Supabase sync |
| `src/pages/LeadCenter.tsx` | Lead table + assignment UI + Log Call |
| `src/pages/TelecallerPerformance.tsx` | Performance reports |

## 📄 Report

See `TELECALLER_CRM_REPORT.md` for the full audit & implementation report.
