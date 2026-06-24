-- CreateTable
CREATE TABLE "cms_content_projects" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "apiKey" TEXT NOT NULL,
    "domain" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cms_content_projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cms_templates" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "description" TEXT,
    "structure" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cms_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cms_blogs" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "templateId" TEXT,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "excerpt" TEXT,
    "content" JSONB NOT NULL,
    "featuredImage" JSONB,
    "seo" JSONB,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "categories" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "authorId" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cms_blogs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cms_media_assets" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "url" TEXT NOT NULL,
    "altText" TEXT,
    "caption" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cms_media_assets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cms_content_projects_slug_key" ON "cms_content_projects"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "cms_content_projects_apiKey_key" ON "cms_content_projects"("apiKey");

-- CreateIndex
CREATE UNIQUE INDEX "cms_templates_projectId_slug_key" ON "cms_templates"("projectId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "cms_blogs_projectId_slug_key" ON "cms_blogs"("projectId", "slug");

-- CreateIndex
CREATE INDEX "cms_blogs_projectId_status_idx" ON "cms_blogs"("projectId", "status");

-- CreateIndex
CREATE INDEX "cms_blogs_publishedAt_idx" ON "cms_blogs"("publishedAt");

-- CreateIndex
CREATE INDEX "cms_media_assets_projectId_idx" ON "cms_media_assets"("projectId");

-- AddForeignKey
ALTER TABLE "cms_templates" ADD CONSTRAINT "cms_templates_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "cms_content_projects"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "cms_blogs" ADD CONSTRAINT "cms_blogs_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "cms_content_projects"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "cms_blogs" ADD CONSTRAINT "cms_blogs_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "cms_templates"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "cms_blogs" ADD CONSTRAINT "cms_blogs_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "cms_media_assets" ADD CONSTRAINT "cms_media_assets_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "cms_content_projects"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
