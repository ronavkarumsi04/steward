import { ResetPasswordForm } from "@/components/password-reset";

export const metadata = { title: "Choose a new password", robots: { index: false, follow: false } };

export default async function ResetPasswordPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <main className="flex min-h-screen items-center justify-center bg-[radial-gradient(900px_500px_at_50%_-10%,var(--bg-tint),transparent_70%)] p-4 sm:p-6">
      <ResetPasswordForm token={token} />
    </main>
  );
}
