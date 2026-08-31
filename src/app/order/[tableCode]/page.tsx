import { QrOrderApp } from '@/components/pos/qr-order-app';

// QRセルフオーダーの公開ページ (2026-08-31 追加)。/pos/* と違い src/app/pos/layout.tsx
// (StaffGate、PIN ログイン必須) の配下に置かないことで、認証なしでお客様がアクセスできる
// ようにしている。QRコードはテーブルごとに `https://<本番URL>/order/<卓コード>` を指す。
type Props = { params: Promise<{ tableCode: string }> };

export default async function OrderPage({ params }: Props) {
  const { tableCode } = await params;
  return <QrOrderApp tableCode={decodeURIComponent(tableCode)} />;
}
