import { StaffGate } from '@/components/pos/staff-gate';
import { ThemeColorInjector } from '@/components/pos/theme-color-injector';
import { FeedbackButton } from '@/components/pos/feedback-button';

export default function PosLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ThemeColorInjector />
      <StaffGate>
        {children}
        <FeedbackButton />
      </StaffGate>
    </>
  );
}
