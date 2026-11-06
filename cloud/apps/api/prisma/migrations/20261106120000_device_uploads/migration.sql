-- A tablet sends the APK of an app it has (pull_apk): which one, and for which command
ALTER TABLE "Upload" ADD COLUMN "deviceId" UUID;
ALTER TABLE "Upload" ADD COLUMN "commandId" UUID;
