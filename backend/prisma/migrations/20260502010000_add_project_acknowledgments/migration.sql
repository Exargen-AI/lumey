-- CreateTable
CREATE TABLE "project_acknowledgments" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "acknowledgedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "acknowledgedText" TEXT NOT NULL,

    CONSTRAINT "project_acknowledgments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "project_acknowledgments_projectId_idx" ON "project_acknowledgments"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "project_acknowledgments_userId_projectId_key" ON "project_acknowledgments"("userId", "projectId");

-- AddForeignKey
ALTER TABLE "project_acknowledgments" ADD CONSTRAINT "project_acknowledgments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_acknowledgments" ADD CONSTRAINT "project_acknowledgments_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
