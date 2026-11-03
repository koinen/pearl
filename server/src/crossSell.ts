import { pool } from "./db";

export interface Product {
  id: number;
  name: string;
  category: string;
  price: number;
  emoji: string;
  description: string;
  url: string;
}

/** Categories that go well with each other. Deliberately simple: no ML in the POC. */
const COMPLEMENTS: Record<string, string[]> = {
  coffee: ["brewing", "pantry", "merch"],
  brewing: ["coffee", "brewing"],
  merch: ["coffee"],
  pantry: ["coffee", "brewing"],
};

export function toProduct(row: any): Product {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    price: row.price,
    emoji: row.emoji,
    description: row.description,
    url: `/store/#/p/${row.id}`,
  };
}

export async function listProducts(merchantId: string): Promise<Product[]> {
  const { rows } = await pool.query("SELECT * FROM products WHERE merchant_id = $1 ORDER BY id", [merchantId]);
  return rows.map(toProduct);
}

/**
 * Up to `limit` Cross-sell Suggestions for a Visitor, based on the product they are viewing and,
 * for a Customer, the categories they have bought before. Products already bought are skipped.
 */
export async function crossSellSuggestions(
  merchantId: string,
  viewingProductId: number | null,
  customerId: number | null,
  limit = 3,
): Promise<Product[]> {
  const products = await listProducts(merchantId);
  const viewing = products.find((p) => p.id === viewingProductId) ?? null;

  let ownedIds = new Set<number>();
  let ownedCategories = new Set<string>();
  if (customerId !== null) {
    const { rows } = await pool.query(
      `SELECT p.id, p.category FROM orders o JOIN products p ON p.id = o.product_id WHERE o.customer_id = $1`,
      [customerId],
    );
    ownedIds = new Set(rows.map((r) => r.id));
    ownedCategories = new Set(rows.map((r) => r.category));
  }

  const scored = products
    .filter((p) => p.id !== viewing?.id && !ownedIds.has(p.id))
    .map((p) => {
      let score = 0;
      if (viewing) {
        if (COMPLEMENTS[viewing.category]?.includes(p.category)) score += 2;
        if (p.category === viewing.category) score += 1;
      }
      for (const c of ownedCategories) {
        if (COMPLEMENTS[c]?.includes(p.category)) score += 1;
      }
      return { p, score };
    })
    .filter((s) => s.score > 0 || (!viewing && ownedCategories.size === 0));

  scored.sort((a, b) => b.score - a.score || a.p.price - b.p.price);
  return scored.slice(0, limit).map((s) => s.p);
}
