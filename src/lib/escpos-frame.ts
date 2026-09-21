/**
 * ESC/POSの生バイト列 (初期化 + 本文 + 用紙カット) を組み立てる (2026-09-21 追加、WebUSB直接
 * 印刷方式向け)。ロジックは print-agent/agent.mjs の toEscPos() と完全に同じにしてある
 * (中継PC方式と挙動を揃えるため。どちらかだけ直した場合は両方直すこと)。
 *
 * usb_agent/lan/bluetooth (中継PC方式) は content (テキスト) + logo_base64 を print_jobs に
 * 積んで、agent.mjs 側でこの変換をしている。webusb (このファイル) はブラウザから直接書き込む
 * ため、サーバー側であらかじめ生バイト列に変換してbase64で返す。
 */
export function buildEscPosFrame(text: string, logoBase64?: string | null): Buffer {
  const ESC_INIT = Buffer.from([0x1b, 0x40]); // ESC @
  const logo = logoBase64 ? Buffer.from(logoBase64, 'base64') : Buffer.alloc(0);
  const body = Buffer.from(text + '\n\n\n', 'utf8');
  const CUT = Buffer.from([0x1d, 0x56, 0x00]); // GS V 0 (full cut)
  return Buffer.concat([ESC_INIT, logo, body, CUT]);
}
