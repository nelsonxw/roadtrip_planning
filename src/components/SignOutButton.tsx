"use client";

import { useRouter } from "next/navigation";
import { post } from "@/lib/clientApi";

export function SignOutButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      className="rounded-lg px-3 py-1.5 text-slate-700 hover:bg-slate-100"
      onClick={async () => {
        await post("/api/auth/logout", {});
        router.replace("/login");
        router.refresh();
      }}
    >
      Sign out
    </button>
  );
}
