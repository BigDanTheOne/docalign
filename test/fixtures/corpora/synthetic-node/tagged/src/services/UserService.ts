import bcrypt from 'bcrypt';
import { query } from '../db/client';

export interface User {
  id: string;
  name: string;
  email: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateUserInput {
  name: string;
  email: string;
  password: string;
}

export interface UpdateUserInput {
  name?: string;
  email?: string;
}

export class UserService {
  static async createUser({ name, email, password }: CreateUserInput): Promise<User> {
    const passwordHash = await bcrypt.hash(password, 12);

    const rows = await query<User>(
      `INSERT INTO users (name, email, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id, name, email, created_at as "createdAt", updated_at as "updatedAt"`,
      [name, email, passwordHash]
    );

    const user = rows[0];
    if (!user) {
      throw new Error('Failed to create user');
    }
    return user;
  }

  static async getUserById(id: string): Promise<User | null> {
    const rows = await query<User>(
      `SELECT id, name, email, created_at as "createdAt", updated_at as "updatedAt"
       FROM users WHERE id = $1`,
      [id]
    );
    return rows[0] ?? null;
  }

  static async listUsers(): Promise<User[]> {
    return query<User>(
      `SELECT id, name, email, created_at as "createdAt", updated_at as "updatedAt"
       FROM users ORDER BY created_at DESC`
    );
  }

  static async updateUser(id: string, input: UpdateUserInput): Promise<User | null> {
    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (input.name !== undefined) {
      fields.push(`name = $${idx++}`);
      values.push(input.name);
    }
    if (input.email !== undefined) {
      fields.push(`email = $${idx++}`);
      values.push(input.email);
    }

    if (fields.length === 0) return UserService.getUserById(id);

    values.push(id);
    const rows = await query<User>(
      `UPDATE users SET ${fields.join(', ')}, updated_at = NOW()
       WHERE id = $${idx}
       RETURNING id, name, email, created_at as "createdAt", updated_at as "updatedAt"`,
      values
    );
    return rows[0] ?? null;
  }

  static async deleteUser(id: string): Promise<boolean> {
    const rows = await query<{ id: string }>(
      'DELETE FROM users WHERE id = $1 RETURNING id',
      [id]
    );
    return rows.length > 0;
  }
}
