"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  bookingInput,
  cancelByCustomer,
  createOnlineBooking,
  loadBookingByToken,
  rescheduleByCustomer,
  slotsFor,
  type SlotOption,
} from "@/server/booking";
import { findSalonBySlug } from "@/server/db";
import { checkFormToken } from "@/server/links";
import { allowPublicRequest } from "@/server/platform/rate-limit";
import { DATE_KEY } from "@/server/slots";

export async function getSlotsAction(
  slug: string,
  serviceId: string,
  barber: string,
  dateKey: string,
): Promise<SlotOption[]> {
  if (!DATE_KEY.test(dateKey)) return [];
  const salon = await findSalonBySlug(slug);
  if (!salon?.bookingEnabled) return [];
  return slotsFor(salon, serviceId, barber, dateKey);
}

export type BookingFormState = { error: string; code: "invalid" | "invalid_phone" | "slot_taken" | "rate_limited" } | null;

export async function createBookingAction(
  slug: string,
  _prev: BookingFormState,
  formData: FormData,
): Promise<BookingFormState> {
  const salon = await findSalonBySlug(slug);
  if (!salon?.bookingEnabled) return { code: "invalid", error: "Online booking is not available right now." };

  const parsed = bookingInput.safeParse({
    serviceId: formData.get("serviceId"),
    barber: formData.get("barber"),
    startsAt: formData.get("startsAt"),
    name: formData.get("name"),
    phone: formData.get("phone"),
    marketing: formData.get("marketing") === "on",
  });
  if (!parsed.success) {
    return { code: "invalid", error: parsed.error.issues[0]?.message ?? "Please check your details." };
  }
  // US-10 AC4: bot protection. A filled honeypot or a forged/instant form is refused.
  if (String(formData.get("website") ?? "") !== "") return { code: "invalid", error: "Something went wrong. Please try again." };
  const form = checkFormToken(String(formData.get("formToken") ?? ""));
  if (form === "invalid" || form === "expired") return { code: "invalid", error: "This page has expired. Please refresh and try again." };
  if (form === "too_fast") return { code: "invalid", error: "Please check your details, then press Confirm again." };
  // Limits per phone number and per network address.
  const ip = ((await headers()).get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  if (!(await allowPublicRequest(`book-ip:${ip}`, Number(process.env.BOOKING_LIMIT_PER_IP ?? 20), 3600))) {
    return { code: "rate_limited", error: "Too many bookings from this connection. Please try again later." };
  }
  if (!(await allowPublicRequest(`book:${salon.id}:${parsed.data.phone.replace(/\D/g, "")}`, 5, 3600))) {
    return { code: "rate_limited", error: "Too many bookings from this number. Please contact the salon." };
  }

  const result = await createOnlineBooking(salon, parsed.data);
  if (!result.ok) return { code: result.error, error: result.message };
  redirect(`/${slug}/booking/${result.token}`);
}

export type ManageState = { error: string } | null;

export async function cancelBookingAction(slug: string, token: string): Promise<ManageState> {
  const result = await cancelByCustomer(slug, token);
  if (!result.ok) return { error: result.message };
  redirect(`/${slug}/booking/${result.token}`);
}

export async function rescheduleSlotsAction(slug: string, token: string, dateKey: string): Promise<SlotOption[]> {
  if (!DATE_KEY.test(dateKey)) return [];
  const data = await loadBookingByToken(slug, token);
  if (!data?.booking.canChange) return [];
  return slotsFor(data.salon, data.booking.serviceId, "any", dateKey, { ignoreBookingId: data.booking.id });
}

export async function rescheduleBookingAction(slug: string, token: string, startsAt: string): Promise<ManageState> {
  const result = await rescheduleByCustomer(slug, token, startsAt);
  if (!result.ok) return { error: result.message };
  redirect(`/${slug}/booking/${result.token}`);
}

/** "Pay now" from the customer's signed booking page. */
export async function payNowAction(slug: string, token: string): Promise<ManageState> {
  const data = await loadBookingByToken(slug, token);
  if (!data) return { error: "This link has expired. Please contact the salon." };
  const { createPaymentLinkForCustomer } = await import("@/server/payments/links");
  const r = await createPaymentLinkForCustomer(data.salon, data.booking.id);
  if (!r.ok) return { error: r.message };
  redirect(r.value.url);
}
