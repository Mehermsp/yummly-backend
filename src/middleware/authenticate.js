import { getUserById } from "../models/userModel.js";
import { verifyAccessToken } from "../utils/jwt.js";
import { AppError } from "../utils/http.js";

export const authenticate = async (req, res, next) => {
    const header = req.headers.authorization;

    if (!header?.startsWith("Bearer ")) {
        return next(new AppError(401, "Authentication token is required"));
    }

    try {
        const payload = verifyAccessToken(header.slice(7));
        const user = await getUserById(payload.sub);

        if (!user || !user.is_active) {
            throw new AppError(401, "User account is not active");
        }

        req.user = user;
        req.auth = payload;
        return next();
    } catch (error) {
        return next(
            error instanceof AppError
                ? error
                : new AppError(401, "Invalid or expired token")
        );
    }
};
