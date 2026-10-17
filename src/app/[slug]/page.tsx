// Customer booking page — design p1 (US-10).
import { Scissors } from "lucide-react";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense, cache } from "react";
import { ANY_BARBER, loadBookingPage, slotsFor } from "@/server/booking";
import { signFormToken } from "@/server/links";
import { BookingForm } from "./booking-form";
import { formatClock } from "@/domain/format";

// Reads live availability per request; instant client navigation isn't expected here.
export const instant = false;

// One load per request, shared by the opening-hours line and the form.
const loadPage = cache(loadBookingPage);

export default function BookingPage({ params }: PageProps<"/[slug]">) {
  // NFR-P1: everything that is the same for every salon (layout, heading) is sent straight away;
  // the salon's name, opening hours and the form stream in once the database answers. Unknown or
  // closed salons get a real 404 earlier, in src/proxy.ts.
  return (
    <div className="mx-auto w-full max-w-md">
      <header className="bg-brand-900 px-5 pb-6 pt-5 text-white">
        <div className="flex items-center gap-3">
          <div className="flex size-12 items-center justify-center rounded-xl bg-accent-500 text-brand-900">
            <Scissors className="size-6" aria-hidden />
          </div>
          <div>
            <p className="min-h-6 text-lg font-bold leading-tight">
              <Suspense fallback={null}>
                <SalonName params={params} />
              </Suspense>
            </p>
            <p className="text-sm text-white/75">
              Barbing Salon
              <Suspense fallback={null}>
                <OpenLine params={params} />
              </Suspense>
            </p>
          </div>
        </div>
        <h1 className="mt-6 text-3xl font-bold tracking-tight">Book your cut</h1>
        <p className="mt-1 text-white/85">Four quick steps. No account needed.</p>
      </header>
      <Suspense fallback={<BookingSkeleton />}>
        <BookingLoader params={params} />
      </Suspense>
    </div>
  );
}

async function SalonName({ params }: { params: PageProps<"/[slug]">["params"] }) {
  await connection();
  const data = await loadPage((await params).slug);
  return data ? <>{data.salon.name}</> : null;
}

async function OpenLine({ params }: { params: PageProps<"/[slug]">["params"] }) {
  await connection();
  const data = await loadPage((await params).slug);
  if (!data) return null;
  return <> · {data.closesTodayMin !== null ? `Open today until ${formatClock(data.closesTodayMin)}` : "Closed today"}</>;
}

async function BookingLoader({ params }: { params: PageProps<"/[slug]">["params"] }) {
  await connection();
  const { slug } = await params;
  const data = await loadPage(slug);
  if (!data || data.services.length === 0) notFound();

  // Start on the first open day that still has a free slot for the default choice.
  const serviceId = data.services[0].id;
  let dateKey = data.days.find((d) => !d.closed)?.key ?? data.days[0].key;
  let slots = await slotsFor(data.salon, serviceId, ANY_BARBER, dateKey);
  for (const day of data.days.filter((d) => !d.closed)) {
    const s = day.key === dateKey ? slots : await slotsFor(data.salon, serviceId, ANY_BARBER, day.key);
    if (s.some((x) => x.available)) {
      dateKey = day.key;
      slots = s;
      break;
    }
  }

  return (
    <>
      <BookingForm
        slug={slug}
        timeZone={data.salon.timezone}
        currency={data.salon.currency}
        services={data.services}
        barbers={data.barbers}
        days={data.days}
        initial={{ serviceId, dateKey, slots }}
        formToken={signFormToken()}
      />
    </>
  );
}

function BookingSkeleton() {
  return (
    <div className="animate-pulse" aria-busy="true" aria-label="Loading booking form">
      <div className="space-y-3 p-5">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="h-16 rounded-2xl bg-card" />
        ))}
      </div>
    </div>
  );
}
