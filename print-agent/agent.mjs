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

// テキストを ESC/POS の初期化 + 用紙カットコマンドで包んで Buffer にする。
// 日本語(漢字)はプリンターのフォント/コードページによって印字できない場合があります
// (安価な感熱プリンターは ASCII のみ対応のことが多い) — その場合はテスト印刷で文字化けを
// 確認の上、レシート文言を英数字中心に変更することを検討してください。
function toEscPos(text) {
  const ESC_INIT = Buffer.from([0x1b, 0x40]); // ESC @
  const body = Buffer.from(text + '\n\n\n', 'utf8');
  const CUT = Buffer.from([0x1d, 0x56, 0x00]); // GS V 0 (full cut)
  return Buffer.concat([ESC_INIT, body, CUT]);
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

async function processJob(job) {
  const printer = printerMap.get(job.printerId);
  if (!printer) {
    console.warn(`[print-agent] ジョブ ${job.id}: 対応するプリンター設定が見つかりません (無効化されている可能性)。スキップします。`);
    return;
  }
  const data = toEscPos(job.content);
  try {
    if (printer.connectionType === 'lan') {
      await printViaLan(printer.lanIp, printer.lanPort, data);
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
