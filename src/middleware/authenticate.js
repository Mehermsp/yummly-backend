import { getUserById } from "../models/userModel.js";
import { verifyAccessToken } from "../utils/jwt.js";
import { AppError } from "../utils/http.js";

const normalizeRole = (role) => {
    const raw = String(role || "")
        .trim()
        .toLowerCase();

    const aliases = {
        delivery: "delivery_partner",
        deliveryboy: "delivery_partner",
        delivery_boy: "delivery_partner",
        rider: "delivery_partner",
        restaurant: "restaurant_partner",
        vendor: "restaurant_partner",
        user: "customer",
    };

    return aliases[raw] || raw;
};

export const authenticate = async (req, res, next) => {
    const header = req.headers.authorization;

    if (!header?.startsWith("Bearer ")) {
        return next(new AppError(401, "Authentication token is required"));
    }

    try {
        const payload = verifyAccessToken(header.slice(7));
        const user = await getUserById(payload.sub);

        if (!user) {
            throw new AppError(401, "User account is not active");
        }

        if (
            Object.prototype.hasOwnProperty.call(user, "is_active") &&
            (user.is_active === 0 || user.is_active === false)
        ) {
            throw new AppError(401, "User account is not active");
        }

        req.user = {
            ...user,
            role_original: user.role,
            role: normalizeRole(user.role),
        };
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
