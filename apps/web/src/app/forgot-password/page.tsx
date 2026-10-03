import { AuthFrame } from "@/components/auth-frame";
import { redirect } from "next/navigation";
import { ForgotPasswordForm } from "@/components/password-reset";
import { getMeOptional } from "@/lib/server";

export const metadata = { title: "Reset password" };

export default async function ForgotPasswordPage() {
  const me = await getMeOptional();
  if (me.user) redirect("/app");
  return (
    <AuthFrame>
      <ForgotPasswordForm />
    </AuthFrame>
  );
}
