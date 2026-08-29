import { StaffGate } from '@/components/pos/staff-gate';

export default function PosLayout({ children }: { children: React.ReactNode }) {
  return <StaffGate>{children}</StaffGate>;
}
