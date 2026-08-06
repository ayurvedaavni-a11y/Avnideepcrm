# Supabase Online-to-Offline Lead Sync Guide

This guide describes how to set up the online database for lead synchronization.

## 1. Supabase Setup

### Create 'leads' Table
Run the following SQL in your Supabase SQL Editor:

```sql
CREATE TABLE leads (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  mobile TEXT NOT NULL,
  address TEXT,
  city TEXT,
  state TEXT,
  pincode TEXT,
  product TEXT,
  amount NUMERIC,
  payment_mode TEXT DEFAULT 'COD', -- 'COD' or 'Prepaid'
  source TEXT DEFAULT 'Landing Page',
  sync_status TEXT DEFAULT 'pending', -- 'pending', 'synced', 'failed'
  sync_error TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
  synced_at TIMESTAMP WITH TIME ZONE
);

-- Enable RLS
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;

-- Allow public insert (for landing page)
CREATE POLICY "Allow public insert" ON leads FOR INSERT WITH CHECK (true);

-- Allow CRM to select and update
-- Note: Replace with proper Auth roles in production
CREATE POLICY "Allow CRM access" ON leads FOR ALL USING (true);
```

## 2. Landing Page Integration

Add the following to your landing page form handler:

```javascript
import { createClient } from '@supabase/supabase-js'

const supabase = createClient('YOUR_SUPABASE_URL', 'YOUR_SUPABASE_ANON_KEY')

async function submitLead(formData) {
  const { data, error } = await supabase
    .from('leads')
    .insert([
      { 
        name: formData.name,
        mobile: formData.mobile,
        product: 'Your Product',
        amount: 1250,
        payment_mode: 'COD',
        address: formData.address,
        // ... rest of fields
      }
    ])
}
```

## 3. CRM Configuration

The CRM auto-fetches new leads every 30 seconds. You can also trigger a manual sync using the **"Sync Online Leads"** button found in the **GST Reports** (or Dashboard) module.

- **COD Leads**: Automatically converted to **Order Booked**.
- **Duplicates**: Mobile number is used to prevent duplicate customer profiles.
