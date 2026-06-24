import { Router } from 'express';
import { authenticate } from '../middleware/authenticate';
import { validate } from '../middleware/validate';
import { authLimiter, refreshLimiter } from '../middleware/rateLimiter';
import { loginSchema, changePasswordSchema, updateMeSchema, avatarUploadUrlSchema, setAvatarSchema } from '../validators/auth.schema';
import * as authHandler from '../handlers/auth.handler';

const router = Router();

router.post('/login', authLimiter, validate(loginSchema), authHandler.loginHandler);
router.post('/refresh', refreshLimiter, authHandler.refreshHandler);
router.post('/logout', authenticate, authHandler.logoutHandler);
router.get('/me', authenticate, authHandler.meHandler);
// PATCH /auth/me — narrow self-update path. Admins still have the broader
// PUT /users/:id route for managing other people's profiles.
router.patch('/me', authenticate, validate(updateMeSchema), authHandler.updateMeHandler);
router.put('/change-password', authenticate, validate(changePasswordSchema), authHandler.changePasswordHandler);
// Self-service avatar: presigned-PUT upload-url → confirm → (optional) remove.
router.post('/me/avatar/upload-url', authenticate, validate(avatarUploadUrlSchema), authHandler.avatarUploadUrlHandler);
router.put('/me/avatar', authenticate, validate(setAvatarSchema), authHandler.setAvatarHandler);
router.delete('/me/avatar', authenticate, authHandler.removeAvatarHandler);

export default router;
