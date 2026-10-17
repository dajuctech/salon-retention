-- AlterTable
ALTER TABLE "salon" ADD COLUMN     "paymentAccountLabel" TEXT,
ADD COLUMN     "paymentAccountReady" BOOLEAN NOT NULL DEFAULT false;
