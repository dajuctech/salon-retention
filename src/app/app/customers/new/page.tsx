import { connection } from "next/server";
import { Suspense } from "react";
import { PageHeader, Skeleton } from "@/components/ui";
import { COUNTRIES } from "@/domain/countries";
import { requireStaff } from "@/server/auth/session";
import { forSalon } from "@/server/db";
import { CustomerForm } from "../customer-form";

export const instant = false;

export default function NewCustomerPage() {
  return (
    <Suspense fallback={<Skeleton rows={6} />}>
      <NewCustomer />
    </Suspense>
  );
}

async function NewCustomer() {
  await connection();
  const s = await requireStaff();
  const barbers = await forSalon(s.member.salonId).barber.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } });
  return (
    <>
      <PageHeader title="Add customer" back={{ href: "/app/customers", label: "Customers" }} />
      <div className="px-5 pt-5">
        <CustomerForm
          initial={null}
          barbers={barbers.map((b) => ({ id: b.id, name: b.displayName }))}
          phonePlaceholder={COUNTRIES[s.salon.countryCode]?.samplePhone ?? ""}
        />
      </div>
    </>
  );
}
