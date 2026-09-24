import { ResetPasswordForm } from "@/components/password-reset";

export const metadata = { title: "Choose a new password", robots: { index: false, follow: false } };

export default async function ResetPasswordPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <main className="flex min-h-screen items-center justify-center bg-bg p-4 sm:p-6">
      <ResetPasswordForm token={token} />
    </main>
  );
}
