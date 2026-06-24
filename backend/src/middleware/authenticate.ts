import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../utils/jwt';
import prisma from '../config/database';

export async function authenticate(req: Request, res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'No token provided' } });
      return;
    }

    const token = authHeader.split(' ')[1];
    const payload = verifyAccessToken(token);

    const user = await prisma.user.findUnique({ where: { id: payload.userId } });
    if (!user || !user.isActive) {
      res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Invalid or inactive user' } });
      return;
    }

    // tokenVersion mismatch means the user has logged out everywhere or
    // changed their password since this token was issued. Reject without
    // waiting for the natural 15-minute expiry. (See QA finding #1, #2.)
    if (typeof payload.tv !== 'number' || payload.tv !== user.tokenVersion) {
      res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Session no longer valid' } });
      return;
    }

    req.user = user;
    next();
  } catch {
    res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Invalid token' } });
  }
}
