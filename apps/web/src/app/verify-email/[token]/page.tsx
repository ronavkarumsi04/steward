import { AuthFrame } from "@/components/auth-frame";
import { EmailVerification } from "@/components/email-verification";

export const metadata = { title: "Verify your email", robots: { index: false, follow: false } };

export default async function VerifyEmailPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <AuthFrame><EmailVerification token={token} /></AuthFrame>;
}
