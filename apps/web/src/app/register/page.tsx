import { Suspense } from "react";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { getMe } from "@/lib/server";

export const metadata = { title: "Create account" };

export default async function RegisterPage() {
  const me = await getMe();
  if (me.user) redirect("/app");
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <Suspense>
        <AuthForm mode="register" />
      </Suspense>
    </main>
  );
}
