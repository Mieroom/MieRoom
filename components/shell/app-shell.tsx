"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  useEffect,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { signOutAction } from "@/app/login/actions";
import { ConfirmDialog } from "@/components/ui/confirm-button";
import type { Role } from "@/lib/auth/policy";
import {
  activeItem,
  itemById,
  menuFor,
  ROLE_LABEL,
  type NavItem,
} from "@/lib/nav";
import { Icon } from "@/components/ui/icon";
import { Brand } from "./brand";

// 共通のレイアウト (外部設計書 5-2). The name of the person is not shown after login.
// The role only decides what is offered here; pages check it again on the server.
export function AppShell({
  role,
  todayText,
  pendingCount = 0,
  sampleScreenId,
  children,
}: {
  role: Role;
  todayText: string;
  /** 先生: how many requests wait, shown on 「先生ホーム」 (5-2) */
  pendingCount?: number;
  /** Only on the /_dev sample pages: which screen is open. The menu stays inside /_dev. */
  sampleScreenId?: string;
  children: ReactNode;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const [signingOut, startSignOut] = useTransition();
  const pathname = usePathname();
  const sections = menuFor(role);
  const current: NavItem | null = sampleScreenId
    ? itemById(sampleScreenId)
    : activeItem(pathname);
  const currentId = current?.id;

  // The admin menu is taller than a laptop screen. Keep the page you are on in view
  // by scrolling the menu itself (never the page), only as far as needed ("nearest").
  // Only the menu scrolls; the brand above it stays in place.
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLAnchorElement>(null);
  // True once the menu has scrolled down, so the top edge shows that it continues
  // above. Set from the scroll event, which also fires after the scroll below.
  const [menuScrolled, setMenuScrolled] = useState(false);
  useEffect(() => {
    const scroller = scrollRef.current;
    const link = activeRef.current;
    if (!scroller || !link || scroller.scrollHeight <= scroller.clientHeight)
      return;
    const box = scroller.getBoundingClientRect();
    const item = link.getBoundingClientRect();
    // The fades cover 24px at the top and 40px at the bottom.
    if (item.top < box.top + 24) {
      scroller.scrollTop += item.top - (box.top + 24);
    } else if (item.bottom > box.bottom - 40) {
      scroller.scrollTop += item.bottom - (box.bottom - 40);
    }
  }, [currentId]);

  return (
    <div className="min-h-screen sm:grid sm:grid-cols-[190px_minmax(0,1fr)] lg:grid-cols-[230px_minmax(0,1fr)] print:block">
      {menuOpen && (
        <button
          type="button"
          aria-label="メニューを閉じる"
          className="fixed inset-0 z-30 bg-[#14246b55] sm:hidden"
          onClick={() => setMenuOpen(false)}
        />
      )}
      <aside
        aria-label="メインメニュー"
        className={`fixed inset-y-0 left-0 z-40 flex w-[245px] flex-col overflow-hidden border-r border-line bg-white px-3 pt-5 transition-transform sm:sticky sm:top-0 sm:h-dvh sm:w-auto sm:translate-x-0 sm:shadow-none lg:px-4 print:hidden ${
          menuOpen
            ? "translate-x-0 shadow-[10px_0_50px_#14246b24]"
            : "-translate-x-full"
        }`}
      >
        <div className="shrink-0 px-2 pb-3">
          <Brand />
        </div>
        {/* Only the menu scrolls. The scroll box has no padding, so the sticky fades
            stick to its real top and bottom edges. Once it has scrolled, a line on
            its top edge and the fade below show that the menu continues above; at
            rest both are invisible (the border is transparent, so nothing moves). */}
        <div
          ref={scrollRef}
          onScroll={(event) =>
            setMenuScrolled(event.currentTarget.scrollTop > 0)
          }
          className={`flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain border-t ${
            menuScrolled ? "border-line" : "border-transparent"
          }`}
        >
          {/* Fades the first visible items when the menu has scrolled; net height 0. */}
          <div
            aria-hidden="true"
            className={`pointer-events-none sticky top-0 z-10 -mb-6 h-6 shrink-0 bg-linear-to-b from-white transition-opacity motion-reduce:transition-none ${
              menuScrolled ? "opacity-100" : "opacity-0"
            }`}
          />
          {/* pt-[3px]: with the brand pb-3 and the 1px edge, the first label starts 16px
              under the brand, as before the edge was added. */}
          <nav className="flex flex-col gap-3 pt-[3px]">
            {sections.map((section) => (
              <div key={section.label}>
                <div className="mx-3 mb-1 text-[11px] font-bold tracking-widest text-[#586579]">
                  {section.label}
                </div>
                <div className="flex flex-col gap-0.5">
                  {section.items.map((item) => {
                    const active = item.id === currentId;
                    return (
                      <Link
                        key={item.id}
                        ref={active ? activeRef : undefined}
                        href={
                          sampleScreenId
                            ? `/_dev/${item.id}?role=${role}`
                            : item.href
                        }
                        aria-current={active ? "page" : undefined}
                        onClick={() => setMenuOpen(false)}
                        className={`flex items-center gap-3 rounded-[9px] px-3 py-2 font-medium transition-colors hover:bg-[#edf0f5] hover:text-navy sm:[@media(max-height:820px)]:py-1.5 ${
                          active
                            ? "bg-[#e8ecff] font-bold text-brand-dark"
                            : "text-[#4a576c]"
                        }`}
                      >
                        <Icon name={item.icon} />
                        <span>{item.label}</span>
                        {item.id === "s10" && pendingCount > 0 && (
                          <span
                            role="status"
                            aria-label={`承認待ち ${pendingCount}件`}
                            className="ml-auto rounded-full bg-[#a3101f] px-2 py-0.5 text-[11px] font-bold leading-none text-white"
                          >
                            {pendingCount > 99 ? "99+" : pendingCount}
                          </span>
                        )}
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>
          {/* Fades the last visible items when the menu continues below the fold. At
              the end it covers only the empty space after the last item. */}
          <div
            aria-hidden="true"
            className="pointer-events-none sticky bottom-0 z-10 h-10 shrink-0 bg-linear-to-t from-white from-25%"
          />
        </div>
        {/* Today, the role and ログアウト, under the menu and always in view (only the
            menu above scrolls). On phones: at the bottom of the opened menu. pl-2 lines
            up with the brand; no right padding, so the button lines up with the menu
            items' right edge and 時間割管理者 still fits in the 190px menu. */}
        <div className="shrink-0 border-t border-line pb-[max(0.75rem,env(safe-area-inset-bottom))] pl-2 pt-3">
          <div className="whitespace-nowrap text-xs text-[#4a576c]">
            {todayText}
          </div>
          <div className="mt-2 flex items-center gap-2">
            {/* The first letter only repeats the label next to it. */}
            <span
              aria-hidden="true"
              className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#e8ecff] text-xs font-bold text-navy"
            >
              {ROLE_LABEL[role][0]}
            </span>
            <span className="min-w-0 flex-1 truncate text-xs">
              {ROLE_LABEL[role]}
            </span>
            {!sampleScreenId && (
              <>
                <button
                  type="button"
                  aria-label="ログアウト"
                  title="ログアウト"
                  onClick={() => setConfirmSignOut(true)}
                  className="inline-grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-line bg-white hover:bg-[#f6f8fc]"
                >
                  <Icon name="logout" />
                </button>
                {/* showModal puts it in the top layer: the menu's transform and
                    overflow do not clip it. */}
                <ConfirmDialog
                  open={confirmSignOut}
                  message="ログアウトしますか?"
                  confirmLabel="ログアウトする"
                  cancelLabel="キャンセル"
                  busy={signingOut}
                  onYes={() => startSignOut(() => signOutAction())}
                  onNo={() => setConfirmSignOut(false)}
                />
              </>
            )}
          </div>
        </div>
      </aside>

      <div className="min-w-0">
        {/* Phones only: the button that opens the menu, and the screen's name. From sm
            the menu is always in view and today, the role and ログアウト sit under it,
            so there is no band. */}
        <header className="flex h-14 items-center gap-3 border-b border-line bg-white px-4 sm:hidden print:hidden">
          <button
            type="button"
            aria-label="メニューを開く"
            aria-expanded={menuOpen}
            className="inline-grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-line bg-white hover:bg-[#f6f8fc]"
            onClick={() => setMenuOpen(true)}
          >
            <Icon name="menu" />
          </button>
          <div className="truncate text-sm font-semibold text-ink">
            {current?.label ?? "ミエルーム"}
          </div>
        </header>
        <main className="mx-auto max-w-[1490px] px-4 pb-10 pt-6 sm:px-8 sm:pt-8 print:p-0">
          {children}
        </main>
      </div>
    </div>
  );
}
