CREATE TABLE "Ga4Credential" (
  "userId" TEXT NOT NULL,
  "encryptedJson" TEXT NOT NULL,
  "clientEmail" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Ga4Credential_pkey" PRIMARY KEY ("userId")
);

ALTER TABLE "Ga4Credential" ADD CONSTRAINT "Ga4Credential_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
