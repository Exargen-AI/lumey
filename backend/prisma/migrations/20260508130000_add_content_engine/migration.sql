-- Content Engine migration.
-- The tables ai_analysis_results and generated_blog_drafts were previously
-- created by a partial attempt with a different schema (no data). We drop
-- and recreate them cleanly. content_engine_searches does not yet exist.

-- Drop stale tables from prior partial attempt (both are empty)
DROP TABLE IF EXISTS "generated_blog_drafts";
DROP TABLE IF EXISTS "ai_analysis_results";

-- CreateTable
CREATE TABLE "content_engine_searches" (
    "id"              TEXT NOT NULL,
    "projectId"       TEXT NOT NULL,
    "createdById"     TEXT NOT NULL,
    "topic"           TEXT NOT NULL,
    "timeRange"       TEXT,
    "sentimentFilter" TEXT,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "content_engine_searches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_analysis_results" (
    "id"                TEXT NOT NULL,
    "searchId"          TEXT NOT NULL,
    "topic"             TEXT NOT NULL,
    "summary"           TEXT NOT NULL,
    "sentiment"         JSONB NOT NULL,
    "trendScore"        INTEGER NOT NULL,
    "viralScore"        INTEGER NOT NULL,
    "engagementInsight" TEXT NOT NULL,
    "trendingSubtopics" TEXT[],
    "commonQuestions"   TEXT[],
    "painPoints"        TEXT[],
    "seoKeywords"       JSONB NOT NULL,
    "blogIdeas"         JSONB NOT NULL,
    "recommendedTitle"  TEXT NOT NULL,
    "recommendedTags"   TEXT[],
    "rawResponse"       JSONB NOT NULL,
    "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_analysis_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "generated_blog_drafts" (
    "id"          TEXT NOT NULL,
    "analysisId"  TEXT NOT NULL,
    "projectId"   TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "cmsBlogId"   TEXT,
    "title"       TEXT NOT NULL,
    "slug"        TEXT NOT NULL,
    "excerpt"     TEXT NOT NULL,
    "content"     JSONB NOT NULL,
    "seo"         JSONB,
    "tags"        TEXT[],
    "categories"  TEXT[],
    "status"      TEXT NOT NULL DEFAULT 'generated',
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "generated_blog_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "content_engine_searches_projectId_idx"   ON "content_engine_searches"("projectId");
CREATE INDEX "content_engine_searches_createdById_idx" ON "content_engine_searches"("createdById");
CREATE INDEX "ai_analysis_results_searchId_idx"        ON "ai_analysis_results"("searchId");
CREATE INDEX "generated_blog_drafts_analysisId_idx"    ON "generated_blog_drafts"("analysisId");
CREATE INDEX "generated_blog_drafts_projectId_idx"     ON "generated_blog_drafts"("projectId");

-- AddForeignKey
ALTER TABLE "content_engine_searches"
    ADD CONSTRAINT "content_engine_searches_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "cms_content_projects"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "content_engine_searches"
    ADD CONSTRAINT "content_engine_searches_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ai_analysis_results"
    ADD CONSTRAINT "ai_analysis_results_searchId_fkey"
    FOREIGN KEY ("searchId") REFERENCES "content_engine_searches"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "generated_blog_drafts"
    ADD CONSTRAINT "generated_blog_drafts_analysisId_fkey"
    FOREIGN KEY ("analysisId") REFERENCES "ai_analysis_results"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "generated_blog_drafts"
    ADD CONSTRAINT "generated_blog_drafts_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "cms_content_projects"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "generated_blog_drafts"
    ADD CONSTRAINT "generated_blog_drafts_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
