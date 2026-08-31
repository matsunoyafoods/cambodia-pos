# ローカル印刷エージェント セットアップ手順 (Mac)

レジ画面 (クラウド) から、店舗のプリンターへ直接印刷することはできません。代わりに、
プリンターの近くにある Mac (レジPCなど) でこの `agent.mjs` を常駐させておくと、クラウド側の
印刷キューを取りに来て実際に印刷してくれます。

## 1. 事前準備: プリンターを Mac に「プリンター」として登録する

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
