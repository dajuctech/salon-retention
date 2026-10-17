// US-27 AC1: download everything held about a customer as JSON (owner only, audit-logged).
import { requireStaff } from "@/server/auth/session";
import { ForbiddenError } from "@/server/authz";
import { exportCustomer } from "@/server/staff/customers";

export async function GET(_request: Request, { params }: RouteContext<"/app/customers/[id]/export">) {
  const s = await requireStaff();
  const { id } = await params;
  try {
    const result = await exportCustomer(s, id);
    if (!result.ok) return new Response(result.message, { status: 404 });
    return new Response(JSON.stringify(result.value, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="customer-${id}.json"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    if (err instanceof ForbiddenError) return new Response("Forbidden", { status: 403 });
    throw err;
  }
}
