"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  choose,
  clockText,
  createGame,
  DEADLINE_MINUTE,
  eventView,
  MINI_GAME_NAME,
  press as pressInGame,
  setPace,
  startWake,
  wakeView,
  stepGame,
  summarize,
  type Conditions,
  type EventKind,
  type EventView,
  type GameState,
  type Pace,
  type Summary,
  type Weather,
  type WakeView,
  WEATHER_NAMES,
} from "@/lib/domain/mini-game";
import { ART, CHARACTERS, drawScene } from "./mini-game-art";

// 学生と時間割管理者だけの隠し要素「遅刻ダッシュ」(ドット絵): 家 (8:00) から走って、9:15 までに
// 教室へ着く。道のとちゅうで、お母さん・倒れているおばさん・踏切のできごとが、ランダムに起きる。
// 画面の中だけで動く (サーバー・DB は使わない)。音は出さない。ベストとキャラは、この端末にだけ残す。

const BEST_KEY = "mieroom.miniGame.bestMargin";
const CHARACTER_KEY = "mieroom.miniGame.character";
// 終わった直後の連打で、すぐ始まり直さないための待ち時間 (ミリ秒)
const RESTART_LOCK_MS = 450;
// 重いタブやバックグラウンドから戻ったとき、一気に進まないための 1 コマの上限 (秒)
const MAX_FRAME = 1 / 30;

type Phase = "ready" | "waking" | "playing" | "arrived" | "late";

function readBest(): number {
  try {
    const value = Number(window.localStorage.getItem(BEST_KEY));
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  } catch {
    return 0;
  }
}

function writeBest(margin: number) {
  try {
    window.localStorage.setItem(BEST_KEY, String(margin));
  } catch {
    // 保存できなくても、遊べる
  }
}

function readCharacter(): number {
  try {
    const id = window.localStorage.getItem(CHARACTER_KEY);
    const index = CHARACTERS.findIndex((item) => item.id === id);
    return index >= 0 ? index : 0;
  } catch {
    return 0;
  }
}

function writeCharacter(id: string) {
  try {
    window.localStorage.setItem(CHARACTER_KEY, id);
  } catch {
    // 保存できなくても、遊べる
  }
}

/** できごとの最中に、画面へ出す文。variant (0〜2) で、毎回、せりふが変わる。 */
const TITLES: Record<string, string[]> = {
  mother: ["早く起きなさい!!", "また寝坊したの!?", "遅刻するわよ!!"],
  obasan: [
    "おばさんが倒れている!",
    "おばさんがうずくまっている!",
    "おばさんが動けない!",
  ],
  crossing: ["踏切が閉まった!", "カンカンカン…踏切だ!", "遮断機が下りてきた!"],
  dog: ["犬が追ってくる!!", "野良犬だ!!", "大きな犬が吠えている!!"],
  vending: ["自販機がある!", "冷たい飲み物の自販機!", "自販機を見つけた!"],
  friend: ["友達に会った!", "クラスメイトに呼ばれた!", "友達が手を振っている!"],
  bike: ["危ない!!", "自転車が来た!!", "ぶつかる!!"],
  teacher: [
    "先生が呼び止める!",
    "先生が校門に立っている!",
    "朝のあいさつ運動だ!",
  ],
};

function eventText(view: EventView): { title: string; hint: string } {
  const title = (kind: string) => TITLES[kind][view.variant % 3];
  if (view.kind === "dog") {
    return { title: title("dog"), hint: "→ ダッシュで逃げろ!" };
  }
  if (view.kind === "vending") {
    return view.phase === "ask"
      ? { title: title("vending"), hint: "ひと息つく?(2 秒)" }
      : { title: "ごくごく…", hint: "スタミナが戻る" };
  }
  if (view.kind === "friend") {
    return view.phase === "ask"
      ? { title: title("friend"), hint: "立ち話する?(3 秒)" }
      : { title: "おしゃべり中…", hint: "おにぎりをもらう" };
  }
  if (view.kind === "bike") {
    return { title: title("bike"), hint: "タップ / スペース!" };
  }
  if (view.kind === "teacher") {
    return { title: title("teacher"), hint: "連打であいさつ!" };
  }
  if (view.kind === "mother") {
    return { title: title("mother"), hint: "連打で言い訳しよう!" };
  }
  if (view.kind === "obasan") {
    return view.phase === "ask"
      ? { title: title("obasan"), hint: "どうする?" }
      : { title: "大丈夫ですか!?", hint: "連打で起こそう!" };
  }
  if (view.phase === "ask") {
    return { title: title("crossing"), hint: "どうする?" };
  }
  if (view.phase === "wait") {
    return { title: "電車が通過中…", hint: "開くまで待つ" };
  }
  if (view.phase === "blocked") {
    return { title: "電車に阻まれた…", hint: "動けない" };
  }
  return view.signal
    ? { title: "いまだ!!", hint: "タップ / スペース!" }
    : { title: "電車が遠い…", hint: "合図を待て(早すぎると危ない)" };
}

