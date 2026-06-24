import { Request, Response, NextFunction } from 'express';
import * as service from '../services/customField.service';

export async function listDefinitionsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const data = await service.listDefinitions(req.params.id);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function createDefinitionHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const data = await service.createDefinition(req.params.id, req.body, req.user!.id);
    res.status(201).json({ success: true, data });
  } catch (err) { next(err); }
}

export async function updateDefinitionHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const data = await service.updateDefinition(req.params.fieldId, req.body, req.user!.id);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function deleteDefinitionHandler(req: Request, res: Response, next: NextFunction) {
  try {
    await service.deleteDefinition(req.params.fieldId, req.user!.id);
    res.json({ success: true });
  } catch (err) { next(err); }
}

export async function reorderDefinitionsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const data = await service.reorderDefinitions(req.params.id, req.body.ids ?? [], req.user!.id);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}
