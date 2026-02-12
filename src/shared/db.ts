import { Pool } from 'pg';
import logger from './logger';

export interface DatabaseClient {
  query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[]; rowCount: number }>;
  transaction<T>(fn: (client: DatabaseClient) => Promise<T>): Promise<T>;
  end(): Promise<void>;
}

export function createDatabaseClient(connectionString: string): DatabaseClient {
  const pool = new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });

  pool.on('error', (err) => {
    logger.error({ err }, 'Unexpected PostgreSQL pool error');
  });

  return {
    async query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[]; rowCount: number }> {
      const result = await pool.query(sql, params);
      return { rows: result.rows as T[], rowCount: result.rowCount ?? 0 };
    },

    async transaction<T>(fn: (client: DatabaseClient) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const txClient: DatabaseClient = {
          async query<U>(sql: string, params?: unknown[]): Promise<{ rows: U[]; rowCount: number }> {
            const result = await client.query(sql, params);
            return { rows: result.rows as U[], rowCount: result.rowCount ?? 0 };
          },
          transaction() {
            throw new Error('Nested transactions not supported');
          },
          end() {
            throw new Error('Cannot end connection inside transaction');
          },
        };
        const result = await fn(txClient);
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },

    async end(): Promise<void> {
      await pool.end();
    },
  };
}