const CHOICES: Record<string, [string, string]> = {
  obasan: ["助ける", "通り過ぎる"],
  crossing: ["待つ", "渡る"],
  vending: ["寄る", "通り過ぎる"],
  friend: ["立ち話する", "急いでると言う"],
};

const RECENT_KEY = "mieroom.miniGame.recent";
const LAST_KEY = "mieroom.miniGame.last";

/** 前回の条件 (天気・起床時刻)。同じ条件が続かないように、選ぶときに使う。 */
function readLast(): { weather?: string; wake?: number } {
  try {
    const raw = JSON.parse(window.localStorage.getItem(LAST_KEY) ?? "{}");
    return {
      weather: typeof raw?.weather === "string" ? raw.weather : undefined,
      wake: typeof raw?.wake === "number" ? raw.wake : undefined,
    };
  } catch {
    return {};
  }
}

/** 直近 2 回のできごと (新しい順)。同じものが続かないように、選ぶときに使う。 */
function readRecent(): string[][] {
  try {
    const raw = JSON.parse(window.localStorage.getItem(RECENT_KEY) ?? "[]");
    if (!Array.isArray(raw)) return [];
    return raw
      .slice(0, 2)
      .map((run) =>
        Array.isArray(run)
          ? run.filter((kind): kind is string => typeof kind === "string")
          : [],
      );
  } catch {
    return [];
  }
}

function rememberRun(state: GameState) {
  try {
    const kinds = state.events.map((event) => event.kind);
    window.localStorage.setItem(
      RECENT_KEY,
      JSON.stringify([kinds, ...readRecent()].slice(0, 2)),
    );
    window.localStorage.setItem(
      LAST_KEY,
      JSON.stringify({ weather: state.weather, wake: state.startMinute }),
    );
  } catch {
    // 保存できなくても、遊べる
  }
}

function freshGame(
  kinds?: EventKind[],
  conditions?: Partial<Conditions>,
): GameState {
  return createGame(Math.random, {
    recent: readRecent(),
    previous: readLast(),
    kinds,
    conditions,
  });
}

