import { db } from './db';
import { resolveCustomerLocation, normalizeStateName } from './stateResolver';

export interface ParsedAddress {
  city: string;
  state: string;
  pincode: string;
  district: string;
}

export function parseAddressDetails(address: string): ParsedAddress {
  return resolveCustomerLocation({ address }) as ParsedAddress;
}

export async function repairCustomerRecord(customerId: number): Promise<boolean> {
  const customer = await db.customers.get(customerId);
  if (!customer) return false;

  const updates: any = { updatedAt: new Date().toISOString() };
  const resolved = resolveCustomerLocation({
    city: customer.city,
    district: customer.district,
    state: customer.state,
    pincode: customer.pincode,
    address: customer.address,
  });

  if ((!customer.pincode || customer.pincode === 'Unknown') && resolved.pincode && resolved.pincode !== 'Unknown') updates.pincode = resolved.pincode;
  if ((!customer.city || customer.city === 'Unknown') && resolved.city && resolved.city !== 'Unknown') updates.city = resolved.city;
  if ((!customer.state || customer.state === 'Unknown') && resolved.state && resolved.state !== 'Unknown') updates.state = resolved.state;
  if ((!customer.district || customer.district === 'Unknown') && resolved.district && resolved.district !== 'Unknown') updates.district = resolved.district;

  if (customer.state) {
    const normalized = normalizeStateName(customer.state);
    if (normalized !== customer.state) updates.state = normalized;
  }

  const changed = Object.keys(updates).length > 1;
  if (changed) {
    console.log('[RepairCustomer]', {
      customerId,
      parsedAddress: customer.address,
      detectedCity: updates.city || customer.city,
      detectedState: updates.state || customer.state,
      detectedPincode: updates.pincode || customer.pincode
    });
    await db.customers.update(customerId, updates);
  }
  return changed;
}

export async function repairAllCustomers(): Promise<{ scanned: number; repaired: number }> {
  const customers = await db.customers.toArray();
  let repaired = 0;
  for (const c of customers) {
    const changed = await repairCustomerRecord(c.id!);
    if (changed) repaired++;
  }
  return { scanned: customers.length, repaired };
}

export function isValidIndianPincode(pin: string): boolean {
  return /^\d{6}$/.test(String(pin || ''));
}

export function isValidMobile(mobile: string): boolean {
  return /^[6-9]\d{9}$/.test(String(mobile || ''));
}
