import { MiniGame } from "@/components/screens/mini-game";
import { LinkButton } from "@/components/ui/button";
import { Card, PageHeading } from "@/components/ui/parts";
import { MINI_GAME_NAME } from "@/lib/domain/mini-game";

// 学生だけの隠し要素のページの中身 (本物のページと、見本画面で共通)。
export function MiniGameView({ backHref }: { backHref: string }) {
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeading
        title={MINI_GAME_NAME}
        description="1限に遅刻しないよう、廊下を走ろう。"
        actions={<LinkButton href={backHref}>もどる</LinkButton>}
      />
      <Card className="p-4 sm:p-5">
        <MiniGame />
      </Card>
    </div>
  );
}
