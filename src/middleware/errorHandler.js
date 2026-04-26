import { logger } from "../utils/logger.js";

export const errorHandler = (error, req, res, next) => {
    logger.error(error.message, {
        requestId: req.requestId,
        stack: error.stack,
        details: error.details,
    });

    res.status(error.statusCode || 500).json({
        success: false,
        message: error.message || "Internal server error",
        details: error.details || undefined,
        requestId: req.requestId,
    });
};
