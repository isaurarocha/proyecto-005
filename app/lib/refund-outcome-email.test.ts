import { describe, it, expect } from "vitest";
import { buildRefundOutcomeEmail } from "./refund-outcome-email";

const LEARNER = {
  learnerName: "Ada",
  learnerEmail: "ada@example.com",
  courseTitle: "Intro to TypeScript",
  amountPaid: 4900,
};

describe("refund outcome email", () => {
  it("tells the learner their Refund Request was approved, for the amount paid", () => {
    const email = buildRefundOutcomeEmail({ ...LEARNER, decision: "approve" });

    expect(email.to).toBe("ada@example.com");
    expect(email.subject).toBe("Refund approved — Intro to TypeScript");
    expect(email.body).toContain("Hi Ada,");
    expect(email.body).toContain("$49.00");
  });

  it("tells the learner their Refund Request was declined, and that the decision is final", () => {
    const email = buildRefundOutcomeEmail({ ...LEARNER, decision: "decline" });

    expect(email.to).toBe("ada@example.com");
    expect(email.subject).toBe("Refund declined — Intro to TypeScript");
    expect(email.body).toContain("Hi Ada,");
    expect(email.body).toContain("declined");
    expect(email.body).toContain("This decision is final.");
    expect(email.body).not.toContain("$49.00");
  });
});
