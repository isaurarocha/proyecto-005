// ─── Refund outcome email ───
// What the learner is told once an Admin approves or declines their Refund
// Request. There is no mail transport wired up yet, so callers log it.

import { formatPrice } from "~/lib/utils";

export type RefundDecision = "approve" | "decline";

export type RefundOutcomeEmail = {
  to: string;
  subject: string;
  body: string;
};

export function buildRefundOutcomeEmail(input: {
  learnerName: string;
  learnerEmail: string;
  courseTitle: string;
  amountPaid: number;
  decision: RefundDecision;
}): RefundOutcomeEmail {
  if (input.decision === "decline") {
    return {
      to: input.learnerEmail,
      subject: `Refund declined — ${input.courseTitle}`,
      body: [
        `Hi ${input.learnerName},`,
        "",
        `We have reviewed your Refund Request for "${input.courseTitle}" and declined it.`,
        "This decision is final.",
        "",
        "— The Cadence team",
      ].join("\n"),
    };
  }

  return {
    to: input.learnerEmail,
    subject: `Refund approved — ${input.courseTitle}`,
    body: [
      `Hi ${input.learnerName},`,
      "",
      `Your Refund Request for "${input.courseTitle}" has been approved.`,
      `We are returning ${formatPrice(input.amountPaid)}, the amount you paid.`,
      "",
      "— The Cadence team",
    ].join("\n"),
  };
}
