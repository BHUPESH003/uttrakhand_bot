"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  useForm,
  type FieldError,
  type FieldErrors,
  type Path,
  type UseFormRegister,
} from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { Lang, Service } from "types";
import { BIRTH_FORM_FIELDS, DEATH_FORM_FIELDS, DOMICILE_FORM_FIELDS, type FormFieldDef } from "types";
import { t } from "@/copy";
import {
  birthFormSchema,
  deathFormSchema,
  domicileFormSchema,
  type BirthFormValues,
  type DeathFormValues,
  type DomicileFormValues,
} from "@/schema";

interface Props {
  service: Service;
  lang: Lang;
  token: string;
  initialName: string;
}

/** Birth, death, and domicile certificates have fully disjoint field sets, so each gets its own form rather than one generic renderer fighting a union type. */
export function ApplyForm({ service, lang, token, initialName }: Props) {
  if (service === "BIRTH") return <BirthApplyForm lang={lang} token={token} initialName={initialName} />;
  if (service === "DEATH") return <DeathApplyForm lang={lang} token={token} initialName={initialName} />;
  return <DomicileApplyForm lang={lang} token={token} initialName={initialName} />;
}

async function submitApplication(token: string, formData: Record<string, unknown>) {
  const res = await fetch("/api/apply", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, formData }),
  });
  if (!res.ok) return null;
  return (await res.json()) as { referenceNumber: string };
}

const inputClass =
  "rounded-md border border-neutral-300 px-3 py-2 text-neutral-900 focus:border-navy-500 focus:outline-none focus:ring-2 focus:ring-navy-200";
const formShellClass =
  "flex flex-col gap-4 rounded-lg border border-neutral-300 bg-surface p-6 shadow-sm";
const submitButtonClass =
  "mt-2 rounded-md bg-green-600 px-4 py-2 font-semibold text-white transition hover:bg-green-700 disabled:opacity-60";

function Field({
  label,
  error,
  hint,
  children,
}: {
  label: string;
  error?: FieldError;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm font-medium text-neutral-700">
      {label}
      {children}
      {hint && !error && <span className="text-xs font-normal text-neutral-500">{hint}</span>}
      {error && <span className="text-xs font-normal text-error">{error.message}</span>}
    </label>
  );
}

/** Renders one field from a shared FormFieldDef (packages/types) — label, input kind, and select options all come from there so the web form and the PDF certificate can never show different labels for the same field. */
function DynamicField<T extends Record<string, unknown>>({
  field,
  lang,
  register,
  errors,
}: {
  field: FormFieldDef;
  lang: Lang;
  register: UseFormRegister<T>;
  errors: FieldErrors<T>;
}) {
  const label = field.label[lang];
  const error = errors[field.key as keyof T] as FieldError | undefined;
  const name = field.key as Path<T>;
  const hint = field.key.toLowerCase().includes("aadhaar") ? t(lang, "aadhaarHint") : undefined;

  if (field.kind === "select") {
    return (
      <Field label={label} error={error}>
        <select {...register(name)} className={inputClass} defaultValue="">
          <option value="" disabled>
            —
          </option>
          {field.options?.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label[lang]}
            </option>
          ))}
        </select>
      </Field>
    );
  }

  if (field.kind === "textarea") {
    return (
      <Field label={label} error={error}>
        <textarea {...register(name)} className={inputClass} rows={3} />
      </Field>
    );
  }

  const inputType = field.kind === "date" ? "date" : field.kind === "number" ? "number" : "text";
  return (
    <Field label={label} error={error} hint={hint}>
      <input
        {...register(name, field.kind === "number" ? { valueAsNumber: true } : undefined)}
        className={inputClass}
        type={inputType}
      />
    </Field>
  );
}

function SuccessScreen({ lang, reference }: { lang: Lang; reference: string }) {
  return (
    <div className="animate-fade-slide-up flex flex-col items-center gap-4 rounded-lg border border-green-600 bg-surface p-8 text-center shadow-sm">
      <div className="animate-check-pop flex h-20 w-20 items-center justify-center rounded-full bg-green-100">
        <svg viewBox="0 0 24 24" className="h-11 w-11" fill="none" aria-hidden>
          <path
            d="M5 13l4 4L19 7"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="animate-check-draw text-green-600"
          />
        </svg>
      </div>
      <h1 className="text-xl font-semibold text-green-700">{t(lang, "successTitle")}</h1>
      <p className="text-neutral-700">{t(lang, "successBody")}</p>
      <div className="w-full rounded-md bg-navy-50 px-4 py-3">
        <p className="text-sm text-neutral-500">{t(lang, "successReferenceLabel")}</p>
        <p className="text-2xl font-bold tracking-wide text-navy-700">{reference}</p>
      </div>
      <div className="flex items-start gap-2 rounded-md border border-navy-200 bg-white px-4 py-3 text-left text-sm text-neutral-600">
        <span aria-hidden>📱</span>
        <p>{t(lang, "successNote")}</p>
      </div>
    </div>
  );
}

