import { MESSAGES } from "@/lib/messages";
import { SLOTS } from "./periods";
import type {
  ApplicationIssue,
  ApprovalBlocker,
  ApprovalWarning,
  BlockIssue,
} from "./reservation-core";
import { addDays, formatDate } from "./school-date";

// The words for what the rules say (外部設計書 10章). No I/O here.

/** 11/20 3限 — the form of ME106 */
const dayAndPeriod = (date: string, periodNo: number) => {
  const [, month, day] = date.split("-").map(Number);
  return `${month}/${day} ${periodNo}限`;
};

export function applicationMessage(
  issue: ApplicationIssue,
  context: { date: string; today: string },
): string {
  switch (issue.code) {
    case "ME101":
      return MESSAGES.ME101(
        formatDate(context.date, context.today),
        formatDate(issue.deadlineDate, context.today),
      );
    case "ME102":
      return MESSAGES.ME102(
        formatDate(addDays(context.today, 30), context.today),
      );
    case "ME103":
      return MESSAGES.ME103;
    case "ME104":
      return MESSAGES.ME104;
    case "ME105":
      return MESSAGES.ME105(
        issue.slots.map((n) => SLOTS[n - 1].label).join("、"),
      );
    case "ME106":
      return MESSAGES.ME106(
        issue.periods.map((n) => dayAndPeriod(context.date, n)).join("、"),
      );
    case "ME107":
      return MESSAGES.ME107;
    case "ME108":
      return MESSAGES.ME108;
    case "ME109":
      return MESSAGES.ME109;
  }
}

export function blockerMessage(blocker: ApprovalBlocker): string {
  switch (blocker.code) {
    case "ME201":
      return MESSAGES.ME201(blocker.classes.join("、"));
    case "ME202":
      return MESSAGES.ME202;
    case "ME203":
      return MESSAGES.ME203;
    case "ME204":
      return MESSAGES.ME204;
  }
}

export function warningMessage(warning: ApprovalWarning): string {
  switch (warning.code) {
    case "MW201":
      return MESSAGES.MW201(warning.count);
    case "MW202":
      return MESSAGES.MW202;
    case "MW203":
      return MESSAGES.MW203(warning.classes.join("、"));
  }
}

export function blockIssueMessage(issue: BlockIssue): string {
  return issue.code === "ME301" ? MESSAGES.ME301 : MESSAGES.ME302;
}

/**
 * 一覧の「申請者」の欄の文 (S07、S10、S11)。代理入力は、だれの予約か、だれが入れたかを出す。
 * - 依頼者を文字で入れたもの: 「山田(代理入力: 岸本先生)」
 * - 生徒を選んだもの (申請者が生徒): 「山田(代理入力: 岸本)」
 * - 以前の代理入力 (申請者と対応した先生が同じ): 「岸本(代理入力)」
 */
export function applicantText(input: {
  proxy: boolean;
  applicantName: string;
  requesterName: string | null;
  handledByName: string | null;
}): string {
  if (!input.proxy) return input.applicantName;
  if (input.requesterName) {
    return `${input.requesterName}(代理入力: ${input.handledByName ?? input.applicantName})`;
  }
  if (
    input.handledByName === null ||
    input.handledByName === input.applicantName
  ) {
    return `${input.applicantName}(代理入力)`;
  }
  return `${input.applicantName}(代理入力: ${input.handledByName})`;
}
