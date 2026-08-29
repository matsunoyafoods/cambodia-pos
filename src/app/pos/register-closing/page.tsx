import { RegisterClosingScreen } from '@/components/pos/register-closing-screen';
import { DEFAULT_SETTINGS } from '@/lib/pos-types';

export default function RegisterClosingPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-secondary/40 p-6">
      <RegisterClosingScreen khrRate={DEFAULT_SETTINGS.khrRate} />
    </div>
  );
}
