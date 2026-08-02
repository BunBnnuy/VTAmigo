export default {
  login: {
    logIn: "Twitchでログイン",
    title: "{chat}を絶対に見逃さないAI共同配信者。",
    titleChat: "チャット",
    subtitle: "VTAmigoはTwitchチャットを読み取り、声で返信し、アバターをアニメーションさせます — 静かな時間でも、配信には常に話し相手がいます。",
    cta: "Twitchでログインして始める",
    ctaNote: "無料でお試しいただけます — クレジットカード不要。",
    footer: "VTAmigoは、既存のTwitchおよびVTube Studioの設定と一緒に動作します。",
    features: {
      chat: {
        title: "チャットをリアルタイムで読む",
        desc: "Twitchチャットのメッセージをまとめて、文脈に沿った気の利いた返信をします — チャットの内容をただ繰り返すだけではありません。",
      },
      tts: {
        title: "TTSで声で返信",
        desc: "返信は即座に読み上げられるので、共同配信者が本当に配信の一員のように聞こえます。",
      },
      overlay: {
        title: "OBSアバターオーバーレイをアニメーション",
        desc: "OBSにBrowser Sourceを追加するだけで、TTSに合わせてアバターが「話している」画像と「待機」画像を切り替えます — VTube Studio不要。",
      },
      events: {
        title: "イベントに反応",
        desc: "フォロー、サブスク、レイド、チアーにも即座にブランドに合った反応を返します — 手動でのトリガー不要。",
      },
      leveling: {
        title: "内蔵レベリングシステム",
        desc: "視聴者はチャットするだけでXPとレベルを獲得できます。アニメーションするXPバーとトップ視聴者ランキングをOBSにBrowser Sourceとして追加できます。",
      },
      customize: {
        title: "体験をカスタマイズ",
        desc: "ベースプロンプトを書き換えて、皮肉屋・ほのぼの系・ハイプマンなど配信の雰囲気に合わせれば、ボットの返信もそれに従います。",
      },
    },
  },

  settings: {
    title: "設定",
    cancel: "キャンセル",
    save: "保存して適用",

    language: {
      title: "言語",
      label: "インターフェース言語",
      hint: "機械翻訳です。保存するとすぐに反映されます。",
    },

    copySettings: {
      title: "設定のコピー",
      label: "すべての設定をエクスポート／インポート",
      download: "⬇️ .json をダウンロード",
      upload: "⬆️ .json をアップロード",
      hint: "設定はこのオリジンのブラウザストレージにのみ保存されるため、ローカルアプリとVPSでホストされているインスタンス間では自動的に共有されません。ここでダウンロードし、そのファイルをもう一方のインスタンスにアップロードしてください。",
      loadedOk: "✅ 設定を読み込みました — 項目を確認し、「保存して適用」を押して保存してください",
      loadedOkDroppedBackend: "✅ 設定を読み込みました（ファイルに保存されていた別ドメインのBackend URLは無視されました）— 項目を確認し、「保存して適用」を押して保存してください",
      invalidFile: "❌ 無効なファイルです: {error}",
      readError: "❌ {file} を読み込めませんでした",
    },

    tunnel: {
      title: "トンネルクライアント（別のPCからVTube Studioを使用）",
      label: "ゲストが自分のPCからVTube Studioのリップシンクを実行できるようにする",
      download: "⬇️ tunnel-client.exe をダウンロード",
      hint: "ゲストがexeを実行すると短いコードが表示され、承認済みユーザーが /device でログインして承認します。共有する鍵やパスワードは不要です。内蔵のリバーストンネルと同じ仕組みを、2台目のマシン向けに使います。",
    },

    tiktok: {
      title: "TikTok Live接続",
      label: "TikTokユーザー名",
      hint: "チャットを読み取るライブ配信のTikTokユーザー名を入力してください（APIキー不要、配信中である必要があります）。",
    },

    bot: {
      title: "ボットアカウント（チャットへ送信）",
      username: "ボットのユーザー名",
      token: "ボットのOAuthトークン",
      tokenHintPrefix: "ボットアカウント用のOAuthトークン（",
      tokenHintScope: "chat:edit",
      tokenHintMiddle: "スコープが必要）。取得先:",
      tokenHintSuffix: "ボットユーザーとしてログインした状態で取得してください。",
      autoSendHint: "自動送信は「AI Responses」の横にある💬ボタンで切り替えます（ここではありません）。レスポンスパネルから手動送信することもできます。",
    },

    ignoredUsers: {
      title: "無視するユーザー",
      label: "無視するユーザー（カンマ区切り）",
      hint: "これらのユーザーからのメッセージは大文字小文字を区別せずに黙って破棄されます。Nightbot、StreamElementsなどのボットはあらかじめ入力されています。",
    },

    overlay: {
      title: "OBSオーバーレイ — XP／レベル",
      label: "ブラウザソースURL",
      copy: "📋 コピー",
      copied: "✅ コピーしました",
      hint: "OBSのブラウザソースとして追加すると、アニメーション付きXPバーとトップ視聴者ランキングを配信画面に表示できます。このリンクはあなたのアカウント専用なので、非公開にしてください。",
    },

    avatarOverlay: {
      title: "OBSオーバーレイ — アバター（VTube Studio不要）",
      urlLabel: "ブラウザソースURL",
      copy: "📋 コピー",
      copied: "✅ コピーしました",
      urlHint: "OBSのブラウザソースとして追加してください。TTS音声再生中は「発話中」画像を、それ以外は「無音」画像を表示します。",
      speakingLabel: "アバター — 発話中",
      silentLabel: "アバター — 無音",
      upload: "画像をアップロード",
      hint: "JPEG、PNG、GIF、WebPに対応、5MBまで。新しい画像をアップロードすると前の画像を置き換えます。",
      uploading: "アップロード中…",
      tooLarge: "画像は5MB未満にしてください",
      badType: "画像はJPEG、PNG、GIF、WebPのいずれかにしてください",
      uploadError: "アップロードに失敗しました: {error}",
    },

    batching: {
      title: "バッチ処理",
      windowSize: "ウィンドウサイズ（秒）",
      maxMessages: "バッチあたりの最大メッセージ数",
      responseStyle: "応答スタイル",
      styleAuto: "自動（文脈に応じて）",
      styleChatbot: "チャットボット（チャットに直接話しかける）",
      styleNarrator: "ナレーター（実況風）",
    },

    reddit: {
      title: "Redditストーリー",
      disabled: "（現在無効）",
      enableLabel: "チャットがアイドル状態のときにストーリーを話す",
      thresholdLabel: "N回の空バッチごとにストーリーを話す",
      thresholdHint: "例: 7 = タイマーがメッセージなしで7回発火するごとに1回ストーリーを読む（ウィンドウ{window}秒の場合、約{minutes}分）。",
      subredditsLabel: "サブレディット（カンマ区切り）",
      subredditsHint: "スペイン語のテキスト投稿がある公開サブレディットのみ。",
    },

    youtube: {
      title: "YouTube Peek",
      disabled: "（現在無効）",
      enableLabel: "YouTubeタブの内容を定期的にナレーションする",
      intervalLabel: "間隔（分）",
      intervalHint: "Claudeは{interval}分ごとにYouTubeタブを確認し、見た内容をナレーションします。Claude in Chrome拡張機能が有効である必要があります。",
    },

    trivia: {
      title: "画面上の質問（トリビア）",
      disabled: "（現在無効）",
      enableLabel: "画面上の質問を検出し、チャットの助けを借りて回答する",
      captureInterval: "キャプチャ間隔（秒）",
      waitChat: "チャットを待つ時間（秒）",
      processLabel: "キャプチャするプログラム（任意）: 実行ファイル名",
      processPlaceholder: "TriviaGame.exe — 空欄の場合はメインモニター",
      processHint: "他のウィンドウの背後にあっても、そのプログラムのウィンドウのみをキャプチャします。ゲームがまだ開いていない場合は開くまで待ちます。",
      regionLabel: "キャプチャ領域（任意）: x,y,幅,高さ",
      regionPlaceholder: "0,0,1920,1080 — 空欄の場合はすべて",
      regionHint: "質問が表示される領域にキャプチャを限定します（誤検出が減り、解析コストも下がります）。プログラムを選択した場合、領域はそのウィンドウ基準に、そうでない場合はメインモニター基準になります。ローカルOCR（無料）でテキストを検出し、質問がありそうな場合のみAI（haiku）を使用します。検出すると、チャットウィンドウを待ってから投票を考慮して回答します。",
      autoClickLabel: "選択した回答を自動クリック",
      clickTargetLabel: "クリック対象",
      clickTargetAI: "AIの回答",
      clickTargetChat: "チャットで最も投票された回答（投票がある場合）",
      clickHint: "OCRで画面上の選択肢のテキストを見つけてクリックします（ゲームウィンドウを前面に表示します）。その後3〜5秒待ってから同じ位置を再度クリックし、次の質問へ進みます。",
      autoNavLabel: "ラウンド間の自動ナビゲーション（Majotori）",
      autoNavHint: "結果画面を検出すると、メインメニューに戻るまでクリックし、そこで「Play」、続いて「Trivia Only」を押し、さらに1回クリックして次の質問に進みます。",
      testButton: "🖥️ サンプル質問でテスト",
    },

    aiProvider: {
      title: "AIプロバイダー",
      providerLabel: "プロバイダー",
      onlyClaude: "（現在はClaudeのみ利用可能）",
      exportMemoryLabel: "現在のモデルのメモリをエクスポート",
      exporting: "エクスポート中…",
      exportTo: "📤 {target} へエクスポート",
      initiating: "開始しています…",
      exportHint: "選択したモデルのセッションメモリをもう一方のモデルにコピーします（backend/memories/ に.mdとしても保存されます）。ChatGPTには永続セッションがないため対象外です。",
      importMemoryLabel: ".mdファイルからメモリをインポート",
      importing: "インポート中…",
      importButton: "📥 {file}を現在のセッションに読み込む",
      importSuccess: "✅ メモリがセッションに統合されました",
      importHint: "上で選択したモデルの現在の保存済みセッションに、.mdファイル（例えば以前エクスポートしたもの）を記憶として読み込みます。ChatGPTには永続セッションがないため対象外です。",
    },

    prompt: {
      title: "AIプロンプト",
      label: "ベースプロンプト（チャットメッセージは末尾に自動的に追加されます）",
    },

    tts: {
      title: "音声合成（TTS）",
      provider: "TTSプロバイダー",
      windows: "Windows TTS（システム音声）",
      elevenlabs: "ElevenLabs（APIキーが必要）",
      unavailable: "一時的に利用不可",
      piper: "Piper（ローカルのスペイン語音声、オフライン）",
      voice: "音声",
      systemDefault: "システムのデフォルト",
      elevenApiKey: "ElevenLabs APIキー",
      elevenApiKeyHintPrefix: "取得先:",
      elevenApiKeyHintSuffix: "— ローカルに保存され、ローカルバックエンドにのみ送信されます。生成に失敗した場合はWindows TTSにフォールバックします。",
      elevenVoice: "ElevenLabsの音声",
      selectVoice: "— 音声を選択 —",
      savedVoice: "（保存済み）",
      loadVoices: "↻ 音声を読み込む",
      loading: "読み込み中…",
      pasteVoiceId: "または音声IDを直接貼り付け",
      pasteVoiceIdHint: "「My voices」に表示されないライブラリ/共有音声に便利です。IDはElevenLabs → Voices → ⋯ → Copy voice ID から確認できます。",
      piperVoice: "Piperの音声",
      piperDefault: "デフォルト（es_MX claude、高品質）",
      piperMissing: "⚠ projects\\piperttsspanish に piper.exe が見つかりません",
      piperHint: "CPU上で完全オフラインで動作します — APIキーもサーバーも不要です。生成に失敗した場合はWindows TTSにフォールバックします。",
      speed: "速度（{rate}x）",
      volume: "音量（{volume}%）",
    },

    voice: {
      title: "音声文字起こし（マイク）",
      unsupported: "⚠ このブラウザではSpeechRecognitionがサポートされていません。Chromium/Chromeを使用してください。",
      chromeOnly: "⚠ 音声文字起こしはGoogle Chromeでのみ動作します。",
      enableLabel: "マイクを文字起こしし、Claudeのバッチに含める",
      micDevice: "マイクデバイス",
      systemDefault: "システムのデフォルト",
      micFallback: "マイク（{id}…）",
      language: "言語",
      chatLabel: "チャットでのラベル",
      chatLabelPlaceholder: "Streamer",
      chatLabelHint: "チャットフィードであなたの音声メッセージに表示される名前です。",
    },

    vtube: {
      title: "VTube Studio — リップシンク",
      wsUrl: "WebSocket URL",
      wsHint: "VTube Studioの Settings → General で Plugin API を有効にし、ポートが一致していることを確認してください。",
      pluginName: "プラグイン名",
      mouthParam: "口のパラメーター（VTSトラッキングパラメーター）",
      mouthParamHint: "Live2Dのパラメーター名ではなく、VTSのフェイストラッキングの入力名（MouthOpen、MouthSmileなど）を使用してください。",
      sensitivity: "口の感度（{pct}%）",
      sensitivityHint: "50% = 控えめな動き ・ 100% = フルレンジ",
      testButton: "口の動きをテスト",
    },
  },

  onboarding: {
    stepLabel: "ステップ {step} / {total}",
    buttons: {
      skipStep: "この手順をスキップ",
      skipAll: "すべてスキップ",
      next: "次へ",
      gotIt: "了解、始めよう！",
    },
    steps: {
      liveChat: {
        title: "ライブチャット",
        body: "これはあなたのTwitchライブチャットフィードです。視聴者からのメッセージはすべてここにリアルタイムで表示されます。",
      },
      aiResponse: {
        title: "AIの返信",
        body: "AI共同配信者の返信がここに表示されます。このパネルから音声をミュートしたり、返信をスキップしたり、手動でチャットに送信したりできます。",
      },
      statusFooter: {
        title: "ステータスバー",
        body: "このバーでは、Twitch、ボットアカウント、VTube Studioの接続状況と、次のAI返信までのカウントダウンを一目で確認できます。",
      },
      openSettings: {
        title: "設定を開く",
        body: "⚙ 設定ボタンをクリックしてボットを設定してください。",
      },
      botAccount: {
        title: "ボットアカウント（任意）",
        body: "ここで別のボットアカウントを接続すると、あなたのチャットにメッセージを投稿できるようになります。この手順は完全に任意です — チャットに投稿せずアプリ内でAIの返信を見るだけでよければスキップしてください。",
      },
      aiPrompt: {
        title: "AIプロンプト",
        insist1: "これは最も重要な設定です。AIの性格や、あなたと配信についての話し方を伝えるベースプロンプトを書いてください。",
        insist2: "本当に、ここはスキップしないでください — 良いベースプロンプトがあってこそ、AI共同配信者が汎用ボットではなく「あなたの」共同配信者らしく感じられます。少し時間をとって書いてみましょう。",
        insist3: "最後のお願いです。続ける前に、あなた自身のベースプロンプトを書いてください。これが配信中のAIのすべての返信を形作ります。",
      },
      saveApply: {
        title: "保存して適用",
        body: "設定に満足したら、保存ボタンをクリックして適用してください。",
      },
      done: {
        title: "以上です！",
        body: "これで準備完了です。設定はいつでも後から開いて調整できます。良い配信を！",
      },
    },
  },
};
