import { MiniGame } from "@/components/screens/mini-game";
import { LinkButton } from "@/components/ui/button";
import { Card, PageHeading } from "@/components/ui/parts";
import {
  MINI_GAME_NAME,
  type Conditions,
  type EventKind,
} from "@/lib/domain/mini-game";

// 学生と時間割管理者だけの隠し要素のページの中身 (本物のページと、見本画面で共通)。
export function MiniGameView({
  backHref,
  kinds,
  conditions,
  ranking = "server",
}: {
  backHref: string;
  /** ランキング: server = 本物 (既定)、demo = 見本 (ログインなしの見本画面用) */
  ranking?: "server" | "demo";
  /** できごとを決めて遊ぶ (開発用の見本画面だけ) */
  kinds?: EventKind[];
  /** 天気・起床時刻を決めて遊ぶ (開発用の見本画面だけ) */
  conditions?: Partial<Conditions>;
}) {
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeading
        title={MINI_GAME_NAME}
        description="1限に遅刻しないよう、廊下を走ろう。"
        actions={<LinkButton href={backHref}>もどる</LinkButton>}
      />
      <Card className="p-4 sm:p-5">
        <MiniGame
          kinds={kinds}
          conditions={conditions}
          ranking={ranking}
          backHref={backHref}
        />
      </Card>
    </div>
  );
}
