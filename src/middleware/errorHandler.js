import { logger } from "../utils/logger.js";

export const errorHandler = (error, req, res, next) => {
    logger.error(error.message, {
        requestId: req.requestId,
        stack: error.stack,
    });

    res.status(error.statusCode || 500).json({
        success: false,
        message:
            env.nodeEnv === "production"
                ? error.message || "Internal server error"
                : error.message,
        requestId: req.requestId,
    });
};