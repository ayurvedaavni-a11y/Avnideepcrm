# AVNIDEEP CRM PRO — Online Multi-User Setup Guide (5-10 Telecallers)

Is guide mein aapka offline CRM web + desktop dono par **shared online CRM** ban chuka hai. Ab bas 4 steps mein setup karna hai. Total cost: **₹0/month** (free tiers).

## Kya banaya gaya hai

```
Telecaller 1 (Browser) ─┐
Telecaller 2 (Browser) ─┤→ Supabase (Postgres + Auth + Realtime)
Admin (Desktop/Web) ────┘        └→ Sabhi ko turant changes dikhte hain
```

- **Login:** Mobile Number + 4-digit PIN (har telecaller ka apna account)
- **Roles:** Admin (sab kuch) vs Telecaller (Leads + Followups + Orders)
- **Sync:** Har change turant cloud par jaata hai (Realtime) + 30s safety sync
- **Offline:** Internet band ho toh bhi app chalta hai — data queue hota hai, wapas online hote hi sync

---

## Step 1 — Supabase database setup (10 minute)

1. [supabase.com](https://supabase.com) par login karein. Apna existing project use karein (jiska URL code mein hai) ya naya project banayein.
2. **SQL Editor** kholen → `supabase/schema.sql` ki poori file copy karke **Run** karein.
   (Isse saari tables, security policies, realtime aur profiles trigger ban jaati hain.)
3. **Authentication → Sign In / Up → Email** mein:
   - **Allow new users to sign up** → ON
   - **Confirm email** → OFF  (zaroori — warna login nahi hoga)

> Agar aap naya Supabase project banate hain toh apne URL + anon key `.env` mein daalein (Step 4).

---

## Step 2 — Pehla Admin account banayein

1. Supabase **Authentication → Users → Add user** kholen:
   - Email: `9876543210@telecaller.crm` (apna mobile number daalein)
   - Password: 4-digit PIN, e.g. `1234`
2. **SQL Editor** mein yeh chalayen (mobile number badal kar):

```sql
update public.profiles
   set role = 'admin', mobile = '9876543210'
 where id = (select id from auth.users where email = '9876543210@telecaller.crm');
```

3. Baaki telecallers ab **app ke Team Management page** se banaye jaayenge (admin login ke baad) — wahan naam + mobile + PIN daalte hi account ban jaata hai.
---

## Step 3 — Local test karein

```bash
npm install
npm run dev
```

Browser mein `http://localhost:5173` kholen → apne mobile + PIN se login karein. Desktop app ke liye:

```bash
npm run build
npm run electron
```

> Desktop app mein bhi login hota hai aur wahi cloud data sync hota hai (SQLite local backup ke saath).

---

## Step 4 — Web par deploy karein (FREE)

Build karein:

```bash
npm run build      # dist/ folder banega
```

### Option A — Netlify (sabse aasan)
1. [app.netlify.com/drop](https://app.netlify.com/drop) kholen
2. `dist/` folder ko drag-drop karein
3. **Site settings → Environment variables** mein daalein:
   - `VITE_SUPABASE_URL` = `https://xxxx.supabase.co`
   - `VITE_SUPABASE_ANON_KEY` = apna anon (public) key
4. Done! URL telecallers ko bhejein

### Option B — Vercel
```bash
npm i -g vercel
vercel --prod
```
Vercel dashboard mein Project → Settings → Environment Variables daalein, phir redeploy.

### Option C — Cloudflare Pages
Dashboard → Pages → Upload assets → `dist/` folder → Environment variables set karein.

> **Important:** Dono env vars **bina** bhi app chalta hai (code mein pehle wale project ke fallback hain), lekin production mein apne project ke values set karna best hai.
---

## Kya-kya sync hota hai (Phase 1)

| Table | Sync | Kisko dikhta hai |
|-------|------|------------------|
| Customers, Leads, Orders, Followups (SpaceL), Timeline, Notifications | ✅ Bidirectional + Realtime | Sab team members |
| Landing-page leads (`leads` table) | ✅ Auto-convert hoti hain | Sab |
| Invoices, Products, Inventory, Payments, Logistics, NDR | ⏳ Abhi local (admin desktop) | Phase 2 mein sync |

- **Telecaller:** Dashboard, Lead Center, SpaceL Leads (Followups), Order Pipeline
- **Admin:** Sab kuch + Team Management + Settings
- Landing page wali leads pehle ki tarah hi aayengi — ab sabhi ko turant dikhengi.

## Login kaise kaam karta hai

Phone + PIN ko Supabase Auth ke synthetic email (`<mobile>@telecaller.crm`) + password par map kiya gaya hai. PIN change karne ke liye **Settings → My Account → Change Login PIN**.

## Security (built-in)

- **RLS policies:** Sirf logged-in team members data padh/update kar sakte hain. Admin-only tables (invoices, inventory...) sirf admin ko.
- Landing page ke liye sirf public **insert** allowed hai (data padhna nahi).
- **Service role key kabhi client mein nahi daalna** — woh sirf server/Supabase dashboard mein rakhein.

## Troubleshooting

| Problem | Fix |
|---------|-----|
| "Account confirm nahi hua" | Supabase → Authentication → Email → Confirm email OFF |
| "Invalid login credentials" | Mobile + PIN dobara check karein; profile row admin ne banayi hai? |
| Login ke baad bhi login page | `profiles` table mein row hai? `is_active = true` hai? |
| Sidebar mein "sync pending" | Internet check; thodi der mein auto retry hota hai |
| Naye member ka signup error | "Allow new users to sign up" ON hai? |
| Duplicate customer | Mobile number unique hai — dusre machine se same mobile update hoga |

## Cost (free tiers)

- **Supabase free:** 500MB database, 50K monthly active users, 2GB bandwidth — 5-10 telecallers ke liye kaafi hai
- **Netlify/Vercel free:** 100GB bandwidth/month
- Jab team badhe toh Supabase **Pro ($25/month)** unlimited tak le ja sakte hain

## Phase 2 (aage)

- Invoices/Products/Inventory/Payments/Logistics/NDR ka cloud sync
- Field-level conflict resolution
- Telecaller-wise performance reports
- WhatsApp integration ke saath cloud broadcast
