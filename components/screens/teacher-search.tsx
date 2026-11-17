"use client";

import Form from "next/form";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { SearchField } from "@/components/ui/form";
import { isMiniGamePhrase } from "@/lib/domain/mini-game";

// 先生一覧の「名前で絞る」(S05)。入力した文字を、ブラウザの入力履歴に残さない (autocomplete を切る)。
// ミニゲームを遊べる人が合言葉を入れたときは、検索せずに、そのままゲームへ移る
// (合言葉が、URL・アクセスの記録・戻る履歴に残らない)。JavaScript が動かないときは、
// 先生一覧のページ (サーバー) が同じ判定をする。
export function TeacherSearch({
  query,
  basePath,
  miniGame,
}: {
  query: string;
  basePath: string;
  /** この人が、ミニゲームを遊べる役割か */
  miniGame: boolean;
}) {
  const router = useRouter();
  return (
    <Form
      action={basePath}
      autoComplete="off"
      className="flex w-full items-center gap-2"
      onSubmit={(event) => {
        if (!miniGame) return;
        const input = event.currentTarget.elements.namedItem("q");
        if (
          input instanceof HTMLInputElement &&
          isMiniGamePhrase(input.value)
        ) {
          event.preventDefault();
          input.value = "";
          router.push("/play");
        }
      }}
    >
      <SearchField
        key={query}
        className="min-w-0 flex-1 sm:max-w-[310px]"
        name="q"
        defaultValue={query}
        aria-label="名前で絞る"
        placeholder="名前で絞る"
        autoComplete="off"
      />
      <Button type="submit" size="sm" className="h-[38px] shrink-0">
        絞り込む
      </Button>
    </Form>
  );
}
