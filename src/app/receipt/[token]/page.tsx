import { ReceiptApp } from '@/components/pos/receipt-app';

// お客様向け注文明細・レシートの公開ページ (2026-10-06 追加。QR+ABA決済フロー フェーズ1)。
// /order/[tableCode] と同じ理由で src/app/pos/layout.tsx (StaffGate、PIN ログイン必須) の
// 配下に置かず、認証なしでお客様がアクセスできるようにしている。URLは生の注文IDではなく
// checkout-qr/route.ts が発行する推測困難なトークンを使う。
type Props = { params: Promise<{ token: string }> };

export default async function ReceiptPage({ params }: Props) {
  const { token } = await params;
  return <ReceiptApp token={decodeURIComponent(token)} />;
}
