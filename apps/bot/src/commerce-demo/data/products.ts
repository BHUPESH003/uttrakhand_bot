/**
 * The demo catalog: one Commerce Manager product per brand × preset amount.
 * The retailer id ("demo-a-500") is the only link between a Meta catalog
 * item and our data — parseRetailerId maps it back to brand + amount, and
 * that's all an order needs. Custom amounts have no product (they come from
 * the Flow), and orders don't care: brand + amount + qty either way.
 *
 * Feed fields per https://developers.facebook.com/docs/commerce-platform/catalog/fields
 */
import type { Brand, Dataset } from "./catalog";
import { formatRupees } from "./rules";

/** Docs: a multi-product message shows up to 30 products in up to 10 sections. */
export const CATALOG_LIMITS = { maxSections: 10, maxProducts: 30 } as const;

const brandKey = (brand: Brand) => brand.id.replace(/^brand_/, "");

export function retailerIdFor(brand: Brand, amount: number): string {
  return `demo-${brandKey(brand)}-${amount}`;
}

/** "demo-a-500" -> brand A, ₹500. Undefined for anything that isn't one of our preset products. */
export function parseRetailerId(dataset: Dataset, retailerId: string): { brand: Brand; amount: number } | undefined {
  const match = /^demo-([a-z0-9]+)-(\d+)$/.exec(retailerId);
  if (!match) return undefined;
  const brand = dataset.brands.find((b) => brandKey(b) === match[1]);
  const amount = Number(match[2]);
  return brand?.presetAmounts.includes(amount) ? { brand, amount } : undefined;
}

/** The preset a single-product message shows for a brand: ₹500 when offered, else the first preset. */
export function featuredAmount(brand: Brand): number {
  return brand.presetAmounts.includes(500) ? 500 : brand.presetAmounts[0]!;
}

/** One section per brand (title = brand name), capped at 10 sections / 30 products. */
export function catalogSections(dataset: Dataset): { title: string; productRetailerIds: string[] }[] {
  const sections: { title: string; productRetailerIds: string[] }[] = [];
  let left: number = CATALOG_LIMITS.maxProducts;
  for (const brand of dataset.brands.slice(0, CATALOG_LIMITS.maxSections)) {
    if (left === 0) break;
    const ids = brand.presetAmounts.slice(0, left).map((amount) => retailerIdFor(brand, amount));
    sections.push({ title: brand.name, productRetailerIds: ids });
    left -= ids.length;
  }
  return sections;
}

export const CATALOG_CSV_COLUMNS = [
  "id",
  "title",
  "description",
  "availability",
  "condition",
  "price",
  "link",
  "image_link",
  "brand",
  // Brand grouping. Not item_group_id: that marks *variants*, which Meta
  // expects to carry a variant attribute (size, colour, ...).
  "custom_label_0",
  "product_type",
] as const;

export type CatalogRow = Record<(typeof CATALOG_CSV_COLUMNS)[number], string>;

/** Every catalog product. `linkBase` must be on your business's own domain (a feed requirement). */
export function catalogRows(dataset: Dataset, linkBase: string): CatalogRow[] {
  return dataset.brands.flatMap((brand) =>
    brand.presetAmounts.map((amount) => {
      const id = retailerIdFor(brand, amount);
      return {
        id,
        title: `${brand.name} ${formatRupees(amount)}`,
        description: `${brand.itemName} worth ${formatRupees(amount)}. Demo product with fake data, not for sale.`,
        availability: "in stock",
        condition: "new",
        price: `${amount}.00 INR`,
        link: `${linkBase.replace(/\/?$/, "/")}${id}`,
        image_link: brand.imageUrl,
        brand: brand.name,
        custom_label_0: brand.id,
        product_type: `Demo > ${brand.category}`,
      };
    }),
  );
}

function csvField(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function toCsv(rows: CatalogRow[]): string {
  const lines = [CATALOG_CSV_COLUMNS.join(","), ...rows.map((r) => CATALOG_CSV_COLUMNS.map((c) => csvField(r[c])).join(","))];
  return `${lines.join("\n")}\n`;
}
