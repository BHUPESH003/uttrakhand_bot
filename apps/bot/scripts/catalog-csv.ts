/**
 * Writes the demo catalog as a Commerce Manager CSV feed and prints its
 * path. Offline only — upload the file yourself in Commerce Manager
 * (Catalog > Data sources > Data feed). Does not call Meta.
 *
 *   pnpm --filter bot catalog:csv [--dataset neutral|voucher] [--link-base https://your-domain/products/] [--out file.csv]
 *
 * --link-base: the feed's `link` must be a product page on your business's
 * own domain; the default is a placeholder to replace.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { getDataset, type DatasetName } from "../src/commerce-demo/data/catalog";
import { catalogRows, toCsv } from "../src/commerce-demo/data/products";

const { values } = parseArgs({
  options: {
    dataset: { type: "string", default: "neutral" },
    "link-base": { type: "string", default: "https://example.com/demo-products/" },
    out: { type: "string" },
  },
});

const name = values.dataset as DatasetName;
if (name !== "neutral" && name !== "voucher") {
  console.error(`--dataset must be neutral or voucher, got "${values.dataset}"`);
  process.exit(1);
}

const out = resolve(values.out ?? join(__dirname, "..", "catalog", `commerce-demo-${name}.csv`));
const rows = catalogRows(getDataset(name), values["link-base"]!);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, toCsv(rows), "utf-8");
console.log(out);
