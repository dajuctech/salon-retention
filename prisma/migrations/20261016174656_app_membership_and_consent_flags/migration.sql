-- CreateEnum
CREATE TYPE "MemberRole" AS ENUM ('owner', 'receptionist', 'barber');

-- CreateEnum
CREATE TYPE "InvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REVOKED');

-- DropForeignKey
ALTER TABLE "invitation" DROP CONSTRAINT "invitation_organizationId_fkey";

-- DropForeignKey
ALTER TABLE "member" DROP CONSTRAINT "member_organizationId_fkey";

-- DropIndex
DROP INDEX "member_organizationId_userId_key";

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "marketingConsent" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "utilityConsent" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "invitation" DROP COLUMN "organizationId",
ADD COLUMN     "barberId" TEXT,
ADD COLUMN     "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "salonId" TEXT NOT NULL,
ADD COLUMN     "tokenHash" TEXT NOT NULL,
DROP COLUMN "role",
ADD COLUMN     "role" "MemberRole" NOT NULL,
DROP COLUMN "status",
ADD COLUMN     "status" "InvitationStatus" NOT NULL DEFAULT 'PENDING';

-- AlterTable
ALTER TABLE "member" DROP COLUMN "organizationId",
ADD COLUMN     "salonId" TEXT NOT NULL,
DROP COLUMN "role",
ADD COLUMN     "role" "MemberRole" NOT NULL;

-- AlterTable
ALTER TABLE "salon" DROP COLUMN "logo",
DROP COLUMN "metadata",
ADD COLUMN     "whatsappNumber" TEXT;

-- AlterTable
ALTER TABLE "session" DROP COLUMN "activeOrganizationId";

-- CreateIndex
CREATE UNIQUE INDEX "invitation_tokenHash_key" ON "invitation"("tokenHash");

-- CreateIndex
CREATE INDEX "invitation_salonId_status_idx" ON "invitation"("salonId", "status");

-- CreateIndex
CREATE INDEX "member_userId_idx" ON "member"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "member_salonId_userId_key" ON "member"("salonId", "userId");

-- AddForeignKey
ALTER TABLE "member" ADD CONSTRAINT "member_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "salon"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "salon"("id") ON DELETE CASCADE ON UPDATE CASCADE;

