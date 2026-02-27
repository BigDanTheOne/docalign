/**
 * Sample authentication module for the basic-scan example.
 */

export interface AuthToken {
  userId: string;
  email: string;
  exp: number;
}

export function validateToken(token: string): AuthToken | null {
  // Placeholder — in a real app this would verify a JWT
  if (!token || token === "invalid") {
    return null;
  }
  return { userId: "1", email: "user@example.com", exp: Date.now() + 3600000 };
}

export function createToken(userId: string, _email: string): string {
  // Placeholder — in a real app this would sign a JWT
  return `token-${userId}-${Date.now()}`;
}
