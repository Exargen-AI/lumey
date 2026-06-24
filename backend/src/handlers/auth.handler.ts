import { Request, Response, NextFunction } from 'express';
import type { CookieOptions } from 'express';
import * as authService from '../services/auth.service';
import { env } from '../config/env';

function getRefreshCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: env.NODE_ENV === 'production' ? 'none' : 'lax',
    // 30 days. Paired with the frontend's 12-hour inactivity logout (the
    // active gate that revokes the server-side refresh row), this gives
    // a worker who closes their laptop on Friday a still-valid cookie on
    // Monday without forcing them to log in again. The refresh JWT
    // itself has its own expiry (JWT_REFRESH_EXPIRY env, default 30d to
    // match) so neither side can outlive the other.
    maxAge: 30 * 24 * 60 * 60 * 1000,
    path: '/api/v1/auth',
  };
}

function clientContext(req: Request) {
  return {
    userAgent: req.headers['user-agent'],
    // We don't yet trust X-Forwarded-For globally (see QA #48); req.ip
    // here is best-effort and only used for forensic context on the
    // refresh-token row.
    ip: req.ip,
  };
}

export async function loginHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { email, password } = req.body;
    const result = await authService.login(email, password, clientContext(req));

    res.cookie('refreshToken', result.refreshToken, getRefreshCookieOptions());

    res.json({
      success: true,
      data: { accessToken: result.accessToken, user: result.user },
    });
  } catch (err) {
    next(err);
  }
}

export async function refreshHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const refreshToken = req.cookies?.refreshToken;
    if (!refreshToken) {
      res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'No refresh token' } });
      return;
    }

    const result = await authService.refreshAccessToken(refreshToken, clientContext(req));

    // Rotation: write the new refresh cookie, clear-and-replace happens
    // automatically because the cookie name is the same.
    res.cookie('refreshToken', result.refreshToken, getRefreshCookieOptions());

    res.json({ success: true, data: { accessToken: result.accessToken } });
  } catch (err) {
    next(err);
  }
}

export async function logoutHandler(req: Request, res: Response) {
  // Best-effort server-side revoke. The client clears its in-memory token
  // either way; we don't want a transient DB error to block sign-out.
  await authService.revokeRefreshToken(req.cookies?.refreshToken).catch(() => {});
  res.clearCookie('refreshToken', getRefreshCookieOptions());
  res.json({ success: true, data: { message: 'Logged out successfully' } });
}

export async function meHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await authService.getUserProfile(req.user!.id);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

export async function updateMeHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const user = await authService.updateMe(req.user!.id, req.body);
    res.json({ success: true, data: { user } });
  } catch (err) {
    next(err);
  }
}

export async function avatarUploadUrlHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await authService.createAvatarUploadUrl(req.user!.id, req.body.contentType, req.body.sizeBytes);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
}

export async function setAvatarHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const user = await authService.setAvatar(req.user!.id, req.body.key);
    res.json({ success: true, data: { user } });
  } catch (err) { next(err); }
}

export async function removeAvatarHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const user = await authService.removeAvatar(req.user!.id);
    res.json({ success: true, data: { user } });
  } catch (err) { next(err); }
}

export async function changePasswordHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { currentPassword, newPassword } = req.body;
    await authService.changePassword(req.user!.id, currentPassword, newPassword);
    // Password change kills every session — including this one. Wipe the
    // refresh cookie so the client can't accidentally reuse it on the next
    // /refresh call. The client is expected to re-login.
    res.clearCookie('refreshToken', getRefreshCookieOptions());
    res.json({ success: true, data: { message: 'Password changed. Please sign in again.' } });
  } catch (err) {
    next(err);
  }
}
