// Message wording editor with AI suggestions — US-22 AC5, US-30.
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { AINotice, PageHeader, Skeleton } from "@/components/ui";
import { can } from "@/domain/permissions";
import { requireStaff } from "@/server/auth/session";
import { editableTemplates } from "@/server/staff/copy-assistant";
import { WordingEditor } from "./wording-editor";
import { requirePage } from "@/server/auth/guards";

export const instant = false;

export default async function TemplatesPage() {
  // Checked before streaming so a forbidden or missing page gets a real 404 status.
  await requirePage("ai.copyAssistant");
  return (
    <Suspense fallback={<Skeleton rows={4} />}>
      <Templates />
    </Suspense>
  );
}

async function Templates() {
  await connection();
  const s = await requireStaff();
  if (!can(s.member.role, "ai.copyAssistant")) notFound();
  const templates = await editableTemplates(s);
  return (
    <>
      <PageHeader title="Message wording" subtitle="Win-back messages" back={{ href: "/app/whatsapp/approve", label: "Approve messages" }} />
      <div className="space-y-4 px-5 pt-5 lg:mx-auto lg:max-w-4xl">
        <p className="rounded-2xl bg-accent-50 p-4 text-sm text-[#5a4210]">
          Use placeholders like {"{{first_name}}"} and {"{{booking_link}}"}; they&apos;re filled in for each customer. Offers can only appear as {"{{offer}}"}. New wording needs WhatsApp&apos;s approval before it&apos;s used.
        </p>
        <AINotice />
        {templates.map((t) => (
          <WordingEditor key={t.variant} variant={t.variant} label={t.label} current={t.current} pending={t.pending} own={t.own} />
        ))}
      </div>
    </>
  );
}
