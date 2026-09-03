# ローカル印刷エージェント セットアップ手順 (Mac)

レジ画面 (クラウド) から、店舗のプリンターへ直接印刷することはできません。代わりに、
プリンターの近くにある Mac (レジPCなど) でこの `agent.mjs` を常駐させておくと、クラウド側の
印刷キューを取りに来て実際に印刷してくれます。

**この `agent.mjs` は「店舗に常時稼働のPC/中継機がある」場合の方式です。店舗にPCが無く、
iPad・Androidタブレット・スマホしか無い場合は、このファイル全体が不要です。代わりに
下記「0. 店舗にPCが無い場合: PassPRNT方式」を読んでください。**

## 0. 店舗にPCが無い場合: PassPRNT方式 (中継機不要・推奨) (2026-09-03 追加)

Star Micronics純正の無料アプリ「PassPRNT」を使うと、中継用のPC/mini-PCを一切用意せずに、
レジで使っているタブレット/スマホ自体からBluetoothプリンターへ直接印刷できます。この
`print-agent` (agent.mjs) は使いません。

1. レジとして使う端末 (iPad または Android タブレット) に、App Store / Google Playから
   無料アプリ「**PassPRNT**」(Star Micronics製) をインストールする。
2. プリンター本体の電源を入れ、Bluetoothペアリングモードにする (TSP650IIシリーズは背面の
   ペアリングボタン長押し、または初回起動時に自動でペアリング待受け状態になることが多いです。
   付属マニュアルを確認してください)。
3. **レジ端末側**の「設定」アプリ→「Bluetooth」で、プリンターとペアリングする
   (iPad/iPhone/Android共通、OS標準のBluetooth設定画面でOK)。
4. PassPRNTアプリを一度開き、アプリ内の設定でペアリングしたプリンターを選択しておく。
5. POSの設定画面 → プリンター設定 → プリンター追加で、接続方法に
   「Bluetooth接続 (レジ端末に直接ペアリング・中継機不要)」を選択する (追加の入力項目は無い)。
6. 「テスト印刷」ボタンを押すと、この端末上でPassPRNTアプリへ自動的に切り替わり、印刷後に
   ブラウザへ戻ります。初回はOSから「PassPRNTで開きますか?」のような確認が出ることがあります。

**注意**:
- ブラウザとプリンターは**同一端末**である必要があります (レジとして使っているその端末を
  直接ペアリングしてください。別の端末からは印刷できません)。
- iPad/iPhone (iOS Safari) はブラウザから直接Bluetoothプリンターへ印刷する機能 (Web Bluetooth)
  に対応していませんが、PassPRNTはネイティブアプリなのでこの制約を受けません。
- 印刷後、PassPRNTからブラウザへ自動的に戻りますが、戻らない場合は手動でSafari/Chromeへ
  切り替えてください。
- 実機での動作確認 (実際のペアリング・印刷) はまだ行っていません。初回導入時は「テスト印刷」で
  必ず動作確認してください。うまくいかない場合は、PassPRNTアプリ内の設定でプリンターが
  正しく選択されているか、ペアリングが有効かを確認してください。

## 1. (中継PC方式) 事前準備: プリンターを Mac に「プリンター」として登録する

添付いただいた `mPOS M502` (USB接続・58mm・ESC/POS対応) の場合:

1. プリンターを Mac に USB接続する
2. 「システム設定」→「プリンタとスキャナ」→「＋」で追加
   - ドライバーが自動認識されない場合は「汎用 PostScript プリンタ」または「AirPrint」ではなく
     **「Generic」「テキストのみ」系のドライバー** を選ぶ (レシートプリンターはPDF系ドライバーだと
     正しく印刷できないことが多いです)。認識されない場合はメーカーの macOS 用ドライバーが
     配布されていないか確認してください。
3. 追加できたら、ターミナルで登録名を確認します:
   ```
   lpstat -p
   ```
   表示された名前 (例: `M502_Thermal_Receipt_Printer`) を、POSの設定画面 → プリンター設定 →
   プリンター追加時の「エージェント側のプリンターキュー名」に入力してください。
4. 動作確認:
   ```
   echo "test" | lp -d <上で確認した名前> -o raw
   ```
   これで紙が出れば OK です。

キッチンプリンターが LAN接続の機種であれば、この手順は不要です (店舗Wi-Fi/LANのIPアドレスを
POSの設定画面でそのまま入力するだけで、エージェントが直接そのIPへ送信します)。

## 1b. Bluetoothプリンター (例: Star TSP650II Bluetoothモデル) を使う場合 (2026-09-03 追加)

