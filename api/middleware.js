const { HttpError, queryOne } = require("./shared");
const { USER_ROLES } = require("./constants");

function requireAuth(getPool) {
    return async (req, _res, next) => {
        try {
            const userId = req.session?.userId || Number(req.headers.userid);
            if (!userId) {
                throw new HttpError(401, "Authentication required");
            }

            const user = await queryOne(
                getPool(),
                `SELECT id, name, email, phone, role, is_available, profile_image,
                        is_email_verified, delivery_fee_per_order, created_at
                 FROM users
                 WHERE id = ?`,
                [userId]
            );

            if (!user) {
                throw new HttpError(401, "Session is no longer valid");
            }

            req.user = user;
            next();
        } catch (error) {
            next(error);
        }
    };
}

function requireRole(...roles) {
    return (req, _res, next) => {
        if (!req.user) {
            return next(new HttpError(401, "Authentication required"));
        }
        if (!roles.includes(req.user.role)) {
            return next(new HttpError(403, "You do not have access to this resource"));
        }
        return next();
    };
}

function requireAdmin() {
    return requireRole(USER_ROLES.ADMIN);
}

function requireRestaurant() {
    return requireRole(USER_ROLES.RESTAURANT);
}

function requireCustomer() {
    return requireRole(USER_ROLES.CUSTOMER);
}

function requireDelivery() {
    return requireRole(USER_ROLES.DELIVERY);
}

module.exports = {
    requireAdmin,
    requireAuth,
    requireCustomer,
    requireDelivery,
    requireRestaurant,
    requireRole,
};
