import { Request, Response, NextFunction } from 'express';
import * as service from '../services/course.service';

// Public-to-learner read of a published course by slug.
export async function getCourseBySlugHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const course = await service.getCourseBySlugForLearner(req.params.slug);
    res.json({ success: true, data: course });
  } catch (err) { next(err); }
}
