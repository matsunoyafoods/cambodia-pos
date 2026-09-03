#!/usr/bin/env node
/**
 * Cambodia POS ローカル印刷エージェント (2026-08-31 追加)。
 *
 * POS レジ画面は Vercel (クラウド) 上で動いているため、店舗LAN内のプリンターへ直接は
 * 印刷できません。このスクリプトを店舗のPC (プリンターに一番近い/USB接続されているPC) で
 * 常駐起動しておくと、クラウド側のジョブキュー (/api/print-agent/jobs) を数秒おきに見に行き、
 * 溜まった印刷ジョブを実際のプリンターに送ります。
 *
 * 必要なもの:
 *   - Node.js 18 以上 (global fetch を使用)
 *   - USB接続のプリンター: 事前に OS のプリンタードライバーとして追加しておくこと
 *       (macOS: システム設定 > プリンタとスキャナ で追加。キュー名は `lpstat -p` で確認できる)
 *   - LAN接続のプリンター: IPアドレスとポート (通常 9100) が分かっていること
 *
 * 使い方:
 *   POS_API_BASE=https://cambodia-pos.vercel.app \
 *   POS_AGENT_TOKEN=<設定画面で発行したトークン> \
 *   node agent.mjs
 *
 * 常駐させるには launchd (macOS) や pm2 などを使ってください (README.md 参照)。
 */

import { spawn } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs';

const API_BASE = process.env.POS_API_BASE;
const TOKEN = process.env.POS_AGENT_TOKEN;
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || '4000', 10);
const PRINTERS_REFRESH_MS = 60_000;

if (!API_BASE || !TOKEN) {
  console.error('POS_API_BASE と POS_AGENT_TOKEN の環境変数を設定してください。');
  process.exit(1);
}

/** @type {Map<string, any>} printerId -> printer config */
let printerMap = new Map();
let lastPrintersRefresh = 0;

async function apiFetch(path, init) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`${path} -> ${res.status} ${body}`);
  }
  return res.json();
}

async function refreshPrinters() {
  const { printers } = await apiFetch('/api/print-agent/printers');
  printerMap = new Map(printers.map((p) => [p.id, p]));
  lastPrintersRefresh = Date.now();
  console.log(`[print-agent] プリンター設定を取得: ${printers.length}台`);
  for (const p of printers) {
    console.log(`  - ${p.name} (${p.role} / ${p.connectionType}${p.connectionType === 'lan' ? ' ' + p.lanIp + ':' + p.lanPort : ' ' + (p.deviceName ?? '(キュー名未設定)')})`);
  }
}

// テキスト (+ 任意でロゴのラスタービットイメージ) を ESC/POS の初期化 + 用紙カットコマンドで
// 包んで Buffer にする。日本語(漢字)はプリンターのフォント/コードページによって印字できない
// 場合があります (安価な感熱プリンターは ASCII のみ対応のことが多い) — その場合はテスト印刷で
// 文字化けを確認の上、レシート文言を英数字中心に変更することを検討してください。
//
// logoBase64 (2026-08-31 追加) は receipt-format.ts 側では組み立てられない生バイナリの
// ラスターコマンドなので、テキスト本文 (UTF-8) とは別に base64 のまま受け取り、ここで
// Buffer.from(..., 'base64') に戻してテキストの前に差し込む。UTF-8 経由で結合すると
// 画像バイトが壊れるため、文字列連結ではなく Buffer.concat で扱う必要がある。
function toEscPos(text, logoBase64) {
  const ESC_INIT = Buffer.from([0x1b, 0x40]); // ESC @
  const logo = logoBase64 ? Buffer.from(logoBase64, 'base64') : Buffer.alloc(0);
  const body = Buffer.from(text + '\n\n\n', 'utf8');
  const CUT = Buffer.from([0x1d, 0x56, 0x00]); // GS V 0 (full cut)
  return Buffer.concat([ESC_INIT, logo, body, CUT]);
}

function printViaLan(ip, port, data) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: ip, port: port || 9100, timeout: 8000 }, () => {
      socket.write(data, (err) => {
        if (err) return reject(err);
        socket.end();
      });
    });
    socket.on('error', reject);
    socket.on('timeout', () => {
      socket.destroy();
      reject(new Error('LAN print timeout'));
    });
    socket.on('close', () => resolve());
  });
}

