'use client';

import { createContext, useContext } from 'react';

// dine 連携ログイン (Telegram bot-login) と POS ネイティブ PIN ログインの
// どちらでログインしても、画面側から見た形は共通のこの型に正規化する。
// role: dine 連携ログインは 'owner'|'manager'|'staff' の3値のまま (matsunoya-dine 側の
// 別の権限体系)。pos_native (PIN) ログインは 2026-09-04 に 5値に拡張された
// (pos-auth.ts の PosStaffRole 参照)。ここでは両方を受け入れる union にしておく。
export type AuthenticatedStaff = {
  id: string;
  display_name: string;
  role: 'owner' | 'manager' | 'staff' | 'sub_manager' | 'employee' | 'part_time';
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
