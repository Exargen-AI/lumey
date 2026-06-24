import { Request, Response, NextFunction } from 'express';
import { env } from '../config/env';
import * as service from '../services/projectIngestion.service';

/**
 * Two-phase ingestion endpoints:
 *
 *   POST /projects/:id/ingest/parse    body: { markdown, mode? }
 *     → returns the structured plan tree (no DB writes). `mode` defaults
 *       to "regex"; pass "llm" to invoke Smart Parse (Claude Haiku 4.5).
 *
 *   POST /projects/:id/ingest/commit   body: { plan, updateProjectMeta? }
 *     → atomically creates Epics / Sprints / Tasks for the (possibly
 *       edited) tree the frontend posts back. Returns counts + warnings.
 *
 *   GET  /projects/:id/ingest/smart-parse-status
 *     → returns { enabled: boolean } so the UI can hide the Smart Parse
 *       toggle when the feature is disabled or AI_API_KEY is missing.
 */

export async function parsePlanHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const mode = req.body.mode === 'llm' ? 'llm' : 'regex';
    if (mode === 'llm') {
      const result = await service.parsePlanWithLLM(req.body.markdown);
      res.json({
        success: true,
        data: result.plan,
        meta: {
          mode: 'llm',
          model: result.model,
          provider: result.provider,
          durationMs: result.durationMs,
          usage: result.usage,
        },
      });
      return;
    }
    const plan = service.parsePlan(req.body.markdown);
    res.json({ success: true, data: plan, meta: { mode: 'regex' } });
  } catch (err) { next(err); }
}

export async function smartParseStatusHandler(_req: Request, res: Response) {
  res.json({
    success: true,
    data: {
      enabled: env.INGEST_PARSER_ENABLED && Boolean(env.AI_API_KEY),
      model: env.INGEST_PARSER_MODEL || (env.AI_PROVIDER === 'openai' ? 'gpt-4o-mini' : 'claude-haiku-4-5'),
      provider: env.AI_PROVIDER,
    },
  });
}

export async function commitPlanHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const report = await service.commitParsedPlan(
      req.params.id,
      req.body.plan,
      req.user!.id,
      { updateProjectMeta: req.body.updateProjectMeta === true },
    );
    res.json({ success: true, data: report });
  } catch (err) { next(err); }
}
