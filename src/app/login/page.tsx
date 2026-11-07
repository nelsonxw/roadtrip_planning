import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth";
import { AuthForm } from "@/components/AuthForm";

export default async function LoginPage() {
  if (await getCurrentUser()) redirect("/");
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-semibold text-slate-900">RoadTrip AI</h1>
        <p className="mt-1 text-sm text-slate-600">Plan routes, stops and daily driving with an assistant that asks before it changes anything.</p>
        <AuthForm />
      </div>
    </main>
  );
}
