// CSV export for the report period (owner only). No customer names or numbers are included.
import { requireStaff } from "@/server/auth/session";
import { ForbiddenError } from "@/server/authz";
import { reportCsv } from "@/server/staff/queries/reports";

export async function GET(request: Request) {
  const s = await requireStaff();
  const days = [7, 30, 90].includes(Number(new URL(request.url).searchParams.get("days"))) ? Number(new URL(request.url).searchParams.get("days")) : 30;
  try {
    const csv = await reportCsv(s, days);
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="report-${days}-days.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    if (err instanceof ForbiddenError) return new Response("Forbidden", { status: 403 });
    throw err;
  }
}
