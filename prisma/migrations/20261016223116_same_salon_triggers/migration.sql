-- ADR-0002 hardening: the database refuses links between salons.
-- Every reference from a tenant row must point to a row in the same salon. Implemented as triggers
-- (not composite foreign keys) because Prisma doesn't manage triggers, so generated migrations
-- can't silently drop them. Platform-wide message templates (salonId NULL) may be used by any salon.

CREATE OR REPLACE FUNCTION enforce_same_salon() RETURNS trigger AS $$
DECLARE
  ref_table text := TG_ARGV[0];
  ref_column text := TG_ARGV[1];
  allow_shared boolean := COALESCE(TG_ARGV[2], 'false')::boolean;
  ref_id text := to_jsonb(NEW) ->> ref_column;
  ref_salon text;
BEGIN
  IF ref_id IS NULL THEN
    RETURN NEW;
  END IF;
  EXECUTE format('SELECT "salonId" FROM %I WHERE id = $1', ref_table) INTO ref_salon USING ref_id;
  IF ref_salon IS NULL AND allow_shared THEN
    RETURN NEW;
  END IF;
  IF ref_salon IS DISTINCT FROM NEW."salonId" THEN
    RAISE EXCEPTION 'cross_salon_reference: %.% points to % in another salon', TG_TABLE_NAME, ref_column, ref_table
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Booking
CREATE TRIGGER same_salon_booking_customer BEFORE INSERT OR UPDATE OF "customerId", "salonId" ON "Booking" FOR EACH ROW EXECUTE FUNCTION enforce_same_salon('Customer', 'customerId');
CREATE TRIGGER same_salon_booking_barber BEFORE INSERT OR UPDATE OF "barberId", "salonId" ON "Booking" FOR EACH ROW EXECUTE FUNCTION enforce_same_salon('Barber', 'barberId');
CREATE TRIGGER same_salon_booking_service BEFORE INSERT OR UPDATE OF "serviceId", "salonId" ON "Booking" FOR EACH ROW EXECUTE FUNCTION enforce_same_salon('Service', 'serviceId');
-- Payments, loyalty, consent
CREATE TRIGGER same_salon_payment_booking BEFORE INSERT OR UPDATE OF "bookingId", "salonId" ON "Payment" FOR EACH ROW EXECUTE FUNCTION enforce_same_salon('Booking', 'bookingId');
CREATE TRIGGER same_salon_redemption_customer BEFORE INSERT OR UPDATE OF "customerId", "salonId" ON "LoyaltyRedemption" FOR EACH ROW EXECUTE FUNCTION enforce_same_salon('Customer', 'customerId');
CREATE TRIGGER same_salon_redemption_booking BEFORE INSERT OR UPDATE OF "bookingId", "salonId" ON "LoyaltyRedemption" FOR EACH ROW EXECUTE FUNCTION enforce_same_salon('Booking', 'bookingId');
CREATE TRIGGER same_salon_consent_customer BEFORE INSERT OR UPDATE OF "customerId", "salonId" ON "Consent" FOR EACH ROW EXECUTE FUNCTION enforce_same_salon('Customer', 'customerId');
-- Messaging
CREATE TRIGGER same_salon_message_customer BEFORE INSERT OR UPDATE OF "customerId", "salonId" ON "Message" FOR EACH ROW EXECUTE FUNCTION enforce_same_salon('Customer', 'customerId');
CREATE TRIGGER same_salon_message_booking BEFORE INSERT OR UPDATE OF "bookingId", "salonId" ON "Message" FOR EACH ROW EXECUTE FUNCTION enforce_same_salon('Booking', 'bookingId');
CREATE TRIGGER same_salon_message_promotion BEFORE INSERT OR UPDATE OF "promotionId", "salonId" ON "Message" FOR EACH ROW EXECUTE FUNCTION enforce_same_salon('Promotion', 'promotionId');
CREATE TRIGGER same_salon_message_template BEFORE INSERT OR UPDATE OF "templateId", "salonId" ON "Message" FOR EACH ROW EXECUTE FUNCTION enforce_same_salon('MessageTemplate', 'templateId', 'true');
CREATE TRIGGER same_salon_conversation_customer BEFORE INSERT OR UPDATE OF "customerId", "salonId" ON "Conversation" FOR EACH ROW EXECUTE FUNCTION enforce_same_salon('Customer', 'customerId');
CREATE TRIGGER same_salon_inbound_conversation BEFORE INSERT OR UPDATE OF "conversationId", "salonId" ON "InboundMessage" FOR EACH ROW EXECUTE FUNCTION enforce_same_salon('Conversation', 'conversationId');
-- Staff setup
CREATE TRIGGER same_salon_barberhours_barber BEFORE INSERT OR UPDATE OF "barberId", "salonId" ON "BarberHours" FOR EACH ROW EXECUTE FUNCTION enforce_same_salon('Barber', 'barberId');
CREATE TRIGGER same_salon_timeoff_barber BEFORE INSERT OR UPDATE OF "barberId", "salonId" ON "TimeOff" FOR EACH ROW EXECUTE FUNCTION enforce_same_salon('Barber', 'barberId');
CREATE TRIGGER same_salon_customer_barber BEFORE INSERT OR UPDATE OF "preferredBarberId", "salonId" ON "Customer" FOR EACH ROW EXECUTE FUNCTION enforce_same_salon('Barber', 'preferredBarberId');
CREATE TRIGGER same_salon_barber_member BEFORE INSERT OR UPDATE OF "memberId", "salonId" ON "Barber" FOR EACH ROW EXECUTE FUNCTION enforce_same_salon('member', 'memberId');
