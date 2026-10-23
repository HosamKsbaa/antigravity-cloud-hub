import { User, ApiKey } from './db/schema.js';

declare global {
  namespace Express {
    interface Request {
      user?: User;
      apiKey?: ApiKey;
      authMethod?: 'jwt' | 'apiKey';
    }
  }
}

export interface JwtPayload {
  sub: string;
  email: string;
  role: 'admin' | 'user';
  name?: string | null;
  iat?: number;
  exp?: number;
}
