import { OwnerSetupScreen } from '@/components/pos/owner-setup-screen';

export default async function OwnerSetupPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <OwnerSetupScreen token={token} />;
}
