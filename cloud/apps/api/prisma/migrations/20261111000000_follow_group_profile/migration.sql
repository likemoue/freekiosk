-- A device whose own profile is its group's had it from the group, through an enrollment code: it follows
-- the group from now on, so that a new profile on the group reaches it. The profile in effect stays the same.
UPDATE "Device" AS d
SET "profileId" = NULL
FROM "Group" AS g
WHERE d."groupId" = g."id" AND d."profileId" IS NOT NULL AND d."profileId" = g."profileId";
