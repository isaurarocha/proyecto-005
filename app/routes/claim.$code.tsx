import { Link, useFetcher, redirect, data } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/claim.$code";
import { getCurrentUserId } from "~/lib/session";
import { resolveCountry } from "~/lib/country.server";
import { parseParams, parseFormData } from "~/lib/validation";
import { describeSeatClaimRefusal, judgeSeatClaim } from "~/lib/seat-claim";
import { Card, CardContent } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { Ticket, AlertCircle, CheckCircle2, Globe } from "lucide-react";
import { db } from "~/db";
import { purchases, coupons, courses, enrollments } from "~/db/schema";
import { eq, and, isNull } from "drizzle-orm";

// Served at /claim/:code, and at /redeem/:code for Seat Links shared before
// the rename. The `coupons` table holds Seats; its columns keep their names.

function getCourseById(id: number) {
  return db.select().from(courses).where(eq(courses.id, id)).get();
}

function getSeatByCode(code: string) {
  return db.select().from(coupons).where(eq(coupons.code, code)).get();
}

function hasAccess(userId: number, courseId: number) {
  const existing = db
    .select()
    .from(enrollments)
    .where(
      and(eq(enrollments.userId, userId), eq(enrollments.courseId, courseId))
    )
    .get();

  return existing !== undefined;
}

function getPurchaseCountry(purchaseId: number) {
  const purchase = db
    .select()
    .from(purchases)
    .where(eq(purchases.id, purchaseId))
    .get();
  return purchase?.country ?? null;
}

function judgeClaimFor(
  seat: typeof coupons.$inferSelect,
  userId: number,
  claimerCountry: string | null
) {
  const purchaseCountry = getPurchaseCountry(seat.purchaseId);
  const judgement = judgeSeatClaim({
    seatCancelled: seat.cancelledAt !== null,
    seatClaimed: seat.redeemedByUserId !== null,
    alreadyHasAccess: hasAccess(userId, seat.courseId),
    purchaseCountry,
    claimerCountry,
  });
  return { judgement, purchaseCountry };
}

const claimParamsSchema = z.object({
  code: z.string().min(1),
});

const claimActionSchema = z.object({
  intent: z.literal("claim-seat"),
});

export function meta({ loaderData }: Route.MetaArgs) {
  const title = loaderData?.course?.title ?? "Claim this Seat";
  return [
    { title: `Claim a Seat: ${title} — Cadence` },
    { name: "description", content: `Claim your Seat in ${title}` },
  ];
}

export async function loader({ params, request }: Route.LoaderArgs) {
  const { code } = parseParams(params, claimParamsSchema);

  const seat = getSeatByCode(code);
  if (!seat) {
    throw data("Seat not found.", { status: 404 });
  }

  const currentUserId = await getCurrentUserId(request);
  if (!currentUserId) {
    throw redirect(`/login?redirectTo=${encodeURIComponent(`/claim/${code}`)}`);
  }

  const course = getCourseById(seat.courseId);
  if (!course) {
    throw data("Course not found.", { status: 404 });
  }

  const claimerCountry = await resolveCountry(request);
  const { judgement, purchaseCountry } = judgeClaimFor(
    seat,
    currentUserId,
    claimerCountry
  );

  const refusal = judgement.claimable
    ? null
    : {
        reason: judgement.reason,
        ...describeSeatClaimRefusal(judgement.reason, purchaseCountry),
      };

  return {
    course: { id: course.id, title: course.title, slug: course.slug },
    code,
    refusal,
  };
}