function BirthApplyForm({ lang, token, initialName }: Omit<Props, "service">) {
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<BirthFormValues>({
    resolver: zodResolver(birthFormSchema),
    defaultValues: { applicantName: initialName },
  });
  const [reference, setReference] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState(false);
  const [sameAddress, setSameAddress] = useState(false);
  const addressAtBirth = watch("addressAtBirth");

  // Keeps permanentAddress in sync while the checkbox is ticked, even
  // though the field itself is hidden — RHF tracks its value regardless.
  useEffect(() => {
    if (sameAddress) setValue("permanentAddress", addressAtBirth ?? "", { shouldValidate: true });
  }, [sameAddress, addressAtBirth, setValue]);

  if (reference) return <SuccessScreen lang={lang} reference={reference} />;

  const onSubmit = handleSubmit(async (values) => {
    setSubmitError(false);
    const result = await submitApplication(token, values);
    if (!result) {
      setSubmitError(true);
      return;
    }
    setReference(result.referenceNumber);
  });

  return (
    <form onSubmit={onSubmit} noValidate className={formShellClass}>
      <h1 className="text-lg font-semibold text-navy-700">{t(lang, "birthFormTitle")}</h1>
      <p className="-mt-2 text-xs text-neutral-500">{t(lang, "formSubtitle")}</p>
      <Field label={t(lang, "applicantName")} error={errors.applicantName}>
        <input {...register("applicantName")} className={inputClass} type="text" />
      </Field>
      {BIRTH_FORM_FIELDS.map((field) => {
        if (field.key !== "permanentAddress") {
          return (
            <DynamicField key={field.key} field={field} lang={lang} register={register} errors={errors} />
          );
        }
        return (
          <div key={field.key} className="flex flex-col gap-2">
            <label className="flex items-center gap-2 text-sm text-neutral-700">
              <input
                type="checkbox"
                checked={sameAddress}
                onChange={(event) => setSameAddress(event.target.checked)}
              />
              {t(lang, "sameAsAddressAbove")}
            </label>
            {!sameAddress && (
              <DynamicField field={field} lang={lang} register={register} errors={errors} />
            )}
          </div>
        );
      })}
      {submitError && <p className="text-sm text-error">{t(lang, "submitError")}</p>}
      <button type="submit" disabled={isSubmitting} className={submitButtonClass}>
        {isSubmitting ? t(lang, "submitting") : t(lang, "submit")}
      </button>
    </form>
  );
}

function DeathApplyForm({ lang, token, initialName }: Omit<Props, "service">) {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<DeathFormValues>({
    resolver: zodResolver(deathFormSchema),
    defaultValues: { applicantName: initialName },
  });
  const [reference, setReference] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState(false);

  if (reference) return <SuccessScreen lang={lang} reference={reference} />;

  const onSubmit = handleSubmit(async (values) => {
    setSubmitError(false);
    const result = await submitApplication(token, values);
    if (!result) {
      setSubmitError(true);
      return;
    }
    setReference(result.referenceNumber);
  });

  return (
    <form onSubmit={onSubmit} noValidate className={formShellClass}>
      <h1 className="text-lg font-semibold text-navy-700">{t(lang, "deathFormTitle")}</h1>
      <p className="-mt-2 text-xs text-neutral-500">{t(lang, "formSubtitle")}</p>
      <Field label={t(lang, "applicantName")} error={errors.applicantName}>
        <input {...register("applicantName")} className={inputClass} type="text" />
      </Field>
      {DEATH_FORM_FIELDS.map((field) => (
        <DynamicField key={field.key} field={field} lang={lang} register={register} errors={errors} />
      ))}
      {submitError && <p className="text-sm text-error">{t(lang, "submitError")}</p>}
      <button type="submit" disabled={isSubmitting} className={submitButtonClass}>
        {isSubmitting ? t(lang, "submitting") : t(lang, "submit")}
      </button>
    </form>
  );
}

function DomicileApplyForm({ lang, token, initialName }: Omit<Props, "service">) {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<DomicileFormValues>({
    resolver: zodResolver(domicileFormSchema),
    defaultValues: { applicantName: initialName },
  });
  const [reference, setReference] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState(false);

  if (reference) return <SuccessScreen lang={lang} reference={reference} />;

  const onSubmit = handleSubmit(async (values) => {
    setSubmitError(false);
    const result = await submitApplication(token, values);
    if (!result) {
      setSubmitError(true);
      return;
    }
    setReference(result.referenceNumber);
  });

  return (
    <form onSubmit={onSubmit} noValidate className={formShellClass}>
      <h1 className="text-lg font-semibold text-navy-700">{t(lang, "domicileFormTitle")}</h1>
      <p className="-mt-2 text-xs text-neutral-500">{t(lang, "formSubtitle")}</p>
      <Field label={t(lang, "applicantName")} error={errors.applicantName}>
        <input {...register("applicantName")} className={inputClass} type="text" />
      </Field>
      {DOMICILE_FORM_FIELDS.map((field) => (
        <DynamicField key={field.key} field={field} lang={lang} register={register} errors={errors} />
      ))}
      {submitError && <p className="text-sm text-error">{t(lang, "submitError")}</p>}
      <button type="submit" disabled={isSubmitting} className={submitButtonClass}>
        {isSubmitting ? t(lang, "submitting") : t(lang, "submit")}
      </button>
    </form>
  );
}
