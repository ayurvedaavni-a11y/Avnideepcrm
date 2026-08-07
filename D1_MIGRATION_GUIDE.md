# AVNIDEEP CRM PRO — Supabase → Cloudflare D1 Migration Guide

> ⚠️ **IMPORTANT:** Sab kuch **NAYE Cloudflare account** par deploy hoga.
> Purane (store) account ke resources ko kuch nahi hoga. Landing page ka
> `/api/leads` bhi is migration mein nahi chheda gaya hai.

---

## ✅ DEPLOYMENT STATUS (done)

| Item | Value |
|---|---|
| Account | **Ayurvedaavni@gmail.com's Account** (NOT `avnideep`) |
| Worker URL | **https://avnideep-crm-api.ayurvedaavni.workers.dev** |
| D1 database | `avnideep-crm` (id `996e0545-5fe2-439f-b4ab-91540f604e57`) — 18 tables applied |
| Secrets | `worker/.env.production` mein saved (AUTH_SECRET / BOOTSTRAP_KEY / INTAKE_KEY) |
| First admin | mobile `7060101043`, PIN `1234` (bootstrap done) |
| Verification | health ✅ login ✅ intake ✅ sync push/pull ✅ |

**Baki steps:** (1) `.env` mein `VITE_API_URL=https://avnideep-crm-api.ayurvedaavni.workers.dev` + `npm run build`,
(2) team members Team page se banao, (3) purana data migrate karna ho to Step 4, (4) landing page optional Step 5.

---

## Architecture (kya banaya hai)

```
Electron CRM (renderer)                 Shopify Landing Page (optional, baad mein)
   │  fetch + JWT                            │  fetch + X-Intake-Key
   ▼                                        ▼
┌──────────────────────────────────────────────────────┐
│  Cloudflare Worker  "avnideep-crm-api"               │
│  • /api/auth/*     → login, me, team, PIN change     │
│  • /api/sync/*     → 7 tables push / pull / delete   │
│  • /api/intake     → landing page lead insert        │
│  • /api/intake/pending → CRM picks up leads          │
│  ▼                                                   │
│  D1  "avnideep-crm"  (SQLite — 17 tables)            │
└──────────────────────────────────────────────────────┘
```

Supabase ke ye features replace hue:
| Supabase | D1 solution |
|---|---|
| Supabase Auth (mobile+PIN, roles) | Worker mein PBKDF2 PIN hash + HS256 JWT |
| PostgREST queries | Worker `/api/sync/*` (SQL + `ON CONFLICT` upsert) |
| Realtime (WebSocket) | 30-sec polling (app mein pehle se tha) |
| RLS policies | Worker mein admin-role checks |

---

## Step 1 — Worker deploy karo (NAYA account)

```bash
cd worker
npm install

# Browser se naye Cloudflare account mein login karo (ye tum karo)
npx wrangler login

# Naya D1 database banao (naye account par!)
npx wrangler d1 create avnideep-crm
# ↑ output mein database_id milega — use wrangler.toml mein paste karo

# Secrets set karo (production):
npx wrangler secret put AUTH_SECRET      # koi lambi random string
npx wrangler secret put BOOTSTRAP_KEY    # random key — sirf pehla admin banane ke liye
npx wrangler secret put INTAKE_KEY       # landing page wali key
# (wrangler.toml ke [vars] placeholder values sirf reference ke liye hain)

# LOCAL DEV ke liye: worker/.dev.vars banao (ye file .gitignore mein hai)
#   AUTH_SECRET="koi-lambi-random-string"
#   BOOTSTRAP_KEY="koi-random-key"
#   INTAKE_KEY="koi-random-key"

# Schema apply karo:
npm run migrate:remote
# = npx wrangler d1 execute avnideep-crm --remote --file=./migrations/0001_init.sql

# Deploy:
npm run deploy
```

## Step 2 — Pehla Admin banao (bootstrap)

Worker deploy hone ke baad — **sirf ek baar** (users table khali hone par):

```bash
curl -X POST https://<worker-url>/api/auth/bootstrap \
  -H "Content-Type: application/json" \
  -d '{"key":"<BOOTSTRAP_KEY>","name":"Your Name","mobile":"9876543210","pin":"1234"}'
```

Response: `{"ok":true,"userId":"1"}`. Uske baad admin login karke Team page se
baaki members banao (same mobile + PIN flow, ab D1 mein).

