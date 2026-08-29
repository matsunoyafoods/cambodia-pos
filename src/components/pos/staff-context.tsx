'use client';

import { createContext, useContext } from 'react';

// dine 連携ログイン (Telegram bot-login) と POS ネイティブ PIN ログインの
// どちらでログインしても、画面側から見た形は共通のこの型に正規化する。
export type AuthenticatedStaff = {
  id: string;
  display_name: string;
  role: 'owner' | 'manager' | 'staff';
  store_id: string;
  store_name?: string;
  /** どちらの認証経路でログインしたか (multi-tenant-productization-spec.md §3.3) */
  authMode: 'dine' | 'pos_native';
};

export const StaffContext = createContext<AuthenticatedStaff | null>(null);

export function useStaff() {
  const staff = useContext(StaffContext);
  if (!staff) {
    throw new Error('useStaff() must be used within <StaffGate>');
  }
  return staff;
}
