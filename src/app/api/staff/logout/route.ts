import { NextResponse } from 'next/server';
import { clearStaffSessionCookie } from '@/lib/pos-auth';

export async function POST() {
  await clearStaffSessionCookie();
  return NextResponse.json({ ok: true });
}