## Step 3 — CRM app ko Worker se jodo

1. Project root mein `.env` banao:
   ```
   VITE_API_URL=https://<worker-url>
   ```
2. App rebuild karo: `npm run build` (Electron ke liye bhi yehi build).
3. Login page pe ab mobile + PIN se login hoga — profile/team sab Worker se aayega.

App mein kya badla (ye code already likha hai):
- `src/db/supabaseClient.ts` → **delete** (ab `src/db/apiClient.ts` hai)
- `src/db/auth.ts` → Worker API par rewrite (same function names)
- `src/context/AuthContext.tsx` → JWT session restore
- `src/db/onlineSync.ts` → `api.pushRow/pullAll/...` — Realtime hata, 30s poll hai

## Step 4 — Data migrate karo (optional, agar purana data chahiye)

> Purana Supabase data move karna ho tabhi ye karo. Naya CRM khaali shuru
> bhi ho sakta hai — first login par app apna local data cloud mein push kar
> degi (`exportLocalIfCloudEmpty`), to agar **ek hi computer** se chala rahe ho
> to data automatically upar chala jayega.

```bash
SUPABASE_URL=<old-url> SUPABASE_SERVICE_ROLE_KEY=<service-key> \
  node scripts/export_supabase_to_sql.mjs
npx wrangler d1 execute avnideep-crm --remote --file=./d1_export.sql
```

**Note:** Team members ke accounts (mobile + PIN) Supabase se export NAHI ho
sakte (passwords Supabase mein hashed rehte hain) — Step 2/3 se naye banao.

## Step 5 — Landing page intake (BAAD mein, optional)

Landing page abhi `/api/leads` (store Worker) par post karta hai — woh change
**nahi hua**. Jab chaaho, store Worker ke `/api/leads` handler mein Supabase
call ki jagah ye daal do:

```js
await fetch('https://<crm-worker-url>/api/intake', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Intake-Key': '<INTAKE_KEY>' },
  body: JSON.stringify({ name, mobile, product, amount, payment_mode, ... }),
});
```

CRM har 30 sec mein `/api/intake/pending` se naye leads uthayega (pehle jaisa).

---

## Security notes (implemented)

- **Fail-closed secrets:** Agar `AUTH_SECRET` missing/placeholder hai to Worker
  har request par `503 Server not configured` deta hai — kabhi bhi placeholder
  secret se sign nahi karta.
- **Role-based table access:** Telecallers sirf 7 shared tables + intake `leads`
  ko push/pull kar sakte hain. `crm_invoices`, `crm_products`, `crm_payments`
  waghera admin-only hain (same as pehle ke RLS policies).
- **SQL injection protection:** Table/column/conflict-target sab whitelist se
  validate hote hain — client se koi bhi raw SQL fragment nahi accept hota.
- **PIN hashing:** PBKDF2-HMAC-SHA256 (default 15,000 iterations, clamp
  1k–100k). Workers **free plan** par 10ms CPU limit hai — login par PBKDF2
  usse cross ho sakta hai. Agar login 500 de to **Workers Paid plan** ($5/mo,
  30s CPU) par le jao ya `PBKDF2_ITERATIONS` ghatao.
- **Login rate limiting:** in-memory per-IP limiter (10 attempts / 5 min).
  Bahut zyada traffic par Cloudflare `ratelimit` binding ka upgrade karo.

---

## Rollback

Agar kuch gadbad ho to: `.env` se `VITE_API_URL` hatao + `npm run build` →
app wapas Supabase-built URL/key use karegi (supabaseClient.ts ki fallback
built-in thi — ab delete ho chuki hai, to rollback = purana `supabaseClient.ts`
wapas + `.env` mein purane Supabase vars). Purana Supabase project abhi bhi
exist karta hai — kuch delete nahi hua.

## Files created/changed

| File | Kya hai |
|---|---|
| `worker/` | Cloudflare Worker (auth + sync + intake) + D1 migrations |
| `scripts/export_supabase_to_sql.mjs` | Supabase → D1 data export |
| `src/db/apiClient.ts` | Naya — Worker API client |
| `src/db/auth.ts` | Rewrite — D1 auth |
| `src/db/onlineSync.ts` | Rewrite — D1 sync (no Realtime) |
| `src/context/AuthContext.tsx` | Rewrite — JWT session |
| `.env.example` | `VITE_API_URL` |
| `src/db/supabaseClient.ts` | **DELETED** |
