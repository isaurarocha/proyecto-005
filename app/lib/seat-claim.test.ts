import { describe, expect, it } from "vitest";
import { describeSeatClaimRefusal, judgeSeatClaim } from "./seat-claim";

const claimable = {
  seatCancelled: false,
  seatClaimed: false,
  alreadyHasAccess: false,
  purchaseCountry: "US",
  claimerCountry: "US",
};

describe("judgeSeatClaim", () => {
  it("refuses a Seat whose Team Purchase was refunded", () => {
    // Cancelled outranks everything else: nothing about the claimer can
    // bring back a Seat that was paid back.
    expect(
      judgeSeatClaim({ ...claimable, seatCancelled: true, seatClaimed: true })
    ).toEqual({ claimable: false, reason: "seat-cancelled" });
  });

  it("refuses a Seat that has already been claimed", () => {
    expect(judgeSeatClaim({ ...claimable, seatClaimed: true })).toEqual({
      claimable: false,
      reason: "seat-claimed",
    });
  });

  it("refuses someone who already has access, so the Seat is not used", () => {
    expect(judgeSeatClaim({ ...claimable, alreadyHasAccess: true })).toEqual({
      claimable: false,
      reason: "already-has-access",
    });
  });

  it("refuses a PPP-discounted Seat claimed from another country", () => {
    expect(
      judgeSeatClaim({
        ...claimable,
        purchaseCountry: "IN",
        claimerCountry: "US",
      })
    ).toEqual({ claimable: false, reason: "wrong-country" });
  });
});

describe("describeSeatClaimRefusal", () => {
  it("tells the person a cancelled Seat is gone for good", () => {
    const { status, message } = describeSeatClaimRefusal("seat-cancelled", "US");
    expect(status).toBe(410);
    expect(message).toContain("refunded");
    expect(message).toContain("Team Manager");
  });

  it("explains that a discounted Seat is locked to the buyer's country", () => {
    const { status, message } = describeSeatClaimRefusal("wrong-country", "IN");
    expect(status).toBe(403);
    expect(message).toContain("India");
    expect(message).toContain("discount");
  });
});
