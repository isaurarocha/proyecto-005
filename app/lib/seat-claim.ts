// ─── Seat claims ───
// Whether a person may claim a Seat. The claim page (to show the right
// banner) and the claim action (to accept the claim) must both ask this
// module, so the two can never disagree. See GLOSSARY.md for the terms.

import { canClaimSeatFromCountry, countryName } from "./ppp";

export type SeatClaimFacts = {
  seatCancelled: boolean;
  // The Team Purchase this Seat came from has a Refund Request waiting.
  refundPending: boolean;
  seatClaimed: boolean;
  alreadyHasAccess: boolean;
  purchaseCountry: string | null;
  claimerCountry: string | null;
};

export type SeatClaimRefusal =
  | "seat-cancelled"
  | "refund-pending"
  | "seat-claimed"
  | "already-has-access"
  | "wrong-country";

export type SeatClaimJudgement =
  | { claimable: true }
  | { claimable: false; reason: SeatClaimRefusal };

export function judgeSeatClaim(facts: SeatClaimFacts): SeatClaimJudgement {
  if (facts.seatCancelled) {
    return { claimable: false, reason: "seat-cancelled" };
  }

  if (facts.refundPending) {
    return { claimable: false, reason: "refund-pending" };
  }

  if (facts.seatClaimed) {
    return { claimable: false, reason: "seat-claimed" };
  }

  if (facts.alreadyHasAccess) {
    return { claimable: false, reason: "already-has-access" };
  }

  if (!canClaimSeatFromCountry(facts.purchaseCountry, facts.claimerCountry)) {
    return { claimable: false, reason: "wrong-country" };
  }

  return { claimable: true };
}

/**
 * What to tell the person whose claim was refused, and the HTTP status the
 * claim action answers with. The claim page shows the same words.
 */
export function describeSeatClaimRefusal(
  reason: SeatClaimRefusal,
  purchaseCountry: string | null
): { status: number; title: string; message: string } {
  switch (reason) {
    case "seat-cancelled":
      return {
        status: 410,
        title: "This Seat was cancelled",
        message:
          "The Team Purchase this Seat came from was refunded, so the Seat can no longer be claimed. Ask the Team Manager who sent you this Seat Link.",
      };
    case "refund-pending":
      return {
        status: 409,
        title: "This Seat can't be claimed right now",
        message:
          "The Team Manager has asked for a Refund of the Team Purchase this Seat came from, so it can't be claimed while that is reviewed. Ask the Team Manager who sent you this Seat Link.",
      };
    case "seat-claimed":
      return {
        status: 409,
        title: "This Seat has already been claimed",
        message:
          "Someone has already claimed this Seat. Ask the Team Manager who sent you this Seat Link for another one.",
      };
    case "already-has-access":
      return {
        status: 409,
        title: "You already have access",
        message:
          "You already have access to this course, so this Seat was not used. The Team Manager can send its Seat Link to someone else.",
      };
    case "wrong-country": {
      const buyerCountry = purchaseCountry
        ? countryName(purchaseCountry)
        : "the buyer's country";
      return {
        status: 403,
        title: "This Seat can't be claimed from your country",
        message: `This Seat was bought at a regional price discount for ${buyerCountry}, so it can only be claimed from ${buyerCountry}. Seats bought at full price can be claimed from anywhere.`,
      };
    }
  }
}
