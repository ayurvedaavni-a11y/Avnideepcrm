import { db } from './db';

export interface GSTConfig {
  gstEnabled: boolean;
  gstRate: number;
  gstMode: 'exclusive' | 'inclusive';
  gstBeforeDiscount: boolean;
  deliveryCharge: number;
  codCharge: number;
  roundOffEnabled: boolean;
  currency: string;
}

export interface CompanyConfig {
  name: string;
  tagline: string;
  address: string;
  city: string;
  state: string;
  stateCode: string;
  pincode?: string;
  gstin: string;
  phone: string;
  email: string;
  logoBase64?: string;
  signatureBase64?: string;
  bankName: string;
  bankAccount: string;
  bankIFSC: string;
  termsConditions: string;
  invoicePrefix: string;
  hsnDefault: string;
}

const DEFAULT_GST: GSTConfig = {
  gstEnabled: true,
  gstRate: 5,                 // ✅ default requested GST rate
  gstMode: 'inclusive',       // ✅ Switch default to inclusive
  gstBeforeDiscount: false,
  deliveryCharge: 0,
  codCharge: 0,
  roundOffEnabled: true,
  currency: '₹',
};

const DEFAULT_COMPANY: CompanyConfig = {
  name: 'AVNIDEEP AYURVEDA',
  tagline: 'COD Ecommerce Business Solutions',
  address: 'Ghaziabad',
  city: 'Ghaziabad',
  state: 'Uttar Pradesh',      // ✅ seller GST state
  stateCode: '09',
  pincode: '201206',
  gstin: '',
  phone: '',
  email: '',
  bankName: '',
  bankAccount: '',
  bankIFSC: '',
  termsConditions: '1. Goods once sold will not be taken back.\n2. All disputes are subject to local jurisdiction.\n3. This is a computer generated invoice — no signature required.',
  invoicePrefix: 'AD',
  hsnDefault: '4901',
};

async function getSetting(key: string): Promise<string | null> {
  const row = await db.invoiceSettings.where('key').equals(key).first();
  return row ? row.value : null;
}

async function setSetting(key: string, value: string): Promise<void> {
  const existing = await db.invoiceSettings.where('key').equals(key).first();
  if (existing && existing.id) {
    await db.invoiceSettings.update(existing.id, { value, updatedAt: new Date().toISOString() });
  } else {
    await db.invoiceSettings.add({ key, value, updatedAt: new Date().toISOString() });
  }
}

export async function getGSTConfig(): Promise<GSTConfig> {
  try {
    const raw = await getSetting('gstConfig');
    if (raw) return { ...DEFAULT_GST, ...JSON.parse(raw) };
  } catch (e) {}
  return DEFAULT_GST;
}

export async function saveGSTConfig(config: GSTConfig): Promise<void> {
  await setSetting('gstConfig', JSON.stringify(config));
}

export async function getCompanyConfig(): Promise<CompanyConfig> {
  try {
    const raw = await getSetting('companyConfig');
    if (raw) return { ...DEFAULT_COMPANY, ...JSON.parse(raw) };
  } catch (e) {}
  return DEFAULT_COMPANY;
}

export async function saveCompanyConfig(config: CompanyConfig): Promise<void> {
  await setSetting('companyConfig', JSON.stringify(config));
}
