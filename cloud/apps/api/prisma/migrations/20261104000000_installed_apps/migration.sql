-- AlterTable
ALTER TABLE "Device" ADD COLUMN     "appIconsWanted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "installedApps" JSONB,
ADD COLUMN     "installedAppsHash" TEXT;

-- CreateTable
CREATE TABLE "AppInfo" (
    "packageName" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "iconVersionCode" INTEGER NOT NULL DEFAULT -1,
    "icon" BYTEA,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppInfo_pkey" PRIMARY KEY ("packageName")
);
