import type { Metadata } from "next";
import { login } from "./actions";

export const metadata: Metadata = { title: "Log in — Admin" };

interface LoginPageProps {
  searchParams: Promise<{ error?: string }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { error } = await searchParams;

  return (
    <main className="mx-auto flex max-w-sm flex-col gap-4 px-4 py-16">
      <h1 className="text-lg font-semibold text-navy-700">Admin Log In</h1>
      <form
        action={login}
        className="flex flex-col gap-4 rounded-lg border border-neutral-300 bg-surface p-6 shadow-sm"
      >
        <label className="flex flex-col gap-1 text-sm font-medium text-neutral-700">
          Password
          <input
            type="password"
            name="password"
            required
            autoFocus
            className="rounded-md border border-neutral-300 px-3 py-2 text-neutral-900 focus:border-navy-500 focus:outline-none focus:ring-2 focus:ring-navy-200"
          />
        </label>
        {error && <p className="text-sm text-error">Incorrect password.</p>}
        <button
          type="submit"
          className="mt-2 rounded-md bg-green-600 px-4 py-2 font-semibold text-white transition hover:bg-green-700"
        >
          Log in
        </button>
      </form>
    </main>
  );
}
