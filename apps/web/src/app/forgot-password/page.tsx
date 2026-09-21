import { redirect } from "next/navigation";
import { ForgotPasswordForm } from "@/components/password-reset";
import { getMeOptional } from "@/lib/server";

export const metadata = { title: "Reset password" };

export default async function ForgotPasswordPage() {
  const me = await getMeOptional();
  if (me.user) redirect("/app");
  return (
    <main className="flex min-h-screen items-center justify-center bg-[radial-gradient(900px_500px_at_50%_-10%,var(--bg-tint),transparent_70%)] p-4 sm:p-6">
      <ForgotPasswordForm />
    </main>
  );
}
