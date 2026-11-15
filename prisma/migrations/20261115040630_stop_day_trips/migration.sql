-- AlterTable
ALTER TABLE "Stop" ADD COLUMN     "dayTrips" JSONB NOT NULL DEFAULT '[]';
