import type { ComponentProps } from "react";
import { Brand } from "@/components/shell/brand";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";

// S01 ログイン
export function LoginView({
  message,
  next,
  action,
}: {
  message: string | null;
  next: string;
  action?: ComponentProps<"form">["action"];
}) {
  return (
    // A single 370px column, centred on the page: the brand, then the form.
    <main className="flex min-h-screen items-center justify-center bg-white px-6 py-10">
      <section className="w-full max-w-[370px]">
        <div className="mb-10">
          <Brand />
        </div>
        <h1 className="text-[23px] font-bold sm:text-[25px]">ログイン</h1>
        <p className="mb-7 mt-3 text-xs leading-loose text-muted">
          学校のMicrosoftアカウントでログインしてください
        </p>
        {message && (
          <p
            role="alert"
            className="mb-5 rounded-[9px] bg-red-soft px-4 py-3 text-xs text-red-ink"
          >
            {message}
          </p>
        )}
        <form action={action}>
          <input type="hidden" name="next" value={next} />
          <Button type="submit" variant="navy" size="lg">
            <Icon name="shield" />
            Microsoftでログイン
            <Icon name="arrow" size={16} />
          </Button>
        </form>
      </section>
    </main>
  );
}
