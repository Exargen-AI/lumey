/**
 * Comments capability module — the first capability migrated onto the kernel
 * (M0). It contributes the comment routes; the registry mounts them only when
 * the `comments` entitlement is enabled, in dependency order.
 *
 * The comment service's domain events (`comment.created`, …) move onto the
 * bus in M1, when the notifications module subscribes to them — added then,
 * with their consumer, rather than published into the void now.
 */

import commentRoutes from '../../routes/comment.routes';
import type { ModuleManifest } from '../../kernel';

export const commentsModule: ModuleManifest = {
  id: 'comments',
  version: '1.0.0',
  entitlement: 'comments',
  routes: [{ path: '/api/v1', router: commentRoutes }],
};
