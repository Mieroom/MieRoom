import { notFound } from "next/navigation";
import { MiniGameView } from "@/components/screens/mini-game-view";
import { canPlayMiniGame } from "@/lib/domain/mini-game";
import { requireUser } from "@/lib/server/session";

// 学生と時間割管理者だけの隠し要素。メニューには出さない (入り口は、先生一覧の「名前で絞る」)。
// 遊べない役割 (先生) は、ページがない (404) のと同じに見せる。
export default async function PlayPage() {
  const user = await requireUser();
  if (!canPlayMiniGame(user.role)) notFound();
  return <MiniGameView backHref="/teachers" />;
}
