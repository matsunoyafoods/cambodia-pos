'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import { checkStaffSession, type StaffSession } from '@/lib/api-client';
import { StaffContext } from './staff-context';

/**
 * /pos/* 配下を保護する認証ガード。
 * matsunoya-dine の sb-access-token Cookie が無い/スタッフ権限が無ければ /login へ。
 */
export function StaffGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [staff, setStaff] = useState<StaffSession['staff'] | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    checkStaffSession()
      .then((result) => {
        if (cancelled) return;
        if (!result) {
          router.replace('/login');
          return;
        }
        setStaff(result);
      })
      .catch(() => {
        if (!cancelled) router.replace('/login');
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (staff === undefined) {
    return (
      <div className="flex min-h-dvh items-center justify-center text-muted-foreground">
        読み込み中…
      </div>
    );
  }
  if (staff === null) {
    return null; // リダイレクト中
  }

  return <StaffContext.Provider value={staff}>{children}</StaffContext.Provider>;
}
