import { Router } from 'express';
import { z } from 'zod';
import { UserService } from '../services/UserService';
import { createError } from '../middleware/errorHandler';

const router = Router();

const CreateUserSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
  password: z.string().min(8),
});

const UpdateUserSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  email: z.string().email().optional(),
});

router.get('/api/v1/users', async (_req, res, next) => {
  try {
    const users = await UserService.listUsers();
    res.json(users);
  } catch (err) {
    next(err);
  }
});

router.get('/api/v1/users/:id', async (req, res, next) => {
  try {
    const user = await UserService.getUserById(req.params.id);
    if (!user) {
      return next(createError('User not found', 404, 'USER_NOT_FOUND'));
    }
    res.json(user);
  } catch (err) {
    next(err);
  }
});

router.post('/api/v1/users', async (req, res, next) => {
  try {
    const parsed = CreateUserSchema.safeParse(req.body);
    if (!parsed.success) {
      return next(
        createError('Validation error', 400, 'VALIDATION_ERROR', parsed.error.flatten())
      );
    }

    const user = await UserService.createUser({
      name: parsed.data.name,
      email: parsed.data.email,
      password: parsed.data.password,
    });
    res.status(201).json(user);
  } catch (err) {
    next(err);
  }
});

router.patch('/api/v1/users/:id', async (req, res, next) => {
  try {
    const parsed = UpdateUserSchema.safeParse(req.body);
    if (!parsed.success) {
      return next(
        createError('Validation error', 400, 'VALIDATION_ERROR', parsed.error.flatten())
      );
    }

    const user = await UserService.updateUser(req.params.id, parsed.data);
    if (!user) {
      return next(createError('User not found', 404, 'USER_NOT_FOUND'));
    }
    res.json(user);
  } catch (err) {
    next(err);
  }
});

router.delete('/api/v1/users/:id', async (req, res, next) => {
  try {
    const deleted = await UserService.deleteUser(req.params.id);
    if (!deleted) {
      return next(createError('User not found', 404, 'USER_NOT_FOUND'));
    }
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

export { router as userRoutes };
