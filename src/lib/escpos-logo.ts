/**
 * 店舗ロゴ画像 (PNG) を、感熱プリンター (ESC/POS) のラスタービットイメージコマンド
 * (GS v 0) に変換する (2026-08-31 追加。「レシートや領収書にロゴ印刷できるようにしたい」)。
 *
 * receipt-format.ts が組み立てる本文は UTF-8 テキストとしてそのままエージェントへ送るが、
 * 画像バイトは UTF-8 経由だと壊れる (0x80 以上のバイト値が文字コードとして再エンコードされて
 * しまう) ため、ここで作るラスターコマンドは base64 にして pos.print_jobs.logo_base64 に
 * 別列で保存し、エージェント側で Buffer.from(base64, 'base64') として生のバイト列に戻して
 * 印字前に送る (print-agent/agent.mjs 側の変更とセット)。
 */

import { PNG } from 'pngjs';

/** 用紙幅(mm)から、ロゴ印刷に使う目標ピクセル幅を概算する (58mm≒384dot、80mm≒576dot)。 */
export function targetLogoWidthPx(paperWidthMm: number): number {
  return paperWidthMm >= 70 ? 576 : 384;
}

// PNGのRGBA画素を単純な輝度しきい値で1bit(白黒)に変換する。ロゴ画像は大抵くっきりした
// 単色ロゴなので、ディザリングまでは行わず閾値だけで十分な見た目になる。
function luminance(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

// 元画像を targetWidthPx 以下に最近傍法で縮小する (拡大はしない — ロゴが不必要に
// 粗くなるのを避けるため。目標幅より小さい画像はそのまま使う)。
function resizeNearest(
  src: Uint8Array,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): Uint8Array {
  const dst = new Uint8Array(dstW * dstH * 4);
  for (let y = 0; y < dstH; y++) {
    const sy = Math.min(srcH - 1, Math.floor((y * srcH) / dstH));
    for (let x = 0; x < dstW; x++) {
      const sx = Math.min(srcW - 1, Math.floor((x * srcW) / dstW));
      const si = (sy * srcW + sx) * 4;
      const di = (y * dstW + x) * 4;
      dst[di] = src[si];
      dst[di + 1] = src[si + 1];
      dst[di + 2] = src[si + 2];
      dst[di + 3] = src[si + 3];
    }
  }
  return dst;
}

/**
 * PNG (base64、data:URLプレフィックス無し) を ESC/POS の GS v 0 ラスターコマンドに変換し、
 * コマンド全体 (センタリング指定込み) を base64 で返す。変換に失敗した場合は null を返す
 * (呼び出し側はロゴ無しで印字を続行してよい)。
 */
export function pngBase64ToEscPosRasterBase64(pngBase64: string, paperWidthMm: number): string | null {
  try {
    const buf = Buffer.from(pngBase64, 'base64');
    const png = PNG.sync.read(buf);
    const targetW = targetLogoWidthPx(paperWidthMm);

    let { width, height } = png;
    let data: Uint8Array = png.data;
    if (width > targetW) {
      const targetH = Math.max(1, Math.round((height * targetW) / width));
      data = resizeNearest(data, width, height, targetW, targetH);
      width = targetW;
      height = targetH;
    }

    // ラスターイメージは横幅を8の倍数(1バイト=8ドット)に切り上げる必要がある。
    const widthBytes = Math.ceil(width / 8);
    const paddedWidth = widthBytes * 8;
    const imageBytes = Buffer.alloc(widthBytes * height, 0);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < paddedWidth; x++) {
        if (x >= width) continue; // パディング部分は白のまま
        const si = (y * width + x) * 4;
        const r = data[si];
        const g = data[si + 1];
        const b = data[si + 2];
        const a = data[si + 3];
        // 透明部分は「白 (印字しない)」扱い。不透明かつ暗い画素だけ黒として印字する。
        const isBlack = a > 64 && luminance(r, g, b) < 160;
        if (isBlack) {
          const byteIndex = y * widthBytes + (x >> 3);
          const bitIndex = 7 - (x & 7);
          imageBytes[byteIndex] |= 1 << bitIndex;
        }
      }
    }

    const header = Buffer.from([
      0x1d, 0x76, 0x30, 0x00, // GS v 0 m(=0, normal)
      widthBytes & 0xff, (widthBytes >> 8) & 0xff,
      height & 0xff, (height >> 8) & 0xff,
    ]);
    const CENTER_ON = Buffer.from([0x1b, 0x61, 0x01]); // ESC a 1 (中央揃え)
    const CENTER_OFF = Buffer.from([0x1b, 0x61, 0x00]); // ESC a 0 (左揃えに戻す)
    const LF = Buffer.from([0x0a]);

    return Buffer.concat([CENTER_ON, header, imageBytes, LF, CENTER_OFF]).toString('base64');
  } catch {
    return null;
  }
}
