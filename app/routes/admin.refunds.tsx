import { useEffect } from "react";
import { data, isRouteErrorResponse, Link, useFetcher } from "react-router";
import { toast } from "sonner";
import { z } from "zod";
import { eq } from "drizzle-orm";
import type { Route } from "./+types/admin.refunds";
import { db } from "~/db";
import { users, UserRole } from "~/db/schema";
import { requireUserId } from "~/lib/access.server";
import { parseFormData } from "~/lib/validation";
import {
  getPendingRefundRequests,
  resolveRefundRequest,
} from "~/lib/refund-review.server";
import { formatPrice } from "~/lib/utils";
import { Card, CardContent } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { AlertTriangle, ReceiptText } from "lucide-react";

const refundDecisionSchema = z.object({
  refundRequestId: z.coerce.number().int().positive(),
  decision: z.enum(["approve", "decline"]),
});

/** Throws 401 when signed out and 403 for anyone but a platform Admin. */
async function requireAdmin(request: Request) {
  const userId = await requireUserId(request);
  const user = db.select().from(users).where(eq(users.id, userId)).get();

  if (!user || user.role !== UserRole.Admin) {
    throw data("Only Admins can review Refund Requests.", { status: 403 });
  }

  return userId;
}

export function meta() {
  return [
    { title: "Refund Requests — Cadence" },
    { name: "description", content: "Approve or decline Refund Requests" },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request);

  return { refundRequests: getPendingRefundRequests() };
}

export async function action({ request }: Route.ActionArgs) {
  const adminUserId = await requireAdmin(request);

  const formData = await request.formData();
  const parsed = parseFormData(formData, refundDecisionSchema);

  if (!parsed.success) {
    throw data("Invalid Refund Request decision.", { status: 400 });
  }

  const { refundRequestId, decision } = parsed.data;
  const email = resolveRefundRequest(refundRequestId, decision, adminUserId);

  console.log(`[email] to=${email.to} subject=${email.subject}\n${email.body}`);

  return { decision };
}

type PendingRefundRequest =
  Route.ComponentProps["loaderData"]["refundRequests"][number];

function RefundRequestRow({
  refundRequest,
}: {
  refundRequest: PendingRefundRequest;
}) {
  const fetcher = useFetcher<typeof action>();
  const isSubmitting = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data) {
      toast.success(
        fetcher.data.decision === "approve"
          ? "Refund approved."
          : "Refund Request declined."
      );
    }
  }, [fetcher.state, fetcher.data]);

  return (
    <tr className="border-b border-border align-top last:border-0">
      <td className="px-4 py-3">
        <div className="text-sm font-medium">{refundRequest.learnerName}</div>
        <div className="text-xs text-muted-foreground">
          {refundRequest.learnerEmail}
        </div>
      </td>
      <td className="px-4 py-3 text-sm">
        <Link
          to={`/courses/${refundRequest.courseSlug}`}
          className="hover:underline"
        >
          {refundRequest.courseTitle}
        </Link>
      </td>
      <td className="px-4 py-3 text-sm">
        {formatPrice(refundRequest.amountPaid)}
      </td>
      <td className="max-w-sm px-4 py-3 text-sm whitespace-pre-wrap">
        {refundRequest.reason}
      </td>
      <td className="px-4 py-3 text-sm text-muted-foreground">
        {new Date(refundRequest.requestedAt).toLocaleDateString()}
      </td>
      <td className="px-4 py-3">
        <fetcher.Form method="post" className="flex items-center gap-2">
          <input
            type="hidden"
            name="refundRequestId"
            value={refundRequest.id}
          />
          <Button
            type="submit"
            name="decision"
            value="approve"
            size="sm"
            disabled={isSubmitting}
          >
            Approve
          </Button>
          <Button
            type="submit"
            name="decision"
            value="decline"
            size="sm"
            variant="outline"
            disabled={isSubmitting}
          >
            Decline
          </Button>
        </fetcher.Form>
      </td>
    </tr>
  );
}

export default function AdminRefunds({ loaderData }: Route.ComponentProps) {
  const { refundRequests } = loaderData;

  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-8">
      <nav className="mb-6 text-sm text-muted-foreground">
        <Link to="/" className="hover:text-foreground">
          Home
        </Link>
        <span className="mx-2">/</span>
        <span className="text-foreground">Refund Requests</span>
      </nav>

      <div className="mb-8">
        <h1 className="text-3xl font-bold">Refund Requests</h1>
        <p className="mt-1 text-muted-foreground">
          Approve or decline each pending Refund Request. An approved Refund
          returns the amount paid; a decline is final.
        </p>
      </div>

      {refundRequests.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center">
            <ReceiptText className="mx-auto mb-3 size-8 text-muted-foreground/50" />
            <p className="text-muted-foreground">No pending Refund Requests.</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border bg-muted/50">
                    {[
                      "Learner",
                      "Course",
                      "Amount paid",
                      "Reason",
                      "Requested",
                      "Decision",
                    ].map((heading) => (
                      <th
                        key={heading}
                        className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground"
                      >
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {refundRequests.map((refundRequest) => (
                    <RefundRequestRow
                      key={refundRequest.id}
                      refundRequest={refundRequest}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = "Something went wrong";
  let message = "An unexpected error occurred while loading Refund Requests.";

  if (isRouteErrorResponse(error)) {
    if (error.status === 401) {
      title = "Sign in required";
    } else if (error.status === 403) {
      title = "Access denied";
    } else {
      title = `Error ${error.status}`;
    }
    message = typeof error.data === "string" ? error.data : error.statusText;
  }

  return (
    <div className="flex min-h-[50vh] items-center justify-center p-6">
      <div className="text-center">
        <AlertTriangle className="mx-auto mb-4 size-12 text-muted-foreground" />
        <h1 className="mb-2 text-2xl font-bold">{title}</h1>
        <p className="mb-6 text-muted-foreground">{message}</p>
        <Link to="/admin/refunds">
          <Button>Back to Refund Requests</Button>
        </Link>
      </div>
    </div>
  );
}