有線工事なしでレジ周りを組みたい場合の構成です。プリンター本体とレジのタブレット (iPad/Android)
を直接Bluetooth接続するのではなく、**プリンターの近くに置いた中継用のMac/PC (この
`agent.mjs` を常駐させる機械) とプリンターをペアリングし**、レジのタブレットは今まで通り
クラウド (Vercel) と通信するだけにする方式です。レジタブレット自体はプリンターの存在を
意識しません。

1. プリンター本体の電源を入れ、Bluetoothペアリングモードにする (機種によって手順が異なります。
   TSP650IIシリーズは背面のペアリングボタン長押し、または初回起動時に自動でペアリング待受け
   状態になることが多いです。付属マニュアルを確認してください)。
2. 中継用Macで「システム設定」→「Bluetooth」を開き、一覧に出てきたプリンター名を選んで
   ペアリングする。
3. ペアリングが成功すると、OSがそのプリンターを「シリアルポート (デバイスファイル)」として
   割り当てます。ターミナルで確認します:
   ```
   ls /dev/tty.* /dev/cu.*
   ```
   プリンター名に近いもの (例: `/dev/tty.TSP650II` や `/dev/cu.TSP650II-SPPDev` 等) が
   増えているはずです。この**フルパス**を、POSの設定画面 → プリンター設定 → プリンター追加時の
   「ペアリング後にOSが割り当てるデバイスパス」欄にそのまま入力してください (接続方法は
   「Bluetooth接続」を選択)。
4. 動作確認 (ターミナルで直接):
   ```
   echo "test" > /dev/tty.TSP650II
   ```
   (↑実際のパスに置き換えてください。この時、プリンターの電源が入っておりペアリングが有効な
   状態である必要があります。) これで何か紙が出れば OK です。何も出ない場合は `/dev/tty.*` では
   なく `/dev/cu.*` の方を試してください (macOSはペアリング1台につき2つのデバイスファイルを
   作ることがあり、印刷にはどちらか片方しか使えないことがあります)。
5. 設定画面のプリンター登録が終わったら、通常通り (3節以降) エージェントを起動してください。

**Windows を中継機にする場合**: ペアリング後は `COM5` のような COM ポート名が割り当てられます。
この `agent.mjs` は標準ではCOMポートに書き込めないため、`print-agent` フォルダで
`npm install serialport` を実行してから使ってください (未インストールのまま Bluetooth
プリンターへ印刷しようとすると、その旨のエラーメッセージがログに出ます)。

## 2. Node.js が入っているか確認

```
node -v
```

`v18` 以上でなければ https://nodejs.org からインストールしてください。

## 3. POSの設定画面でトークンを発行

POS → 設定 → プリンター設定 タブを開き、「トークンを発行」を押してトークンをコピーします。
同じ画面でプリンター (レシート印刷・キッチン印刷) を登録してください。

## 4. エージェントを起動する

このフォルダ (`print-agent/`) をターミナルで開き:

```
POS_API_BASE=https://cambodia-pos.vercel.app \
POS_AGENT_TOKEN=<設定画面でコピーしたトークン> \
node agent.mjs
```

起動すると、登録済みプリンターの一覧がターミナルに表示されます。この状態で注文を確定・会計
すると、数秒以内にレシート/厨房伝票が印刷されるはずです。設定画面の「テスト印刷」ボタンでも
確認できます。

## 5. Mac起動時に自動で立ち上がるようにする (任意)

ターミナルを開いたままにしておく必要がないよう、launchd に登録する方法です。

1. `~/Library/LaunchAgents/com.matsunoya.print-agent.plist` を作成し、以下を貼り付けます
   (`<フルパス>` はこのフォルダの実際のパスに、トークンは実際のものに書き換えてください):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.matsunoya.print-agent</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/node</string>
    <string>&lt;フルパス&gt;/print-agent/agent.mjs</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>POS_API_BASE</key>
    <string>https://cambodia-pos.vercel.app</string>
    <key>POS_AGENT_TOKEN</key>
    <string>ここにトークンを貼る</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/tmp/print-agent.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/print-agent.error.log</string>
</dict>
</plist>
```

   `node` のフルパスは `which node` で確認してください。

2. 読み込み:
   ```
   launchctl load ~/Library/LaunchAgents/com.matsunoya.print-agent.plist
   ```

以降、この Mac を再起動してもエージェントが自動で立ち上がります。

## 注意: 日本語(漢字)の印字について

安価な感熱レシートプリンターは、機種によっては ASCII (英数字) しか印字できず、漢字・ひらがな・
カタカナが文字化けすることがあります。まずはテスト印刷で確認してください。文字化けする場合は、
レシート・厨房伝票の文言を英数字中心に変更する対応が必要になります (お知らせください)。
