# GitAmida

GitAmidaは、複数のGitコミットを一つの変更単位として素早く確認するための、エディタ非依存のGit履歴ビューアです。

> A human-first Git history viewer for reviewing multiple commits as one change.

現在は設計・MVP準備段階です。

## 解決する問題

一般的なGit履歴ビューアでは、履歴画面がエディタ領域を占有したり、複数コミットの変更ファイルを一つのまとまりとして追いにくかったりします。GitAmidaはTerminal内のTUIに履歴を残し、必要なファイルだけを内部diffまたは外部エディタで開けるようにします。

初期ゴールは次の体験です。

> Cursor、VS Code、Codex app、GhosttyなどのTerminalからGitAmidaを開き、コミットグラフ上で複数コミットを選択すると、そのコミット群で変更されたファイルをまとめて確認できる。

## 想定する基本操作

- コミットグラフとブランチの分岐・合流を表示する
- 単一、連続範囲、非連続の複数コミットを選択する
- 選択したコミットで変更されたファイルをツリー表示する
- ファイルを選択し、UnifiedまたはSide-by-side diffを確認する
- 空白の扱いを切り替える
- 対応する外部ツールへ詳細diffを渡す
- キーボードとマウスのどちらでも操作する

画像はTUI内で簡易プレビューし、詳細比較はKaleidoscopeなどの外部diffツールへ渡す方針です。

## プロダクト原則

- **Human-first**: AI要約ではなく、人が変更を直接読めることを優先する
- **Read-first**: Git履歴と差分の閲覧を中心にする
- **Multiple commits as one view**: 複数コミットを一つの作業単位として扱う
- **Editor-independent**: 特定のエディタに本体を依存させない
- **Safe**: 履歴を書き換える操作を初期スコープへ含めない
- **Fast**: 履歴とdiffを必要になった時点で遅延取得する
- **Focused**: 汎用Gitクライアントではなく、変更確認に集中する

## 初期スコープ外

- commit、amend、merge、rebase、cherry-pick
- reset、revert、stash
- push、pull、fetch
- branchの作成・削除
- conflict解消
- AIによる要約やレビュー
- VS Code/CursorネイティブPanel

ブランチ切り替えは、閲覧機能が安定した後に安全性を確認して追加を検討します。

## 技術方針

- Go
- Bubble Tea v2
- Bubbles v2
- Lip Gloss v2
- Gitオブジェクトライブラリではなく、まずGit CLIを利用

GitAmida本体は単一のGoバイナリにします。VS Code/CursorやKaleidoscopeとの連携は、外部diffオープナーとして本体から分離します。

## ドキュメント

- [DESIGN.md](./DESIGN.md): 現在のアーキテクチャと判断理由
- [ROADMAP.md](./ROADMAP.md): 今後実装する内容と順序
- [AGENTS.md](./AGENTS.md): 開発規約とAIエージェント向け手順
