import { User as PrismaUser, Device as PrismaDevice } from '@prisma/client';

declare global {
  namespace Express {
    interface Request {
      user?: PrismaUser;
      // Set by the deviceAuthenticate middleware on routes that expect
      // a Pulse-agent `Authorization: Device <token>` header. Distinct
      // from `user` so a route can't accidentally treat a device as a
      // human (and vice-versa).
      device?: PrismaDevice;
    }
  }
}