export async function action({ params, request }: Route.ActionArgs) {
  const { code } = parseParams(params, claimParamsSchema);

  const currentUserId = await getCurrentUserId(request);
  if (!currentUserId) {
    throw data("You must be logged in.", { status: 401 });
  }

  const formData = await request.formData();
  const parsed = parseFormData(formData, claimActionSchema);
  if (!parsed.success) {
    throw data("Invalid action.", { status: 400 });
  }

  const claimerCountry = await resolveCountry(request);

  // Judge and record in one transaction, so two people opening the same Seat
  // Link at once cannot both claim the Seat.
  const courseId = db.transaction(() => {
    const seat = getSeatByCode(code);
    if (!seat) {
      throw data("Seat not found.", { status: 404 });
    }

    const { judgement, purchaseCountry } = judgeClaimFor(
      seat,
      currentUserId,
      claimerCountry
    );
    if (!judgement.claimable) {
      const { status, message } = describeSeatClaimRefusal(
        judgement.reason,
        purchaseCountry
      );
      throw data(message, { status });
    }

    db.update(coupons)
      .set({
        redeemedByUserId: currentUserId,
        redeemedAt: new Date().toISOString(),
      })
      .where(and(eq(coupons.id, seat.id), isNull(coupons.redeemedByUserId)))
      .run();

    db.insert(enrollments)
      .values({ userId: currentUserId, courseId: seat.courseId })
      .run();

    return seat.courseId;
  });

  const course = getCourseById(courseId);
  if (!course) {
    throw redirect("/courses");
  }

  throw redirect(`/courses/${course.slug}/welcome`);
}

export default function ClaimSeat({ loaderData }: Route.ComponentProps) {
  const { course, code, refusal } = loaderData;
  const fetcher = useFetcher();
  const isSubmitting = fetcher.state !== "idle";

  return (
    <div className="mx-auto max-w-2xl p-6 lg:p-8">
      <h1 className="mb-2 text-2xl font-bold">Claim this Seat</h1>
      <p className="mb-8 text-muted-foreground">
        Someone has sent you a Seat Link for this course.
      </p>

      <Card>
        <CardContent className="p-8 text-center">
          <div className="mb-4 inline-flex size-16 items-center justify-center rounded-full bg-primary/10">
            <Ticket className="size-8 text-primary" />
          </div>

          <h2 className="mb-2 text-xl font-semibold">{course.title}</h2>
          <p className="mb-6 text-sm text-muted-foreground">
            Seat Link code:{" "}
            <code className="rounded bg-muted px-2 py-0.5">{code}</code>
          </p>

          {refusal?.reason === "seat-claimed" ||
          refusal?.reason === "seat-cancelled" ? (
            <div className="rounded-lg bg-destructive/10 p-4">
              <div className="flex items-center justify-center gap-2 text-destructive">
                <AlertCircle className="size-5" />
                <span className="font-medium">{refusal.title}</span>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                {refusal.message}
              </p>
            </div>
          ) : refusal?.reason === "already-has-access" ? (
            <div className="rounded-lg bg-green-50 p-4 dark:bg-green-900/20">
              <div className="flex items-center justify-center gap-2 text-green-700 dark:text-green-400">
                <CheckCircle2 className="size-5" />
                <span className="font-medium">{refusal.title}</span>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                {refusal.message}
              </p>
              <Link to={`/courses/${course.slug}`}>
                <Button className="mt-4" size="lg">
                  Go to Course
                </Button>
              </Link>
            </div>
          ) : refusal?.reason === "wrong-country" ? (
            <div className="rounded-lg bg-amber-50 p-4 dark:bg-amber-900/20">
              <div className="flex items-center justify-center gap-2 text-amber-700 dark:text-amber-400">
                <Globe className="size-5" />
                <span className="font-medium">{refusal.title}</span>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                {refusal.message}
              </p>
            </div>
          ) : (
            <fetcher.Form method="post">
              <input type="hidden" name="intent" value="claim-seat" />
              <Button
                size="lg"
                className="w-full max-w-sm"
                disabled={isSubmitting}
              >
                {isSubmitting ? "Claiming..." : "Claim this Seat"}
              </Button>
            </fetcher.Form>
          )}

          <div className="mt-6">
            <Link
              to={`/courses/${course.slug}`}
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              View course details
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
