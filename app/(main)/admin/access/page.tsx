import { ForbiddenView } from "@/app/forbidden-view";
import { AccessView } from "@/components/screens/admin-views";
import { noticeText } from "@/lib/notice";
import { loadAccess, loadDevices } from "@/lib/server/queries/admin";
import { loadRoomList } from "@/lib/server/queries/common";
import { hasRole, requireUser } from "@/lib/server/session";
import { one } from "@/lib/url";

// S25 タグ・受信機・機器
export default async function AccessPage({
  searchParams,
}: PageProps<"/admin/access">) {
  const user = await requireUser();
  if (!hasRole(user, "admin")) return <ForbiddenView />;
  const [access, rooms, devices] = await Promise.all([
    loadAccess(),
    loadRoomList(),
    loadDevices(new Date()),
  ]);
  return (
    <AccessView
      {...access}
      rooms={rooms.map((room) => ({ id: room.id, name: room.name }))}
      devices={devices}
      notice={noticeText(one((await searchParams).notice))}
    />
  );
}
