// ─── Refund review ───
// How an Admin works through Refund Requests: the queue of pending ones, and
// approving or declining a single one. See GLOSSARY.md for the terms.

import { data } from "react-router";
import { and, asc, count, eq, isNull } from "drizzle-orm";
import { db } from "~/db";
import {
  coupons,
  courses,
  enrollments,
  purchases,
  refunds,
  users,
  RefundStatus,
} from "~/db/schema";
import {
  buildRefundOutcomeEmail,
  type RefundDecision,
  type RefundOutcomeEmail,
} from "~/lib/refund-outcome-email";

export function getPendingRefundRequests() {
  return db
    .select({
      id: refunds.id,
      reason: refunds.reason,
      requestedAt: refunds.requestedAt,
      amountPaid: purchases.amountPaid,
      learnerName: users.name,
      learnerEmail: users.email,
      courseTitle: courses.title,
      courseSlug: courses.slug,
    })
    .from(refunds)
    .innerJoin(purchases, eq(refunds.purchaseId, purchases.id))
    .innerJoin(users, eq(purchases.userId, users.id))
    .innerJoin(courses, eq(purchases.courseId, courses.id))
    .where(eq(refunds.status, RefundStatus.Requested))
    .orderBy(asc(refunds.requestedAt))
    .all();
}

function getSeatCounts(purchaseId: number) {
  const row = db
    .select({ seats: count(), claimed: count(coupons.redeemedAt) })
    .from(coupons)
    .where(eq(coupons.purchaseId, purchaseId))
    .get();

  return { seats: row?.seats ?? 0, claimed: row?.claimed ?? 0 };
}

/**
 * Approves or declines one Refund Request in a single transaction and returns
 * the email to send the learner. Throws 404 if there is no such request and
 * 409 if it is no longer pending, so a Refund is never recorded twice.
 *
 * Approving an individual purchase removes the learner's enrollment.
 * Approving a Team Purchase cancels every one of its Seats. Seats cannot be
 * claimed while a Refund Request is pending, but if one was claimed before
 * that rule existed, approval is refused (409): a Team Purchase cannot be
 * refunded once a Seat is claimed.
 */
export function resolveRefundRequest(
  refundRequestId: number,
  decision: RefundDecision,
  adminUserId: number,
  now: Date = new Date()
): RefundOutcomeEmail {
  return db.transaction(() => {
    const request = db
      .select({
        status: refunds.status,
        purchaseId: purchases.id,
        amountPaid: purchases.amountPaid,
        courseId: purchases.courseId,
        learnerId: users.id,
        learnerName: users.name,
        learnerEmail: users.email,
        courseTitle: courses.title,
      })
      .from(refunds)
      .innerJoin(purchases, eq(refunds.purchaseId, purchases.id))
      .innerJoin(users, eq(purchases.userId, users.id))
      .innerJoin(courses, eq(purchases.courseId, courses.id))
      .where(eq(refunds.id, refundRequestId))
      .get();

    if (!request) {
      throw data("Refund Request not found.", { status: 404 });
    }

    if (request.status !== RefundStatus.Requested) {
      throw data(`This Refund Request has already been ${request.status}.`, {
        status: 409,
      });
    }

    const resolvedAt = now.toISOString();

    if (decision === "approve") {
      const seatCounts = getSeatCounts(request.purchaseId);
      const isTeamPurchase = seatCounts.seats > 0;

      if (seatCounts.claimed > 0) {
        throw data(
          "A Seat of this Team Purchase has been claimed since the Refund Request was made, so it can no longer be refunded. Decline it instead.",
          { status: 409 }
        );
      }

      db.update(refunds)
        .set({
          status: RefundStatus.Approved,
          amountRefunded: request.amountPaid,
          resolvedAt,
          resolvedByUserId: adminUserId,
        })
        .where(eq(refunds.id, refundRequestId))
        .run();

      if (isTeamPurchase) {
        db.update(coupons)
          .set({ cancelledAt: resolvedAt })
          .where(
            and(
              eq(coupons.purchaseId, request.purchaseId),
              isNull(coupons.cancelledAt)
            )
          )
          .run();
      } else {
        db.delete(enrollments)
          .where(
            and(
              eq(enrollments.userId, request.learnerId),
              eq(enrollments.courseId, request.courseId)
            )
          )
          .run();
      }
    } else {
      db.update(refunds)
        .set({
          status: RefundStatus.Declined,
          resolvedAt,
          resolvedByUserId: adminUserId,
        })
        .where(eq(refunds.id, refundRequestId))
        .run();
    }

    return buildRefundOutcomeEmail({
      learnerName: request.learnerName,
      learnerEmail: request.learnerEmail,
      courseTitle: request.courseTitle,
      amountPaid: request.amountPaid,
      decision,
    });
  });
}
