import { AuthFrame } from "@/components/auth-frame";
import { ResetPasswordForm } from "@/components/password-reset";

export const metadata = { title: "Choose a new password", robots: { index: false, follow: false } };

export default async function ResetPasswordPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <AuthFrame>
      <ResetPasswordForm token={token} />
    </AuthFrame>
  );
}
