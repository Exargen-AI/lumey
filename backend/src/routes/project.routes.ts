import { Router } from 'express';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import { requireRoles } from '../middleware/requireRoles';
import { projectAccess } from '../middleware/projectAccess';
import { validate } from '../middleware/validate';
import { createProjectSchema, updateProjectSchema, addMemberSchema, setMemberFullAccessSchema } from '../validators/project.schema';
import { createProductSchema, updateProductSchema, productParamsSchema } from '../validators/product.schema';
import * as projectHandler from '../handlers/project.handler';
import * as productHandler from '../handlers/product.handler';

const router = Router();

router.get('/', authenticate, projectHandler.listProjectsHandler);
router.post('/', authenticate, authorize('project.create'), validate(createProjectSchema), projectHandler.createProjectHandler);
router.get('/:id', authenticate, projectAccess, projectHandler.getProjectHandler);
router.put('/:id', authenticate, projectAccess, authorize('project.edit'), validate(updateProjectSchema), projectHandler.updateProjectHandler);
router.delete('/:id', authenticate, projectAccess, authorize('project.delete'), projectHandler.deleteProjectHandler);
router.get('/:id/members', authenticate, projectAccess, projectHandler.getProjectMembersHandler);
router.post('/:id/members', authenticate, projectAccess, authorize('project.manage_members'), validate(addMemberSchema), projectHandler.addProjectMemberHandler);
router.delete('/:id/members/:userId', authenticate, projectAccess, authorize('project.manage_members'), projectHandler.removeProjectMemberHandler);
// Per-project full-access grant for a CLIENT member. SUPER_ADMIN-only — this
// exposes the project's internal (non-client-visible) work to a third party,
// so it sits above the normal project.manage_members permission.
router.patch('/:id/members/:userId/access', authenticate, projectAccess, requireRoles('SUPER_ADMIN'), validate(setMemberFullAccessSchema), projectHandler.setMemberFullAccessHandler);

// ─── Products (PR C feature #6) ─────────────────────────────────────
// Project-scoped product CRUD. List/get are open to anyone with
// projectAccess + product.view (clients included — they read the
// taxonomy back to scope bug submissions). Create/edit/delete are
// admin + PM.
router.get('/:id/products', authenticate, projectAccess, authorize('product.view'), productHandler.listProductsHandler);
router.post('/:id/products', authenticate, projectAccess, authorize('product.create'), validate(createProductSchema), productHandler.createProductHandler);
router.get('/:id/products/:productId', authenticate, projectAccess, authorize('product.view'), validate(productParamsSchema), productHandler.getProductHandler);
router.put('/:id/products/:productId', authenticate, projectAccess, authorize('product.edit'), validate(updateProductSchema), productHandler.updateProductHandler);
router.delete('/:id/products/:productId', authenticate, projectAccess, authorize('product.delete'), validate(productParamsSchema), productHandler.deleteProductHandler);

export default router;
