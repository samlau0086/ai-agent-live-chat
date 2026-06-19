CREATE TABLE "SecuritySettings" (
  "id" TEXT NOT NULL DEFAULT 'global',
  "failedLoginLockoutThreshold" INTEGER NOT NULL DEFAULT 5,
  "lockoutMinutes" INTEGER NOT NULL DEFAULT 15,
  "passwordRotationDays" INTEGER NOT NULL DEFAULT 90,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SecuritySettings_pkey" PRIMARY KEY ("id")
);

INSERT INTO "SecuritySettings" (
  "id",
  "failedLoginLockoutThreshold",
  "lockoutMinutes",
  "passwordRotationDays",
  "updatedAt"
) VALUES (
  'global',
  5,
  15,
  90,
  CURRENT_TIMESTAMP
) ON CONFLICT ("id") DO NOTHING;
