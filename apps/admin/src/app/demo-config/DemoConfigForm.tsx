"use client";

import { useState, type FormEvent } from "react";
import type { DemoFlowConfig } from "@/lib/demoConfig";

const TOGGLES: { key: "offersScreen" | "promoField" | "customAmount"; label: string; hint: string }[] = [
  { key: "offersScreen", label: "Offers screen", hint: "Off: customers go straight from the amount to the review screen." },
  { key: "promoField", label: "Promo code field", hint: "Off: the offers screen has no promo code box." },
  { key: "customAmount", label: "Custom amount", hint: "Off: no “Other amount” option in the Flow or next to the catalog." },
];

export function DemoConfigForm({ initial, basePath }: { initial: DemoFlowConfig; basePath: string }) {
  const [flags, setFlags] = useState(initial);
  const [status, setStatus] = useState<{ kind: "idle" | "saving" | "saved" | "error"; message?: string }>({ kind: "idle" });

  async function save(event: FormEvent) {
    event.preventDefault();
    setStatus({ kind: "saving" });
    const res = await fetch(`${basePath}/api/demo-config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(flags),
    }).catch(() => null);
    const json = (await res?.json().catch(() => ({}))) as { config?: DemoFlowConfig; error?: string } | undefined;
    if (res?.ok && json?.config) {
      setFlags(json.config);
      setStatus({ kind: "saved", message: "Saved. New Flows use these screens." });
    } else {
      setStatus({ kind: "error", message: json?.error ?? "Could not save" });
    }
  }

  return (
    <form onSubmit={save} className="mt-6 flex flex-col gap-4">
      {TOGGLES.map(({ key, label, hint }) => (
        <label key={key} className="flex items-start gap-3 rounded-md border border-neutral-300 bg-surface p-3">
          <input
            type="checkbox"
            checked={flags[key]}
            onChange={(e) => setFlags({ ...flags, [key]: e.target.checked })}
            className="mt-1 h-4 w-4"
          />
          <span>
            <span className="block font-medium text-neutral-900">{label}</span>
            <span className="block text-sm text-neutral-600">{hint}</span>
          </span>
        </label>
      ))}
      <label className="flex flex-col gap-1 rounded-md border border-neutral-300 bg-surface p-3">
        <span className="font-medium text-neutral-900">Maximum quantity</span>
        <span className="text-sm text-neutral-600">1 to 20. Below 9 the demo failure triggers (quantity 7 and 9) can&apos;t be chosen.</span>
        <input
          type="number"
          min={1}
          max={20}
          step={1}
          required
          value={flags.maxQty}
          onChange={(e) => setFlags({ ...flags, maxQty: Number(e.target.value) })}
          className="mt-1 w-24 rounded-md border border-neutral-300 px-3 py-2"
        />
      </label>
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={status.kind === "saving"}
          className="rounded-md bg-navy-700 px-4 py-2 text-sm font-medium text-white hover:bg-navy-600 disabled:opacity-60"
        >
          {status.kind === "saving" ? "Saving…" : "Save"}
        </button>
        {status.message && (
          <p role="status" className={status.kind === "error" ? "text-sm text-error" : "text-sm text-green-700"}>
            {status.message}
          </p>
        )}
      </div>
    </form>
  );
}
