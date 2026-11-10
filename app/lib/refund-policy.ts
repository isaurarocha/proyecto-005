// ─── Refund policy ───
// Who may make a Refund Request, and for how much. The course page (to offer
// the button) and the refund action (to accept the request) must both ask
// this module, so the two can never disagree. See GLOSSARY.md for the terms.

export const REFUND_WINDOW_DAYS = 14;
export const REFUND_WATCH_LIMIT_SECONDS = 2 * 60 * 60;
export const REFUND_COMPLETION_LIMIT = 0.5;

export type RefundFacts = {
  purchasedAt: Date;
  today: Date;
  amountPaid: number;
  isTeamPurchase: boolean;
  seatsClaimed: number;
  secondsWatched: number;
  lessonsCompleted: number;
  lessonCount: number;
  // Any Refund Request on this purchase, pending, approved or declined.
  hasRefundRequest: boolean;
  // An approved Refund on any earlier purchase of the same course.
  hasRefundForCourse: boolean;
};

export type RefundIneligibleReason =
  | "already-requested"
  | "already-refunded-for-course"
  | "window-closed"
  | "seat-claimed"
  | "watched-too-much"
  | "completed-too-much";

export type RefundEligibility =
  | { eligible: true; amount: number; lastDayOfWindow: string }
  | { eligible: false; reason: RefundIneligibleReason };

// A local calendar day as YYYY-MM-DD, so days compare as strings.
function calendarDay(when: Date): string {
  const month = String(when.getMonth() + 1).padStart(2, "0");
  const day = String(when.getDate()).padStart(2, "0");
  return `${when.getFullYear()}-${month}-${day}`;
}

export function lastDayOfRefundWindow(purchasedAt: Date): string {
  const deadline = new Date(purchasedAt);
  deadline.setDate(deadline.getDate() + REFUND_WINDOW_DAYS);
  return calendarDay(deadline);
}

export function getRefundEligibility(facts: RefundFacts): RefundEligibility {
  if (facts.hasRefundRequest) {
    return { eligible: false, reason: "already-requested" };
  }

  if (facts.hasRefundForCourse) {
    return { eligible: false, reason: "already-refunded-for-course" };
  }

  const today = calendarDay(facts.today);
  const lastDayOfWindow = lastDayOfRefundWindow(facts.purchasedAt);
  if (today < calendarDay(facts.purchasedAt) || today > lastDayOfWindow) {
    return { eligible: false, reason: "window-closed" };
  }

  if (facts.isTeamPurchase) {
    if (facts.seatsClaimed > 0) {
      return { eligible: false, reason: "seat-claimed" };
    }
  } else {
    if (facts.secondsWatched >= REFUND_WATCH_LIMIT_SECONDS) {
      return { eligible: false, reason: "watched-too-much" };
    }

    if (
      facts.lessonCount > 0 &&
      facts.lessonsCompleted / facts.lessonCount >= REFUND_COMPLETION_LIMIT
    ) {
      return { eligible: false, reason: "completed-too-much" };
    }
  }

  return { eligible: true, amount: facts.amountPaid, lastDayOfWindow };
}

// What the refund action answers when a Refund Request is refused.
export function describeRefundIneligibility(reason: RefundIneligibleReason): {
  status: number;
  message: string;
} {
  switch (reason) {
    case "already-requested":
      return {
        status: 409,
        message: "This purchase already has a Refund Request.",
      };
    case "already-refunded-for-course":
      return {
        status: 403,
        message: "You have already had a Refund for this course.",
      };
    case "window-closed":
      return {
        status: 403,
        message: `The ${REFUND_WINDOW_DAYS}-day Refund Window has closed.`,
      };
    case "seat-claimed":
      return {
        status: 403,
        message:
          "A Team Purchase cannot be refunded once a Seat has been claimed.",
      };
    case "watched-too-much":
      return {
        status: 403,
        message: `You have watched ${REFUND_WATCH_LIMIT_SECONDS / 3600} hours or more of this course, so it can no longer be refunded.`,
      };
    case "completed-too-much":
      return {
        status: 403,
        message:
          "You have completed half or more of this course, so it can no longer be refunded.",
      };
  }
}
