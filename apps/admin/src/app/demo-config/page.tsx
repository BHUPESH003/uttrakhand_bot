import { getDemoConfig } from "@/lib/demoConfig";
import { DemoConfigForm } from "./DemoConfigForm";

// Same rule as next.config.ts's basePath: the client form's fetch() isn't
// basePath-aware, so it gets the prefix from here.
const BASE_PATH = process.env.NODE_ENV === "production" ? "/admin" : "";

export default async function DemoConfigPage() {
  const result = await getDemoConfig();

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-xl font-semibold text-navy-700">Commerce demo — Flow screens</h1>
      <p className="mt-2 text-sm text-neutral-600">
        Controls which screens customers see in the WhatsApp Flow. Changes apply to Flows started after you save;
        a customer already inside a Flow keeps the screens they started with.
      </p>
      {result.ok ? (
        <DemoConfigForm initial={result.config} basePath={BASE_PATH} />
      ) : (
        <p className="mt-6 rounded-md bg-error/10 px-3 py-2 text-sm text-error">
          Couldn&apos;t load the flags from the bot service: {result.error}
        </p>
      )}
    </main>
  );
}
