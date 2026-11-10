// ─── Seat claims ───
// Whether a person may claim a Seat. The claim page (to show the right
// banner) and the claim action (to accept the claim) must both ask this
// module, so the two can never disagree. See GLOSSARY.md for the terms.

import { canClaimSeatFromCountry, countryName } from "./ppp";

export type SeatClaimFacts = {
  seatClaimed: boolean;
  alreadyHasAccess: boolean;
  purchaseCountry: string | null;
  claimerCountry: string | null;
};

export type SeatClaimRefusal =
  | "seat-claimed"
  | "already-has-access"
  | "wrong-country";

export type SeatClaimJudgement =
  | { claimable: true }
  | { claimable: false; reason: SeatClaimRefusal };

export function judgeSeatClaim(facts: SeatClaimFacts): SeatClaimJudgement {
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
