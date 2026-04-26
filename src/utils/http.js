export class AppError extends Error {
    constructor(statusCode, message, details = null) {
        super(message);
        this.statusCode = statusCode;
        this.details = details;
    }
}

export const sendSuccess = (res, data, message = "OK", statusCode = 200) =>
    res.status(statusCode).json({
        success: true,
        message,
        data,
    });

export const sendPaginated = (
    res,
    items,
    pagination,
    message = "OK",
    statusCode = 200
) =>
    res.status(statusCode).json({
        success: true,
        message,
        data: items,
        pagination,
    });
