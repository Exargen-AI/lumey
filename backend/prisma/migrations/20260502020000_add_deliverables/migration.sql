-- CreateEnum
CREATE TYPE "DeliverableStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'DELIVERED', 'SIGNED_OFF', 'REJECTED');

-- CreateTable
CREATE TABLE "deliverables" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "acceptanceCriteria" TEXT,
    "status" "DeliverableStatus" NOT NULL DEFAULT 'PENDING',
    "targetDate" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "signedOffAt" TIMESTAMP(3),
    "signedOffById" TEXT,
    "rejectionNote" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isSeedData" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deliverables_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "deliverables_projectId_idx" ON "deliverables"("projectId");

-- AddForeignKey
ALTER TABLE "deliverables" ADD CONSTRAINT "deliverables_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliverables" ADD CONSTRAINT "deliverables_signedOffById_fkey" FOREIGN KEY ("signedOffById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
