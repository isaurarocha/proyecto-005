import { describe, it, expect } from "vitest";
import {
  REFUND_COMPLETION_LIMIT,
  REFUND_WATCH_LIMIT_SECONDS,
  REFUND_WINDOW_DAYS,
  describeRefundIneligibility,
  getRefundEligibility,
  type RefundFacts,
} from "./refund-policy";

// Dates are built from local parts on purpose: the Refund Window counts
// calendar days, so a learner who buys at 23:00 still gets the whole of their
// fourteenth day.
const PURCHASED_AT = new Date(2026, 0, 1, 23, 0);

function individualPurchase(overrides: Partial<RefundFacts> = {}): RefundFacts {
  return {
    purchasedAt: PURCHASED_AT,
    today: new Date(2026, 0, 2, 9, 0),
    amountPaid: 4900,
    isTeamPurchase: false,
    seatsClaimed: 0,
    secondsWatched: 0,
    lessonsCompleted: 0,
    lessonCount: 10,
    hasRefundRequest: false,
    hasRefundForCourse: false,
    ...overrides,
  };
}

function teamPurchase(overrides: Partial<RefundFacts> = {}): RefundFacts {
  return individualPurchase({
    isTeamPurchase: true,
    amountPaid: 49000,
    ...overrides,
  });
}

describe("refund policy", () => {
  describe("the limits", () => {
    it("pins the numbers the learner is told about", () => {
      expect(REFUND_WINDOW_DAYS).toBe(14);
      expect(REFUND_WATCH_LIMIT_SECONDS).toBe(2 * 60 * 60);
      expect(REFUND_COMPLETION_LIMIT).toBe(0.5);
    });
  });

  describe("an individual purchase", () => {
    it("is eligible the day after it was bought", () => {
      expect(getRefundEligibility(individualPurchase())).toEqual({
        eligible: true,
        amount: 4900,
        lastDayOfWindow: "2026-01-15",
      });
    });

    it("is eligible on the day it was bought", () => {
      const result = getRefundEligibility(
        individualPurchase({ today: new Date(2026, 0, 1, 23, 30) })
      );
      expect(result.eligible).toBe(true);
    });

    it("is eligible on the last day of the Refund Window, up to midnight", () => {
      const result = getRefundEligibility(
        individualPurchase({ today: new Date(2026, 0, 15, 23, 59) })
      );
      expect(result.eligible).toBe(true);
    });

    it("is not eligible once the Refund Window has closed", () => {
      expect(
        getRefundEligibility(
          individualPurchase({ today: new Date(2026, 0, 16, 0, 1) })
        )
      ).toEqual({ eligible: false, reason: "window-closed" });
    });

    it("is not eligible before it was bought", () => {
      // A clock that runs behind must not open a window early.
      expect(
        getRefundEligibility(
          individualPurchase({ today: new Date(2025, 11, 31, 12, 0) })
        )
      ).toEqual({ eligible: false, reason: "window-closed" });
    });

    it("refunds exactly the amount paid, never the list price", () => {
      // A coupon or PPP price is what came in, so it is what goes back.
      const result = getRefundEligibility(
        individualPurchase({ amountPaid: 1470 })
      );
      expect(result).toMatchObject({ eligible: true, amount: 1470 });
    });

    it("is eligible just under two hours watched", () => {
      const result = getRefundEligibility(
        individualPurchase({ secondsWatched: REFUND_WATCH_LIMIT_SECONDS - 1 })
      );
      expect(result.eligible).toBe(true);
    });

    it("is not eligible at two hours watched", () => {
      expect(
        getRefundEligibility(
          individualPurchase({ secondsWatched: REFUND_WATCH_LIMIT_SECONDS })
        )
      ).toEqual({ eligible: false, reason: "watched-too-much" });
    });

    it("is eligible just under half the lessons completed", () => {
      const result = getRefundEligibility(
        individualPurchase({ lessonsCompleted: 4, lessonCount: 10 })
      );
      expect(result.eligible).toBe(true);
    });

    it("is not eligible at half the lessons completed", () => {
      expect(
        getRefundEligibility(
          individualPurchase({ lessonsCompleted: 5, lessonCount: 10 })
        )
      ).toEqual({ eligible: false, reason: "completed-too-much" });
    });

    it("is eligible for a course with no lessons", () => {
      const result = getRefundEligibility(
        individualPurchase({ lessonsCompleted: 0, lessonCount: 0 })
      );
      expect(result.eligible).toBe(true);
    });

    it("is not eligible once it has a Refund Request, whatever its outcome", () => {
      // One Refund Request per purchase, and a decline is final.
      expect(
        getRefundEligibility(individualPurchase({ hasRefundRequest: true }))
      ).toEqual({ eligible: false, reason: "already-requested" });
    });

    it("is not eligible when the learner was already refunded for this course", () => {
      // Buy, watch, refund, buy again: the second purchase gets no Refund.
      expect(
        getRefundEligibility(individualPurchase({ hasRefundForCourse: true }))
      ).toEqual({ eligible: false, reason: "already-refunded-for-course" });
    });
  });

  describe("a Team Purchase", () => {
    it("is eligible for the whole amount while no Seat is claimed", () => {
      expect(getRefundEligibility(teamPurchase())).toEqual({
        eligible: true,
        amount: 49000,
        lastDayOfWindow: "2026-01-15",
      });
    });

    it("is not eligible once any Seat is claimed", () => {
      expect(getRefundEligibility(teamPurchase({ seatsClaimed: 1 }))).toEqual({
        eligible: false,
        reason: "seat-claimed",
      });
    });

    it("ignores how much was watched or completed", () => {
      // The Team Manager does not take the course; those limits are about the
      // person who learned from it.
      const result = getRefundEligibility(
        teamPurchase({
          secondsWatched: REFUND_WATCH_LIMIT_SECONDS * 3,
          lessonsCompleted: 10,
          lessonCount: 10,
        })
      );
      expect(result.eligible).toBe(true);
    });

    it("still closes with the Refund Window", () => {
      expect(
        getRefundEligibility(teamPurchase({ today: new Date(2026, 0, 16, 9, 0) }))
      ).toEqual({ eligible: false, reason: "window-closed" });
    });

    it("is not eligible once it has a Refund Request", () => {
      expect(
        getRefundEligibility(teamPurchase({ hasRefundRequest: true }))
      ).toEqual({ eligible: false, reason: "already-requested" });
    });
  });

  describe("telling the learner why not", () => {
    it("answers a second Refund Request on the same purchase with a conflict", () => {
      expect(describeRefundIneligibility("already-requested")).toEqual({
        status: 409,
        message: "This purchase already has a Refund Request.",
      });
    });

    it.each([
      [
        "already-refunded-for-course",
        "You have already had a Refund for this course.",
      ],
      ["window-closed", "The 14-day Refund Window has closed."],
      [
        "seat-claimed",
        "A Team Purchase cannot be refunded once a Seat has been claimed.",
      ],
      [
        "watched-too-much",
        "You have watched 2 hours or more of this course, so it can no longer be refunded.",
      ],
      [
        "completed-too-much",
        "You have completed 50% or more of this course, so it can no longer be refunded.",
      ],
    ] as const)("refuses %s in plain words", (reason, message) => {
      expect(describeRefundIneligibility(reason)).toEqual({
        status: 403,
        message,
      });
    });
  });
});
