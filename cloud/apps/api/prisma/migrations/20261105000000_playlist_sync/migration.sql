-- When every screen playing a playlist starts it, and how long a library video is
ALTER TABLE "Playlist" ADD COLUMN "syncEpochAt" TIMESTAMP(3);
ALTER TABLE "MediaAsset" ADD COLUMN "durationMs" INTEGER;
