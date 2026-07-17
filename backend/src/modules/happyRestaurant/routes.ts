import { Router } from 'express';
import { happyAuthRouter } from './auth.js';
import { happySettingsRouter } from './settings.js';
import { happyStaffRouter } from './staff.js';
import { happyTablesRouter } from './tables.js';
import { happyMenuRouter } from './menu.js';
import { happyOrdersRouter } from './orders.js';
import { happyKitchenRouter } from './kitchen.js';

// Everything here is mounted at '/restaurant' in index.ts (not '/api') —
// intentionally distinct from the existing /api/restaurant/* module
// (modules/restaurant/routes.ts), which is a separate WhatsApp reservation
// feature for tenant type 'restaurant' and must never be touched by this one.
export const happyRestaurantRouter = Router();

happyRestaurantRouter.use(happyAuthRouter);
happyRestaurantRouter.use(happySettingsRouter);
happyRestaurantRouter.use(happyStaffRouter);
happyRestaurantRouter.use(happyTablesRouter);
happyRestaurantRouter.use(happyMenuRouter);
happyRestaurantRouter.use(happyOrdersRouter);
happyRestaurantRouter.use(happyKitchenRouter);
