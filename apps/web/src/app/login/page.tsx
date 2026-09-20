import { Suspense } from "react";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { getMeOptional } from "@/lib/server";

export const metadata = { title: "Sign in" };

export default async function LoginPage() {
  const me = await getMeOptional();
  if (me.user) redirect("/app");
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <Suspense>
        <AuthForm mode="login" />
      </Suspense>
    </main>
  );
}
