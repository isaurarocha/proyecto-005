// ─── Refund offer ───
// Gathers the facts about a learner's purchase of a course and asks the
// refund policy whether a Refund Request would be accepted. The course page
// (to show the offer) and the refund action (to accept the request) both call
// this, so they always agree.

import { and, count, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "~/db";
import {
  coupons,
  lessonProgress,
  purchases,
  refunds,
  videoWatchEvents,
  LessonProgressStatus,
  RefundStatus,
} from "~/db/schema";
import {
  getRefundEligibility,
  type RefundEligibility,
  type RefundFacts,
} from "~/lib/refund-policy";
import { getCourseLessonIds } from "~/lib/course-lessons.server";

type Purchase = typeof purchases.$inferSelect;

export type RefundOffer = {
  purchase: Purchase;
  isTeamPurchase: boolean;
  eligibility: RefundEligibility;
};

function getLatestPurchase(userId: number, courseId: number) {
  return db
    .select()
    .from(purchases)
    .where(and(eq(purchases.userId, userId), eq(purchases.courseId, courseId)))
    .orderBy(sql`${purchases.createdAt} desc`)
    .get();
}

// The sum of the furthest point reached in each lesson of the course.
function getSecondsWatched(userId: number, lessonIds: number[]) {
  if (lessonIds.length === 0) return 0;

  return db
    .select({
      furthest: sql<number>`max(${videoWatchEvents.positionSeconds})`,
    })
    .from(videoWatchEvents)
    .where(
      and(
        eq(videoWatchEvents.userId, userId),
        inArray(videoWatchEvents.lessonId, lessonIds)
      )
    )
    .groupBy(videoWatchEvents.lessonId)
    .all()
    .reduce((total, row) => total + row.furthest, 0);
}

function getLessonsCompleted(userId: number, lessonIds: number[]) {
  if (lessonIds.length === 0) return 0;

  const row = db
    .select({ completed: count() })
    .from(lessonProgress)
    .where(
      and(
        eq(lessonProgress.userId, userId),
        eq(lessonProgress.status, LessonProgressStatus.Completed),
        inArray(lessonProgress.lessonId, lessonIds)
      )
    )
    .get();

  return row?.completed ?? 0;
}

function getSeatCounts(purchaseId: number) {
  const row = db
    .select({
      seats: count(),
      claimed: count(coupons.redeemedAt),
    })
    .from(coupons)
    .where(eq(coupons.purchaseId, purchaseId))
    .get();

  return { seats: row?.seats ?? 0, claimed: row?.claimed ?? 0 };
}

function hasRefundRequest(purchaseId: number) {
  return !!db
    .select({ id: refunds.id })
    .from(refunds)
    .where(eq(refunds.purchaseId, purchaseId))
    .get();
}

// An approved Refund on any other purchase of the same course.
function hasRefundForCourse(purchase: Purchase) {
  return !!db
    .select({ id: refunds.id })
    .from(refunds)
    .innerJoin(purchases, eq(refunds.purchaseId, purchases.id))
    .where(
      and(
        eq(purchases.userId, purchase.userId),
        eq(purchases.courseId, purchase.courseId),
        ne(purchases.id, purchase.id),
        eq(refunds.status, RefundStatus.Approved)
      )
    )
    .get();
}

function gatherRefundFacts(purchase: Purchase, today: Date): RefundFacts {
  const lessonIds = getCourseLessonIds(purchase.courseId);
  const seatCounts = getSeatCounts(purchase.id);

  return {
    purchasedAt: new Date(purchase.createdAt),
    today,
    amountPaid: purchase.amountPaid,
    isTeamPurchase: seatCounts.seats > 0,
    seatsClaimed: seatCounts.claimed,
    secondsWatched: getSecondsWatched(purchase.userId, lessonIds),
    lessonsCompleted: getLessonsCompleted(purchase.userId, lessonIds),
    lessonCount: lessonIds.length,
    hasRefundRequest: hasRefundRequest(purchase.id),
    hasRefundForCourse: hasRefundForCourse(purchase),
  };
}

/**
 * Whether the learner's latest purchase of the course could be refunded, or
 * null if they have never bought it.
 */
export function getRefundOffer(
  userId: number,
  courseId: number,
  today: Date = new Date()
): RefundOffer | null {
  const purchase = getLatestPurchase(userId, courseId);
  if (!purchase) return null;

  const facts = gatherRefundFacts(purchase, today);

  return {
    purchase,
    isTeamPurchase: facts.isTeamPurchase,
    eligibility: getRefundEligibility(facts),
  };
}
