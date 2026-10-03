import { AuthFrame } from "@/components/auth-frame";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { getMeOptional } from "@/lib/server";

export const metadata = { title: "Sign in" };

export default async function LoginPage() {
  const me = await getMeOptional();
  if (me.user) redirect("/app");
  return (
    <AuthFrame>
      <Suspense>
        <AuthForm mode="login" />
      </Suspense>
    </AuthFrame>
  );
}
