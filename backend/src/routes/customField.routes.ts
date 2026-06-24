import { Router } from 'express';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import { projectAccess } from '../middleware/projectAccess';
import { projectScopedResourceAccess } from '../middleware/projectScopedResourceAccess';
import { validate } from '../middleware/validate';
import {
  createCustomFieldSchema,
  updateCustomFieldSchema,
  reorderCustomFieldSchema,
} from '../validators/customField.schema';
import * as handler from '../handlers/customField.handler';

const router = Router();

// Listing is gated only by project membership — every member needs to know
// the field schema to render their tasks correctly.
router.get(
  '/projects/:id/custom-fields',
  authenticate,
  projectAccess,
  handler.listDefinitionsHandler,
);

// Mutations require project.edit (admins / PMs).
router.post(
  '/projects/:id/custom-fields',
  authenticate,
  projectAccess,
  authorize('project.edit'),
  validate(createCustomFieldSchema),
  handler.createDefinitionHandler,
);

router.post(
  '/projects/:id/custom-fields/reorder',
  authenticate,
  projectAccess,
  authorize('project.edit'),
  validate(reorderCustomFieldSchema),
  handler.reorderDefinitionsHandler,
);

router.put(
  '/custom-fields/:fieldId',
  authenticate,
  projectScopedResourceAccess('customFieldDefinition', 'fieldId'),
  authorize('project.edit'),
  validate(updateCustomFieldSchema),
  handler.updateDefinitionHandler,
);

router.delete(
  '/custom-fields/:fieldId',
  authenticate,
  projectScopedResourceAccess('customFieldDefinition', 'fieldId'),
  authorize('project.edit'),
  handler.deleteDefinitionHandler,
);

export default router;
