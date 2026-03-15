// Routes Autenticazione per DocuVault

import { Router } from 'express';
import {
  loginController,
  registerController,
  refreshController,
  logoutController,
  forgotPasswordController,
  resetPasswordController,
  changePasswordController,
  getMeController,
} from '../controllers/auth.controller.js';
import { authenticate, requireAdmin } from '../middleware/auth.middleware.js';
import { requireValidLicense, checkUserLimitMiddleware } from '../middleware/license.middleware.js';
import { validateBody } from '../middleware/error.middleware.js';
import {
  loginSchema,
  registerSchema,
  refreshTokenSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
} from '../utils/validation.js';
import rateLimit from 'express-rate-limit';

const router = Router();

// Rate limiting per auth
const authLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minuto
  max: 10, // 10 richieste per minuto
  message: {
    success: false,
    error: 'Troppe richieste. Riprova tra un minuto.',
    code: 'RATE_LIMIT_EXCEEDED',
  },
});

// Login
router.post('/login', authLimiter, validateBody(loginSchema), loginController);

// Registrazione (solo admin autenticato)
router.post(
  '/register',
  authenticate,
  requireAdmin,
  requireValidLicense,
  checkUserLimitMiddleware,
  validateBody(registerSchema),
  registerController
);

// Refresh token
router.post('/refresh', validateBody(refreshTokenSchema), refreshController);

// Logout
router.post('/logout', authenticate, logoutController);

// Forgot password
router.post(
  '/forgot-password',
  authLimiter,
  validateBody(forgotPasswordSchema),
  forgotPasswordController
);

// Reset password
router.post(
  '/reset-password',
  authLimiter,
  validateBody(resetPasswordSchema),
  resetPasswordController
);

// Cambio password
router.post('/change-password', authenticate, changePasswordController);

// Profilo utente corrente
router.get('/me', authenticate, getMeController);

export default router;
