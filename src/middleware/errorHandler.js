import { logger } from "../utils/logger.js";
import { env } from "../config/env.js";

export const errorHandler = (error, req, res, next) => {
    logger.error(error.message, {
        requestId: req.requestId,
        stack: error.stack,
    });

    const isProduction = env.nodeEnv === "production";

    res.status(error.statusCode || 500).json({
        success: false,
        message:
            isProduction
                ? error.message || "Internal server error"
                : error.message,
        error: isProduction
            ? undefined
            : {
                  name: error.name,
                  details: error.details || null,
              },
        requestId: req.requestId,
    });
};
