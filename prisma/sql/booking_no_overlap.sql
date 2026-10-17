-- BR-A3: database-level double-booking prevention.
-- Apply in the first migration after `prisma migrate dev --create-only`
-- (append to the generated migration.sql), since Prisma cannot express exclusion constraints.
-- Walk-ins (BR-A6) may overlap on purpose, so the constraint ignores source = 'WALK_IN'.

CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "Booking"
  ADD CONSTRAINT booking_no_overlap
  EXCLUDE USING gist (
    "barberId" WITH =,
    tstzrange("startsAt", "endsAt", '[)') WITH &&
  )
  WHERE (status IN ('PENDING', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED') AND source <> 'WALK_IN');
