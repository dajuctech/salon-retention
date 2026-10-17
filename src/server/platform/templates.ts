// Platform-wide templates (salonId = null) mirrored from src/domain/templates.ts.
// With the console provider they count as approved; with a real provider they start PENDING
// until Meta approves them (docs/whatsapp-templates.md).
import { PLATFORM_TEMPLATES } from "@/domain/templates";
import { unscopedDb } from "@/server/db";

export async function ensurePlatformTemplates(): Promise<number> {
  const db = unscopedDb();
  const approval = (process.env.MESSAGING_PROVIDER ?? "console") === "console" ? "APPROVED" : "PENDING";
  let created = 0;
  for (const t of PLATFORM_TEMPLATES) {
    // salonId is NULL, which a compound unique can't match, so look up first.
    const existing = await db.messageTemplate.findFirst({ where: { salonId: null, name: t.name, language: "en" } });
    if (existing) continue;
    await db.messageTemplate.create({
      data: {
        name: t.name,
        type: t.type,
        category: t.category,
        variant: t.variant ?? null,
        body: t.body,
        variables: t.variables,
        approval,
      },
    });
    created++;
  }
  return created;
}