function printViaUsbAgent(deviceName, data) {
  return new Promise((resolve, reject) => {
    if (!deviceName) {
      reject(new Error('device_name (プリンターキュー名) が設定されていません'));
      return;
    }
    // macOS/Linux の CUPS 経由 (`lp -d <queue> -o raw`)。Windows で運用する場合は
    // 別途 `SumatraPDF -print-to` 等への差し替えが必要です (README.md 参照)。
    const proc = spawn('lp', ['-d', deviceName, '-o', 'raw']);
    let stderr = '';
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`lp exited with code ${code}: ${stderr}`));
    });
    proc.stdin.write(data);
    proc.stdin.end();
  });
}

// Bluetooth接続 (2026-09-03 追加)。有線工事なしでレジ運用したい店舗向け。プリンターとこの
// エージェントが動くPC/中継機をあらかじめOSのBluetooth設定でペアリングしておくと (SPPプロファイル)、
// OSがそのプリンターを「シリアルポート/デバイスファイル」として割り当てる。以後は普通のファイルの
// ように生バイト列を書き込むだけで印刷できる (macOS/Linuxの場合。ペアリング手順は README.md 参照)。
//   例: macOS → /dev/tty.TSP650II , /dev/cu.TSP650II
//       Linux (rfcomm) → /dev/rfcomm0
// Windows は上記のようなデバイスファイルが無く、ペアリング後に割り当てられる COM ポート
// (例: COM5) へは Node 標準のファイルAPIでは書き込めないため、`serialport` パッケージが
// 別途必要 (未インストールなら Windows 環境でのみエラーになる。README.md 参照)。
function printViaBluetoothAgent(devicePath, data) {
  return new Promise((resolve, reject) => {
    if (!devicePath) {
      reject(new Error('device_name (ペアリング後のデバイスパス) が設定されていません'));
      return;
    }
    if (/^com\d+$/i.test(devicePath.trim())) {
      // Windows の COM ポート: serialport パッケージが入っていれば使う。
      import('serialport')
        .then(({ SerialPort }) => {
          const port = new SerialPort({ path: devicePath, baudRate: 9600 }, (err) => {
            if (err) return reject(err);
          });
          port.write(data, (err) => {
            if (err) return reject(err);
            port.drain((err2) => {
              port.close();
              if (err2) reject(err2);
              else resolve();
            });
          });
        })
        .catch(() => {
          reject(
            new Error(
              `Windows で COM ポート (${devicePath}) へ印刷するには 'npm install serialport' が必要です (print-agent フォルダ内で実行してください)`,
            ),
          );
        });
      return;
    }
    // macOS/Linux: ペアリング済みのデバイスファイルへ生バイトをそのまま書き込む。
    fs.writeFile(devicePath, data, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

async function processJob(job) {
  const printer = printerMap.get(job.printerId);
  if (!printer) {
    console.warn(`[print-agent] ジョブ ${job.id}: 対応するプリンター設定が見つかりません (無効化されている可能性)。スキップします。`);
    return;
  }
  const data = toEscPos(job.content, job.logoBase64);
  try {
    if (printer.connectionType === 'lan') {
      await printViaLan(printer.lanIp, printer.lanPort, data);
    } else if (printer.connectionType === 'bluetooth') {
      await printViaBluetoothAgent(printer.deviceName, data);
    } else {
      await printViaUsbAgent(printer.deviceName, data);
    }
    await apiFetch(`/api/print-agent/jobs/${job.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'printed' }),
    });
    console.log(`[print-agent] ジョブ ${job.id} (${printer.name}) 印刷完了`);
  } catch (err) {
    console.error(`[print-agent] ジョブ ${job.id} (${printer.name}) 印刷失敗:`, err.message);
    await apiFetch(`/api/print-agent/jobs/${job.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'failed', errorMessage: String(err.message).slice(0, 500) }),
    }).catch(() => {});
  }
}

async function tick() {
  try {
    if (Date.now() - lastPrintersRefresh > PRINTERS_REFRESH_MS) {
      await refreshPrinters();
    }
    const { jobs } = await apiFetch('/api/print-agent/jobs');
    for (const job of jobs) {
      await processJob(job);
    }
  } catch (err) {
    console.error('[print-agent] ポーリングエラー:', err.message);
  }
}

async function main() {
  console.log(`[print-agent] 起動しました (API: ${API_BASE}, ポーリング間隔: ${POLL_INTERVAL_MS}ms)`);
  await refreshPrinters().catch((err) => console.error('[print-agent] 初回プリンター取得に失敗:', err.message));
  setInterval(tick, POLL_INTERVAL_MS);
  tick();
}

main();
