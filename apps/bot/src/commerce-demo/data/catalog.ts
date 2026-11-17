/**
 * Fake brands for the commerce demo. Two datasets with the exact same shape
 * (same brand ids, categories, limits) — only the wording differs, so every
 * rule in rules.ts behaves identically whichever one is live.
 *
 * Swap point: replace getDataset() with a real catalog API call later;
 * nothing outside data/ should know these are hardcoded.
 */
export type DatasetName = "neutral" | "voucher";
export type Category = "Food" | "Shopping" | "Travel" | "Entertainment";

/** Custom-amount bounds, in whole rupees. */
export interface AmountLimits {
  min: number;
  max: number;
  step: number;
}

export interface Brand {
  id: string;
  name: string;
  category: Category;
  /** What the user is buying, e.g. "Sample gift item". */
  itemName: string;
  /** Public HTTPS PNG, 4:3 (800x600) — Meta fetches it directly. */
  imageUrl: string;
  presetAmounts: number[];
  limits: AmountLimits;
}

export interface Dataset {
  name: DatasetName;
  /** Prefix for issued demo codes — always starts with DEMO- so a code can never pass for a real one. */
  codePrefix: string;
  brands: Brand[];
}

export const PRESET_AMOUNTS = [250, 500, 1000, 2000, 5000];

// Every preset must satisfy every brand's limits (checked in data.test.ts).
const BASE = [
  { id: "brand_a", letter: "A", category: "Food", colour: "2E7D32", limits: { min: 100, max: 10000, step: 50 } },
  { id: "brand_b", letter: "B", category: "Shopping", colour: "1565C0", limits: { min: 100, max: 10000, step: 50 } },
  { id: "brand_c", letter: "C", category: "Travel", colour: "EF6C00", limits: { min: 250, max: 10000, step: 250 } },
  { id: "brand_d", letter: "D", category: "Entertainment", colour: "6A1B9A", limits: { min: 100, max: 5000, step: 50 } },
] as const;

// ponytail: placehold.co placeholders (verified 800x600 image/png); host our own if that service ever goes away.
function imageUrl(name: string, colour: string): string {
  return `https://placehold.co/800x600/${colour}/FFFFFF.png?text=${encodeURIComponent(name)}`;
}

function buildBrands(itemName: (brandName: string) => string): Brand[] {
  return BASE.map((b) => {
    const name = `Sample brand ${b.letter}`;
    return {
      id: b.id,
      name,
      category: b.category,
      itemName: itemName(name),
      imageUrl: imageUrl(name, b.colour),
      presetAmounts: [...PRESET_AMOUNTS],
      limits: { ...b.limits },
    };
  });
}

const DATASETS: Record<DatasetName, Dataset> = {
  neutral: { name: "neutral", codePrefix: "DEMO-ITEM", brands: buildBrands(() => "Sample gift item") },
  voucher: { name: "voucher", codePrefix: "DEMO-GV", brands: buildBrands((n) => `${n} gift voucher`) },
};

export function getDataset(name: DatasetName): Dataset {
  return DATASETS[name];
}

export function findBrand(dataset: Dataset, brandId: string): Brand | undefined {
  return dataset.brands.find((b) => b.id === brandId);
}