/** kinds: できごとを決めて遊ぶ (開発用の見本画面だけ。本物のページでは渡さない)。 */
export function MiniGame({
  kinds,
  conditions,
}: {
  kinds?: EventKind[];
  conditions?: Partial<Conditions>;
} = {}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const game = useRef<GameState>(createGame());
  const best = useRef(0);
  const overAt = useRef(0);
  const characterIndex = useRef(0);
  const viewKey = useRef("null");
  // 押している向き (← ゆっくり / → ダッシュ)。キーと、画面のボタンの両方
  const held = useRef({ left: false, right: false });
  const [character, setCharacter] = useState(0);
  // 今日の条件 (起きた時刻・天気)。毎回変わる
  const [today, setToday] = useState<{ weather: Weather }>({
    weather: "sunny",
  });
  // 起床チャレンジ (目覚ましのバー) の結果の表示
  const [wake, setWake] = useState<WakeView | null>(null);
  const wakeKey = useRef("null");
  const [phase, setPhase] = useState<Phase>("ready");
  const [view, setView] = useState<EventView | null>(null);
  const [bestMargin, setBestMargin] = useState(0);
  const [result, setResult] = useState<(Summary & { isBest: boolean }) | null>(
    null,
  );

  // 新しいゲームを作り、今日の条件を画面に出す
  const makeGame = useCallback(() => {
    const created = freshGame(kinds, conditions);
    setToday({ weather: created.weather });
    return created;
  }, [kinds, conditions]);

  // 押している向きから、速さを決める (両方を押すと、ふつう)
  const applyPace = useCallback(() => {
    const { left, right } = held.current;
    const pace: Pace = left === right ? "normal" : right ? "dash" : "slow";
    setPace(game.current, pace);
  }, []);

  const hold = useCallback(
    (side: "left" | "right", down: boolean) => {
      held.current[side] = down;
      applyPace();
    },
    [applyPace],
  );

  // 押された: 始める / ジャンプ・連打・合図 / 終わったあとは、やり直す
  const press = useCallback(() => {
    const state = game.current;
    if (state.status === "ready") {
      startWake(state);
      setPhase("waking");
    } else if (state.status === "waking" || state.status === "playing") {
      pressInGame(state);
    } else if (performance.now() - overAt.current > RESTART_LOCK_MS) {
      game.current = makeGame();
      startWake(game.current);
      applyPace();
      setResult(null);
      setView(null);
      setWake(null);
      viewKey.current = "null";
      wakeKey.current = "null";
      setPhase("waking");
    }
  }, [applyPace, makeGame]);

  // 選ぶ (助ける / 通り過ぎる、待つ / 渡る)
  const pick = useCallback((option: 0 | 1) => {
    choose(game.current, option);
  }, []);

  // キャラを替える (始める前と、終わったあと)。選んだキャラは、この端末に覚えておく
  const changeCharacter = useCallback((step: number) => {
    if (game.current.status === "playing") return;
    const count = CHARACTERS.length;
    const next = (characterIndex.current + step + count) % count;
    characterIndex.current = next;
    setCharacter(next);
    writeCharacter(CHARACTERS[next].id);
  }, []);

  useEffect(() => {
    const element = canvas.current;
    const ctx = element?.getContext("2d");
    if (!element || !ctx) return;
    // 前回までのできごとを避けて、この回のゲームを作り直す (まだ始まっていない)
    game.current = makeGame();
    const savedBest = readBest();
    best.current = savedBest;
    setBestMargin(savedBest);
    const saved = readCharacter();
    characterIndex.current = saved;
    setCharacter(saved);

    let frame = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const state = game.current;
      const dt = Math.min((now - last) / 1000, MAX_FRAME);
      last = now;
      const before = state.status;
      stepGame(state, dt);
      if (before === "waking" && state.status === "playing") {
        // 起きた: できごと (寝坊の日は、減ったあと) を覚えて、走り出す
        rememberRun(state);
        setPhase("playing");
      }
      if (
        (before === "playing" || before === "waking") &&
        (state.status === "arrived" || state.status === "late")
      ) {
        overAt.current = now;
        const summary = summarize(state);
        const isBest =
          summary.outcome === "arrived" && summary.margin > best.current;
        if (isBest) {
          best.current = summary.margin;
          writeBest(summary.margin);
          setBestMargin(summary.margin);
        }
        setResult({ ...summary, isBest });
        setPhase(state.status);
      }
      // できごとの表示は、変わったときだけ更新する
      const next = eventView(state);
      const key = JSON.stringify(next);
      if (key !== viewKey.current) {
        viewKey.current = key;
        setView(next);
      }
      const wakeNow = wakeView(state);
      const wakeText = JSON.stringify(wakeNow);
      if (wakeText !== wakeKey.current) {
        wakeKey.current = wakeText;
        setWake(wakeNow);
      }
      drawScene(ctx, state, CHARACTERS[characterIndex.current]);
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);

    // 別のタブに移ったら、最初からにする (走りっぱなしで時間が過ぎないように)
    const onHidden = () => {
      if (
        document.hidden &&
        (game.current.status === "playing" || game.current.status === "waking")
      ) {
        game.current = makeGame();
        held.current = { left: false, right: false };
        setPhase("ready");
        setView(null);
        viewKey.current = "null";
      }
    };
    document.addEventListener("visibilitychange", onHidden);

    const onKey = (event: KeyboardEvent) => {
      const state = game.current;
      if (event.code === "Space" || event.code === "ArrowUp") {
        event.preventDefault();
        if (!event.repeat) press();
      } else if (event.code === "ArrowLeft" || event.code === "ArrowRight") {
        event.preventDefault();
        const side = event.code === "ArrowLeft" ? "left" : "right";
        if (state.status === "waking") {
          // 目覚ましの間は、何もしない
        } else if (state.status !== "playing") {
          if (!event.repeat) changeCharacter(side === "left" ? -1 : 1);
        } else if (state.active !== null) {
          // できごとの最中は、選ぶ (走らない)
          if (!event.repeat) choose(state, side === "left" ? 0 : 1);
        } else {
          hold(side, true);
        }
      } else if (event.code === "Digit1" || event.code === "Digit2") {
        if (state.status === "playing") {
          choose(state, event.code === "Digit1" ? 0 : 1);
        }
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === "ArrowLeft") hold("left", false);
      if (event.code === "ArrowRight") hold("right", false);
    };
    const onBlur = () => {
      held.current = { left: false, right: false };
      applyPace();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [press, changeCharacter, hold, applyPace, makeGame]);

  const over = phase === "arrived" || phase === "late";
  const message = view ? eventText(view) : null;
  const choices = view && view.phase === "ask" ? CHOICES[view.kind] : null;

  return (
    <div className="flex flex-col gap-3">
      <div className="relative mx-auto w-full max-w-[960px]">
        {/* 小さな絵を、そのまま (なめらかにせず) 引き伸ばす: ドット絵 */}
        <canvas
          ref={canvas}
          width={ART.width}
          height={ART.height}
          role="img"
          aria-label={`${MINI_GAME_NAME}: 家から教室まで、9:15 までに走る。タップかスペースキーでジャンプ`}
          onPointerDown={(event) => {
            event.preventDefault();
            press();
          }}
          className="aspect-[8/3] w-full touch-none select-none rounded-[11px] border border-line bg-white [image-rendering:pixelated]"
        />

        {/* できごと: 文と、連打の進み、選択肢 */}
        {phase === "playing" && view && message && view.phase === "chase" && (
          <div className="pointer-events-none absolute inset-x-0 top-[17%] flex justify-center">
            <div className="flex flex-col items-center gap-1 rounded-lg bg-[#a3101f]/85 px-4 py-2 text-center text-white">
              <p className="text-sm font-bold tracking-widest">
                {message.title}
              </p>
              <p className="text-[11px]">{message.hint}</p>
              <div className="flex gap-1" aria-hidden="true">
                {Array.from({ length: 6 }, (_, index) => (
                  <span
                    key={index}
                    className={`h-2 w-3 rounded-sm ${
                      index < Math.ceil(view.progress * 6)
                        ? "bg-[#ffe066]"
                        : "bg-white/25"
                    }`}
                  />
                ))}
              </div>
            </div>
          </div>
        )}
        {phase === "playing" && view && message && view.phase !== "chase" && (
          <div className="pointer-events-none absolute inset-x-0 top-[17%] flex justify-center">
            <div className="flex min-w-[15rem] flex-col items-center gap-1 rounded-lg bg-[#1f2a44]/85 px-5 py-3 text-center text-white">
              <p
                className={`text-lg font-bold tracking-widest ${
                  view.signal ? "text-[#ffe066]" : ""
                }`}
              >
                {message.title}
              </p>
              <p className="text-xs">{message.hint}</p>
              {view.need > 0 && view.phase !== "ask" && (
                <div className="mt-1 flex gap-1" aria-hidden="true">
                  {Array.from({ length: view.need }, (_, index) => (
                    <span
                      key={index}
                      className={`h-2.5 w-4 rounded-sm ${
                        index < view.taps ? "bg-[#ffe066]" : "bg-white/25"
                      }`}
                    />
                  ))}
                </div>
              )}
              {choices && (
                <div className="pointer-events-auto mt-2 flex gap-3">
                  {choices.map((label, index) => (
                    <button
                      key={label}
                      type="button"
                      onClick={() => pick(index === 0 ? 0 : 1)}
                      className="rounded-md bg-white px-4 py-1.5 text-sm font-bold text-[#1f2a44] hover:bg-[#ffe066]"
                    >
                      {label}
                      <span className="ml-1 text-[10px] font-normal opacity-60">
                        {index === 0 ? "←" : "→"}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* 起床チャレンジ: 目覚ましを止める */}
        {phase === "waking" && (
          <div className="pointer-events-none absolute inset-x-0 top-[14%] flex justify-center">
            <div className="flex min-w-[15rem] flex-col items-center gap-1 rounded-lg bg-[#1f2a44]/85 px-5 py-2 text-center text-white">
              {wake?.stopped ? (
                <>
                  <p
                    className={`text-lg font-bold tracking-widest ${
                      wake.clock ? "text-[#ffe066]" : "text-[#ff7b8a]"
                    }`}
                  >
                    {wake.label}
                  </p>
                  <p className="text-xs">
                    {wake.clock
                      ? `${wake.clock} 起床!`
                      : "起きられなかった…遅刻確定"}
                  </p>
                </>
              ) : (
                <>
                  <p className="text-base font-bold tracking-widest">
                    目覚ましが鳴っている!
                  </p>
                  <p className="text-xs">
                    タップ / スペースで止める(真ん中ほど早起き。端は二度寝!)
                  </p>
                </>
              )}
            </div>
          </div>
        )}

        {/* 速さのボタン (スマホ用。押している間だけ効く) */}
        {phase === "playing" && !view && (
          <>
            {(
              [
                ["left", "◀ ゆっくり", "left-2"],
                ["right", "ダッシュ ▶", "right-2"],
              ] as const
            ).map(([side, label, position]) => (
              <button
                key={side}
                type="button"
                aria-label={label}
                onPointerDown={(event) => {
                  event.preventDefault();
                  hold(side, true);
                }}
                onPointerUp={() => hold(side, false)}
                onPointerLeave={() => hold(side, false)}
                onPointerCancel={() => hold(side, false)}
                className={`absolute bottom-2 ${position} touch-none select-none rounded-md bg-[#1f2a44]/70 px-3 py-2 text-xs font-bold text-white active:bg-[#4f5bd5]`}
              >
                {label}
              </button>
            ))}
          </>
        )}

        {/* 始める前と、終わったあと */}
        {(phase === "ready" || over) && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="flex max-w-[92%] flex-col items-center gap-1 rounded-lg bg-[#1f2a44]/85 px-5 py-3 text-center text-white">
              {phase === "ready" && (
                <>
                  <p className="text-base font-bold tracking-widest">
                    {clockText(DEADLINE_MINUTE)} までに教室へ!
                  </p>
                  <p className="text-xs">
                    タップ / スペースで スタート(まず、目覚ましを止めよう)
                  </p>
                  <p className="text-xs">
                    今日の天気: {WEATHER_NAMES[today.weather]}
                    {today.weather === "rain" && "(転ぶと長く止まる)"}
                  </p>
                  <p className="text-xs opacity-80">
                    → ダッシュ(スタミナを使う) / ← ゆっくり(スタミナが戻る)
                  </p>
                  {bestMargin > 0 && (
                    <p className="text-xs opacity-80">
                      ベスト: {bestMargin} 分の余裕
                    </p>
                  )}
                </>
              )}
              {over && result && (
                <>
                  <p className="text-lg font-bold tracking-widest">
                    {result.outcome === "arrived" ? "ゴール!" : "遅刻!"}
                  </p>
                  <p className="text-sm">
                    {result.outcome === "arrived"
                      ? `${result.arrival} 着 (余裕 ${result.margin} 分)${
                          result.isBest ? "  ベスト更新!" : ""
                        }`
                      : `${result.arrival} に間に合わなかった (あと ${result.remaining} m)`}
                  </p>
                  {result.notes.length > 0 && (
                    <ul className="text-[11px] opacity-85">
                      {result.notes.map((note) => (
                        <li key={note}>{note}</li>
                      ))}
                    </ul>
                  )}
                  <p className="text-xs">もう一度: タップ / スペース</p>
                </>
              )}
              <div className="pointer-events-auto mt-1 flex items-center gap-3 text-sm">
                <button
                  type="button"
                  aria-label="前のキャラ"
                  onClick={() => changeCharacter(-1)}
                  className="grid h-8 w-8 place-items-center rounded-md bg-white/15 font-bold hover:bg-white/30"
                >
                  ◀
                </button>
                <span className="min-w-[6.5em] text-center" aria-live="polite">
                  {CHARACTERS[character].name}
                  <span className="ml-1 text-[11px] opacity-70">
                    {character + 1}/{CHARACTERS.length}
                  </span>
                </span>
                <button
                  type="button"
                  aria-label="次のキャラ"
                  onClick={() => changeCharacter(1)}
                  className="grid h-8 w-8 place-items-center rounded-md bg-white/15 font-bold hover:bg-white/30"
                >
                  ▶
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
      <p role="status" className="sr-only">
        {over && result
          ? result.outcome === "arrived"
            ? `ゴール! ${result.arrival} 着。余裕 ${result.margin} 分。`
            : `遅刻! ${result.arrival} に間に合わなかった。`
          : ""}
      </p>
    </div>
  );
}
