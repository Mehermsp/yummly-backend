// =====================================================
// ERROR CLASSES
// =====================================================

export class AppError extends Error {
    constructor(message, statusCode = 500, code = "INTERNAL_ERROR") {
        super(message);
        this.statusCode = statusCode;
        this.code = code;
        this.timestamp = new Date();
    }
}

export class ValidationError extends AppError {
    constructor(message, details = {}) {
        super(message, 400, "VALIDATION_ERROR");
        this.details = details;
    }
}

export class AuthenticationError extends AppError {
    constructor(message = "Authentication failed") {
        super(message, 401, "AUTHENTICATION_ERROR");
    }
}

export class AuthorizationError extends AppError {
    constructor(
        message = "You do not have permission to access this resource"
    ) {
        super(message, 403, "AUTHORIZATION_ERROR");
    }
}

export class NotFoundError extends AppError {
    constructor(resource = "Resource", id = null) {
        const message = id
            ? `${resource} with ID ${id} not found`
            : `${resource} not found`;
        super(message, 404, "NOT_FOUND");
    }
}

export class ConflictError extends AppError {
    constructor(message) {
        super(message, 409, "CONFLICT");
    }
}

export class DatabaseError extends AppError {
    constructor(message = "Database operation failed", originalError = null) {
        super(message, 500, "DATABASE_ERROR");
        this.originalError = originalError;
    }
}

// =====================================================
// ASYNC HANDLER WRAPPER
// =====================================================

export const asyncHandler = (fn) => (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
};

// =====================================================
// ERROR HANDLER MIDDLEWARE
// =====================================================

export const errorHandler = (err, req, res, next) => {
    const requestId = req.id || "unknown";

    console.error("Request failed", {
        requestId,
        message: err.message,
        code: err.code || "UNKNOWN_ERROR",
        statusCode: err.statusCode || 500,
        method: req.method,
        path: req.path,
    });

    // Default error response
    const statusCode = err.statusCode || 500;
    const response = {
        success: false,
        message: err.message || "Internal server error",
        code: err.code || "INTERNAL_ERROR",
        requestId,
        ...(process.env.NODE_ENV === "development" && { stack: err.stack }),
        ...(err.details && { details: err.details }),
    };

    res.status(statusCode).json(response);
};

// =====================================================
// RESPONSE FORMATTER
// =====================================================

export const sendSuccess = (
    res,
    data = null,
    message = "Success",
    statusCode = 200
) => {
    res.status(statusCode).json({
        success: true,
        message,
        data,
    });
};

export const sendPaginatedSuccess = (
    res,
    data = [],
    pagination = {},
    message = "Success"
) => {
    res.status(200).json({
        success: true,
        message,
        data,
        pagination: {
            page: pagination.page || 1,
            limit: pagination.limit || 10,
            total: pagination.total || 0,
            pages: Math.ceil((pagination.total || 0) / (pagination.limit || 1)),
            hasMore:
                (pagination.page || 1) <
                Math.ceil((pagination.total || 0) / (pagination.limit || 1)),
        },
    });
};

export const sendError = (res, error) => {
    const statusCode = error.statusCode || 500;
    const response = {
        success: false,
        message: error.message,
        code: error.code || "ERROR",
        ...(error.details && { details: error.details }),
    };
    res.status(statusCode).json(response);
};

export default {
    AppError,
    ValidationError,
    AuthenticationError,
    AuthorizationError,
    NotFoundError,
    ConflictError,
    DatabaseError,
    asyncHandler,
    errorHandler,
    sendSuccess,
    sendPaginatedSuccess,
    sendError,
};
