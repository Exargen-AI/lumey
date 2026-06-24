-- PR C — Products per project + SPAWNED_FROM task link kind.
--
-- 1. New `products` table. A Product is the discrete shipping unit
--    within a Project — e.g. project "Acme Platform" might have
--    Products "Customer Web", "Admin Console", "Mobile App". Tasks
--    optionally belong to a Product so the team can scope work and
--    the client can read the same scoping back.
--
-- 2. `tasks.productId` — optional FK. NULL = "project-level work that
--    doesn't fit a specific product" (admin setup tasks, contracts,
--    cross-cutting platform work). The FK uses ON DELETE SET NULL so
--    archiving a product doesn't cascade-destroy its task history.
--
-- 3. New `SPAWNED_FROM` TaskLinkType. fromTask "was spawned from"
--    toTask. Used by the bug-triage flow: a parent bug task can spin
--    off concrete child tasks while preserving the audit trail. We
--    add it to the enum rather than reusing RELATES_TO so the UI can
--    render parent/child semantics correctly (see LinkedIssuesSection).
--
-- All additive. Existing rows default `productId` to NULL.

-- Enum for Product lifecycle. ACTIVE is the default; PAUSED for "we're
-- between releases on this product"; ARCHIVED for read-only history.
CREATE TYPE "ProductStatus" AS ENUM ('ACTIVE', 'PAUSED', 'ARCHIVED');

CREATE TABLE "products" (
    "id"          TEXT NOT NULL,
    "projectId"   TEXT NOT NULL,
    "name"        TEXT NOT NULL,
    "slug"        TEXT NOT NULL,
    "description" TEXT,
    "status"      "ProductStatus" NOT NULL DEFAULT 'ACTIVE',
    "order"       INTEGER NOT NULL DEFAULT 0,
    -- Optional visual cues; the frontend resolves icon names against
    -- the project's icon palette (lucide-react). Color is a hex string
    -- such as "#8b5cf6". Both nullable so a freshly-created product
    -- doesn't force a styling decision up front.
    "color"       TEXT,
    "icon"        TEXT,
    "archivedAt"  TIMESTAMP(3),
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL,
    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "products_projectId_slug_key"
  ON "products"("projectId", "slug");
CREATE INDEX "products_projectId_idx" ON "products"("projectId");
CREATE INDEX "products_projectId_status_idx" ON "products"("projectId", "status");

ALTER TABLE "products"
  ADD CONSTRAINT "products_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "projects"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Task.productId — optional FK. SET NULL on delete because we never
-- want a deleted product to cascade-destroy task history.
ALTER TABLE "tasks" ADD COLUMN "productId" TEXT;
ALTER TABLE "tasks"
  ADD CONSTRAINT "tasks_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "products"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "tasks_productId_idx" ON "tasks"("productId");
-- "All tasks for project X scoped to product Y" — common query for
-- the product detail page kanban.
CREATE INDEX "tasks_projectId_productId_idx" ON "tasks"("projectId", "productId");

-- TaskLinkType: add SPAWNED_FROM (fromTask was spawned from toTask).
-- ALTER TYPE is the supported Postgres syntax; we don't roll it back
-- automatically on a `prisma migrate reset`, so future migrations
-- that DROP this value would need a separate down step.
ALTER TYPE "TaskLinkType" ADD VALUE 'SPAWNED_FROM';
