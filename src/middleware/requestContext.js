import { logger } from "../utils/logger.js";

export const attachRequestContext = (req, res, next) => {
    req.requestId =
        req.headers["x-request-id"] ||
        `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    logger.info(`${req.method} ${req.originalUrl}`, { requestId: req.requestId });
    next();
};
