import type { Metadata } from "next";
import type { Lang, Service } from "types";
import { resolveValidToken } from "@/token";
import { t } from "@/copy";
import { ApplyForm } from "./ApplyForm";

export const metadata: Metadata = { title: "Apply for Certificate — Uttarakhand e-Seva" };

function parseLang(value: string | undefined): Lang {
  return value === "hi" ? "hi" : "en";
}

function parseService(value: string | undefined): Service | null {
  if (value === "birth") return "BIRTH";
  if (value === "death") return "DEATH";
  return null;
}

interface ApplyPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function ApplyPage({ searchParams }: ApplyPageProps) {
  const params = await searchParams;
  const tokenParam = typeof params.token === "string" ? params.token : "";
  const lang = parseLang(typeof params.lang === "string" ? params.lang : undefined);
  const service = parseService(typeof params.service === "string" ? params.service : undefined);
  const name = typeof params.n === "string" ? params.n : "";

  const tokenRow = tokenParam ? await resolveValidToken(tokenParam) : null;

  if (!tokenRow || !service) {
    return (
      <main className="mx-auto flex max-w-lg flex-col items-center gap-4 px-4 py-16 text-center">
        <h1 className="text-xl font-semibold text-navy-700">{t(lang, "invalidTokenTitle")}</h1>
        <p className="text-neutral-700">{t(lang, "invalidTokenBody")}</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-lg px-4 py-10">
      <ApplyForm service={service} lang={lang} token={tokenParam} initialName={name} />
    </main>
  );
}
