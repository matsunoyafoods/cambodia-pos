'use client';

import { createContext, useContext } from 'react';

import type { StaffSession } from '@/lib/api-client';

export const StaffContext = createContext<StaffSession['staff'] | null>(null);

export function useStaff() {
  const staff = useContext(StaffContext);
  if (!staff) {
    throw new Error('useStaff() must be used within <StaffGate>');
  }
  return staff;
}
