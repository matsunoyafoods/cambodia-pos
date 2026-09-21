/**
 * WebUSBプリンター (2026-09-21 追加)。
 *
 * レジ端末がiPadではなくAndroid (Chrome) の場合、`print-agent`用の中継PCを用意しなくても、
 * ブラウザから直接USB接続のESC/POSレシートプリンターに印刷できる (WebUSB API)。
 * 対応状況: Android Chrome ◯ / デスクトップChrome・Edge ◯ / iOS Safari・iPadOS Safari ×
 * (iOSはWebUSB自体に非対応。iOSでUSBプリンターを使いたい場合は usb_agent 方式で中継PC/Macが必要)。
 *
 * 運用の流れ:
 *   1. 設定画面の「USBペアリング」ボタン (ユーザー操作からの呼び出しが必須) で
 *      requestWebUsbPrinterPairing() を呼び、ブラウザ標準のデバイス選択ダイアログでプリンターを
 *      選択してもらう。選ばれたプリンターの vendorId:productId を printers.device_name に保存する
 *      (bluetooth方式がデバイスパスを deviceName に流用しているのと同じ考え方)。
 *   2. 一度許可されたデバイスは、ブラウザ (Chrome) がオリジン単位で許可を記憶するため、以後は
 *      ユーザー操作なしで navigator.usb.getDevices() から同じデバイスを取得できる。会計時の
 *      自動印刷はこちらを使う。
 *   3. 実際の印字データ (ESC/POSの生バイト列) はサーバー側 (escpos-frame.ts) で組み立て、
 *      base64でクライアントへ渡す。ここではそれをUSBのOUTエンドポイントへ書き込むだけ。
 *
 * TypeScriptの標準dom型定義にWebUSBの型が含まれていないため、使用する範囲だけ最小限の
 * アンビエント型をここで宣言する。
 */

interface USBEndpoint {
  endpointNumber: number;
  direction: 'in' | 'out';
}

interface USBAlternateInterface {
  endpoints: USBEndpoint[];
}

interface USBInterface {
  interfaceNumber: number;
  alternates: USBAlternateInterface[];
}

interface USBConfiguration {
  interfaces: USBInterface[];
}

interface USBOutTransferResult {
  status: 'ok' | 'stall' | 'babble';
  bytesWritten: number;
}

interface USBDevice {
  vendorId: number;
  productId: number;
  productName?: string | null;
  configuration: USBConfiguration | null;
  open(): Promise<void>;
  close(): Promise<void>;
  selectConfiguration(configurationValue: number): Promise<void>;
  claimInterface(interfaceNumber: number): Promise<void>;
  releaseInterface(interfaceNumber: number): Promise<void>;
  transferOut(endpointNumber: number, data: Uint8Array): Promise<USBOutTransferResult>;
}

interface USBDeviceRequestOptions {
  filters: { vendorId?: number; productId?: number }[];
}

interface USB {
  requestDevice(options: USBDeviceRequestOptions): Promise<USBDevice>;
  getDevices(): Promise<USBDevice[]>;
}

declare global {
  interface Navigator {
    usb?: USB;
  }
}

export function isWebUsbSupported(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.usb;
}

function hex4(n: number): string {
  return n.toString(16).padStart(4, '0');
}

/** printers.device_name に保存する形式 (例: "0519:0001") を組み立てる。 */
export function formatWebUsbDeviceName(vendorId: number, productId: number): string {
  return `${hex4(vendorId)}:${hex4(productId)}`;
}

/** printers.device_name (例: "0519:0001") から vendorId/productId を取り出す。不正な形式は null。 */
export function parseWebUsbDeviceName(deviceName: string | null | undefined): { vendorId: number; productId: number } | null {
  if (!deviceName) return null;
  const m = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(deviceName.trim());
  if (!m) return null;
  return { vendorId: parseInt(m[1], 16), productId: parseInt(m[2], 16) };
}

function requireWebUsb(): USB {
  if (!isWebUsbSupported()) {
    throw new Error('このブラウザはWebUSBに対応していません (Android版Chromeでのみ利用できます。iPad/iPhoneのSafariは非対応です)');
  }
  return navigator.usb as USB;
}

// 設定画面の「USBペアリング」ボタンから呼ぶ。必ずクリック等のユーザー操作の中で (await を挟まず)
// 呼び出すこと。ブラウザ標準のデバイス選択ダイアログが出る。
export async function requestWebUsbPrinterPairing(): Promise<{ deviceName: string; productName: string | null }> {
  const usb = requireWebUsb();
  const device = await usb.requestDevice({ filters: [] });
  return { deviceName: formatWebUsbDeviceName(device.vendorId, device.productId), productName: device.productName ?? null };
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// ペアリング済みのUSBプリンターへ、ESC/POSの生バイト列 (base64) をそのまま書き込む。
// デバイスが見つからない (ペアリングが切れている/別のデバイスを選び直した等) 場合はエラーを投げる。
export async function printWebUsbEscPos(vendorId: number, productId: number, dataBase64: string): Promise<void> {
  const usb = requireWebUsb();
  const devices = await usb.getDevices();
  const device = devices.find((d) => d.vendorId === vendorId && d.productId === productId);
  if (!device) {
    throw new Error('プリンターとペアリングされていません。設定画面で「USBペアリング」をやり直してください。');
  }

  await device.open();
  try {
    if (device.configuration === null) {
      await device.selectConfiguration(1);
    }
    const iface = device.configuration?.interfaces.find((i) =>
      i.alternates.some((alt) => alt.endpoints.some((ep) => ep.direction === 'out')),
    );
    if (!iface) {
      throw new Error('このプリンターに書き込み用のUSB口が見つかりませんでした');
    }
    const alt = iface.alternates.find((a) => a.endpoints.some((ep) => ep.direction === 'out')) ?? iface.alternates[0];
    const endpoint = alt.endpoints.find((ep) => ep.direction === 'out');
    if (!endpoint) {
      throw new Error('このプリンターに書き込み用のUSB口が見つかりませんでした');
    }
    await device.claimInterface(iface.interfaceNumber);
    try {
      await device.transferOut(endpoint.endpointNumber, base64ToBytes(dataBase64));
    } finally {
      await device.releaseInterface(iface.interfaceNumber).catch(() => {});
    }
  } finally {
    await device.close().catch(() => {});
  }
}
