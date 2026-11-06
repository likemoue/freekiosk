-- Where each tablet last placed itself, for the map. Only the last place: no trail is kept
ALTER TABLE "Device" ADD COLUMN "latitude" DOUBLE PRECISION;
ALTER TABLE "Device" ADD COLUMN "longitude" DOUBLE PRECISION;
ALTER TABLE "Device" ADD COLUMN "locationAccuracyM" DOUBLE PRECISION;
ALTER TABLE "Device" ADD COLUMN "locationAt" TIMESTAMP(3);
ALTER TABLE "Device" ADD COLUMN "locationProvider" TEXT;
ALTER TABLE "Device" ADD COLUMN "locationState" TEXT;
