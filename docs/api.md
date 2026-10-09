# API契約とAI候補

調査日：2026年10月9日（日本時間）。公式ページと公式SDKソースをGETで取得。初回ネットワーク拒否後、公式ドメインを設定に追加し再取得成功。APIキー未設定、実推論0件。記載料金は変更され得るため実実行直前に再確認する。

## 公式候補比較

| 項目 | fal FASHN v1.6 | fal Nano Banana 2 Edit |
|---|---|---|
| Endpoint | `fal-ai/fashn/tryon/v1.6` | `fal-ai/nano-banana-2/edit` |
| 用途 | 試着専用 | 汎用画像編集。試着品質は未検証 |
| 公式入力 | model_image + garment_image、URL/base64 | prompt + image_urls配列 |
| 画像数 | 本人1+服1。複数着一括は不可 | 最大14参照、今回本人1+服13以下 |
| カテゴリ | tops/bottoms/one-pieces/auto。outerはtopsへ対応づけ、品質未確認。靴/その他は拒否 | 自然言語で指定。靴/重ね着の品質保証なし |
| 出力 | 864×1296、今回1枚jpeg/quality | 0.5K/1K/2K/4K、今回1K/jpeg/1枚 |
| 現行掲載料金 | US$0.075/生成 | US$0.08/1K画像、2K×1.5、4K×2、0.5K×0.75 |
| オプション課金 | 選択設定で要確認 | web search +US$0.015、high thinking +US$0.002。今回は両方使わない |
| 商用利用 | モデルページにCommercial use表示 | ページにCommercial use enabled表示 |
| 所要時間 | 実測なし、SLA/課金照合未確認 | ページはsecondsとの説明、実測/p95未確認 |
| 同時複数着の比較 | 同一単品入力の共通サブセットのみ | 60ケースの主候補、未採用確定 |

商用表示は規約・写真利用許諾・下流事業者条件の全確認を意味しない。fal TermsはCustomer Inputをサービス提供目的で処理する許諾とUsage Dataの利用を定める。Privacy Policyの一般的な保存説明だけで「写真を学習に一切使わない」と断言しない。fal/FASHN/Google各経路の学習/保持/地域/削除条件を運営者が実送信前に確認する。未確認は `LIVE_TERMS_REVIEWED=false` のまま。

保持：公式Data Retentionはrequest JSONの標準30日、通常CDN URLはリンクを知る人が閲覧可能、media期限は設定可能。実装は入力をJPEGデータURIで送信（SDK public upload不使用）、`X-Fal-Store-IO: 0`、`X-Fal-Object-Lifecycle-Preference` の1時間+default forbid、`sync_mode:true` によるデータURI出力を指定。指定の実効性は未検証。ACLはfal CDN v3だけに適用され、FASHN等外部CDNを保護しない。結果が非許可外部CDNなら取得を拒否し課金を保留する。

出力が `v3b.fal.media` の場合だけ短期CDNトークンへ交換してBearer取得するコードを用意。秘密鍵・CDNトークン・外部URLをブラウザ/ログ/DBへ出さない。戻りURLでローカルIPや任意hostをfetchしない。

### 出典

- [FASHN API](https://fal.ai/models/fal-ai/fashn/tryon/v1.6/api)、[モデル/料金](https://fal.ai/models/fal-ai/fashn/tryon/v1.6)
- [Nano Edit API](https://fal.ai/models/fal-ai/nano-banana-2/edit/api)、[モデル/料金/14参照](https://fal.ai/models/fal-ai/nano-banana-2/edit)
- [非同期キュー](https://docs.fal.ai/model-apis/model-endpoints/queue)
- [保持](https://docs.fal.ai/model-apis/model-endpoints/storage)、[ACLとtoken](https://docs.fal.ai/documentation/model-apis/file-access-controls)
- [課金](https://docs.fal.ai/documentation/model-apis/pricing)：成功出力に課金、server error/queue waitには課金しないと記載。通信断は成功の有無が不明なので保留。
- [Terms](https://fal.ai/terms)、[Privacy](https://fal.ai/privacy)
- [公式fal-js型](https://github.com/fal-ai/fal-js/blob/main/libs/client/src/types/endpoints.ts)、[queue実装](https://github.com/fal-ai/fal-js/blob/main/libs/client/src/queue.ts)

## Providerインターフェース

`capabilities / validateInputs / estimateMaxCost / submit / getStatus / cancel`。Mockは外部通信なし、元写真を返し費用0。Falはサーバーのみ、POST自動再送なし、read-only pollingを繰り返す。公式スキーマから実装した候補であり、実接続確認済みとはしない。cancelが受理されても実行停止/無課金を保証しない。

## Phase A内部API

すべてloopback Host限定、変更系は同一Originのみ。サーバーが固定運営者ownerを設定する。公開認証APIとして使用しない。通常JSONは `{data,error,code,requestId}`、画像成功だけバイナリ。

| API | 入出力 |
|---|---|
| GET /api/config | Provider・同意版・公開可能な上限設定。鍵なし |
| POST /api/uploads?kind=person/garment | raw画像binary、Content-Type必須。再エンコード後のasset UUID。201 |
| GET /api/images/:id | 所有者/期限確認後JPEG。DBパス・外部URLを返さない |
| POST /api/tryon | personId、items[{assetId,category,layer}]、idempotencyKey、consent=true、layersConfirmed=true、実API時liveConsentVersion。202+jobId |
| GET /api/tryon/:id | 状態、モデル・prompt版、入力順、最大見積/実費、結果ID、時間 |
| PATCH /api/tryon/:id | queuedのみ取消・予約解放。実行済み409 |
| DELETE /api/tryon/:id | 即非表示、写真・評価削除、費用は残す |
| GET /api/history | 最新100件。Phase Aはページング未実装 |
| POST /api/feedback | 成功jobのみ、3スコア1〜5、役立ち度、重大欠落、タグ、コメント、caseId、split、evaluator |
| GET /api/metrics | provider別の件数/費用/成功分p95、mock除外評価、holdout別分母 |
| GET /api/export | 画像/コメント/鍵/署名URLなしの記録JSON。UIでCSVエスケープして保存 |

同意・カテゴリ・重ね順・UUID・画像実体を検証。入力422/サイズ413/形式415、所有外404、Origin/Host403、冪等409、上限429、停止503。エラーに外部payloadや写真は含めない。利用者認証401はMVPで実装予定。今回クレジット台帳/checkout/webhook/招待は未実装。

PoCレート制限はWebプロセス単位でupload60件/分、tryon30件/分。再起動でリセットされる補助制限で、MVPでは永続・利用者単位の制限が必要。実費/件数の承認上限は別途DBで永続制御し再起動で消えない。
