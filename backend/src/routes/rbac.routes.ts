import { Router } from 'express';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import { validate } from '../middleware/validate';
import { updateRoleSchema } from '../validators/rbac.schema';
import * as rbacHandler from '../handlers/rbac.handler';

const router = Router();

router.get('/permissions', authenticate, authorize('rbac.manage'), rbacHandler.getPermissionsHandler);
router.get('/roles', authenticate, authorize('rbac.manage'), rbacHandler.getRolesHandler);
router.put('/roles/:role', authenticate, authorize('rbac.manage'), validate(updateRoleSchema), rbacHandler.updateRoleHandler);

export default router;
