import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { PageHeader, Skeleton } from "@/components/ui";
import { COUNTRIES } from "@/domain/countries";
import { can } from "@/domain/permissions";
import { requireStaff } from "@/server/auth/session";
import { forSalon } from "@/server/db";
import { CustomerForm, MergeForm } from "../../customer-form";
import { requirePage, requireRecord } from "@/server/auth/guards";

export const instant = false;

export default async function EditCustomerPage({ params }: PageProps<"/app/customers/[id]/edit">) {
  // Checked before streaming so a forbidden or missing page gets a real 404 status.
  await requirePage("customers.edit");
  await requireRecord("customer", (await params).id);
  return (
    <Suspense fallback={<Skeleton rows={6} />}>
      <EditCustomer params={params} />
    </Suspense>
  );
}

async function EditCustomer({ params }: { params: PageProps<"/app/customers/[id]/edit">["params"] }) {
  await connection();
  const s = await requireStaff();
  if (!can(s.member.role, "customers.edit")) notFound();
  const { id } = await params;
  const db = forSalon(s.member.salonId);
  const [c, barbers] = await Promise.all([
    db.customer.findFirst({ where: { id, anonymisedAt: null } }),
    db.barber.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
  ]);
  if (!c) notFound();
  // Likely duplicates: same first name, or a phone ending in the same digits.
  const others = await db.customer.findMany({
    where: {
      id: { not: c.id },
      anonymisedAt: null,
      OR: [{ name: { startsWith: c.name.split(" ")[0], mode: "insensitive" } }, { phoneE164: { endsWith: c.phoneE164.slice(-6) } }],
    },
    take: 20,
  });
  return (
    <>
      <PageHeader title={`Edit ${c.name.split(" ")[0]}`} back={{ href: `/app/customers/${c.id}`, label: c.name }} />
      <div className="space-y-6 px-5 pt-5">
        <CustomerForm
          initial={{ ...c, phone: c.phoneE164 }}
          barbers={barbers.map((b) => ({ id: b.id, name: b.displayName }))}
          phonePlaceholder={COUNTRIES[s.salon.countryCode]?.samplePhone ?? ""}
        />
        {can(s.member.role, "customers.merge") && (
          <MergeForm keepId={c.id} others={others.map((o) => ({ id: o.id, label: `${o.name} · ${o.phoneE164} · ${o.visitCount} visits` }))} />
        )}
      </div>
    </>
  );
}
