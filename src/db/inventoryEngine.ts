import { db, Product } from './db';

/**
 * Adjust product stock and log the change.
 * Negative qtyChange = stock OUT (sale). Positive = stock IN (restock/return).
 */
export async function adjustStock(
  productId: number,
  qtyChange: number,
  changeType: 'IN' | 'OUT' | 'ADJUSTMENT' | 'RTO_RESTORE' | 'CANCEL_RESTORE',
  reference?: string,
  orderId?: number,
  agentName: string = 'System',
  notes?: string
): Promise<boolean> {
  try {
    return await db.transaction('rw', [db.products, db.inventoryLogs], async () => {
      const product = await db.products.get(productId);
      if (!product) return false;

      const qtyBefore = product.stockQty || 0;
      const qtyAfter = qtyBefore + qtyChange;
      if (qtyAfter < 0) {
        console.warn(`[Inventory] Stock would go negative for ${product.name}. Adjustment blocked.`);
        return false;
      }

      await db.products.update(productId, {
        stockQty: qtyAfter,
        updatedAt: new Date().toISOString(),
      });

      await db.inventoryLogs.add({
        productId,
        changeType,
        qtyChange,
        qtyBefore,
        qtyAfter,
        reference,
        orderId,
        agentName,
        notes,
        createdAt: new Date().toISOString(),
      });

      // Low stock alert
      const lowStockAlert = (product.lowStockAlert || 5);
      if (qtyAfter >= 0 && qtyAfter <= lowStockAlert) {
        await db.notifications.add({
          title: 'Low Stock Alert',
          message: `Product "${product.name}" has only ${qtyAfter} units remaining (threshold: ${lowStockAlert})`,
          type: 'warning', isRead: false, createdAt: new Date().toISOString()
        });
      }

      return true;
    });
  } catch (err) {
    console.error('[Inventory] adjustStock failed:', err);
    return false;
  }
}

/**
 * Decrease stock when an order is booked.
 * Matches product by name (best-effort) or SKU.
 */
export async function deductStockForOrder(orderId: number, productName: string, qty: number): Promise<void> {
  try {
    const product = await db.products
      .filter(p => p.name.toLowerCase() === productName.toLowerCase() || p.sku.toLowerCase() === productName.toLowerCase())
      .first();
    if (!product || !product.id) return;
    await adjustStock(product.id, -Math.abs(qty), 'OUT', `Order #${orderId}`, orderId, 'System', 'Auto stock-out for booked order');
  } catch (err) {
    console.error('[Inventory] deductStockForOrder failed:', err);
  }
}

/**
 * Restore stock when order is cancelled or RTO.
 */
export async function restoreStockForOrder(orderId: number, productName: string, qty: number, reason: 'CANCEL_RESTORE' | 'RTO_RESTORE' = 'CANCEL_RESTORE'): Promise<void> {
  try {
    const product = await db.products
      .filter(p => p.name.toLowerCase() === productName.toLowerCase() || p.sku.toLowerCase() === productName.toLowerCase())
      .first();
    if (!product || !product.id) return;
    await adjustStock(product.id, Math.abs(qty), reason, `Order #${orderId}`, orderId, 'System', `Auto stock-restore (${reason})`);
  } catch (err) {
    console.error('[Inventory] restoreStockForOrder failed:', err);
  }
}

/**
 * Check if a product is low on stock.
 */
export function isLowStock(product: Product): boolean {
  return (product.stockQty || 0) <= (product.lowStockAlert || 0);
}
