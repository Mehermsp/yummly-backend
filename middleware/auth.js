import { verifyAccessToken } from "../utils/auth.js";
import { getOne } from "../config/database.js";
import { AuthenticationError, AuthorizationError } from "./errorHandler.js";

// =====================================================
// AUTHENTICATION MIDDLEWARE
// =====================================================

export const authenticate = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        const userIdHeader = req.headers.userid;
        let userId = null;

        if (authHeader && authHeader.startsWith("Bearer ")) {
            const token = authHeader.substring(7);
            const decoded = verifyAccessToken(token);
            userId = decoded.userId || decoded.sub || null;
        } else if (userIdHeader) {
            userId = Number(userIdHeader);
        }

        if (!userId) {
            throw new AuthenticationError("No token provided");
        }

        const user = await getOne(
            `SELECT
                id,
                role,
                name,
                email,
                phone,
                is_available,
                profile_image,
                profile_image_public_id,
                is_email_verified,
                delivery_fee_per_order,
                created_at
            FROM users
            WHERE id = ?
            LIMIT 1`,
            [userId]
        );

        if (!user) {
            throw new AuthenticationError("User not found");
        }

        req.user = {
            id: Number(user.id),
            name: user.name,
            email: user.email,
            phone: user.phone,
            role: user.role,
            is_available: Boolean(user.is_available),
            profile_image: user.profile_image || null,
            profile_image_public_id: user.profile_image_public_id || null,
            is_email_verified: Boolean(user.is_email_verified),
            delivery_fee_per_order: Number(user.delivery_fee_per_order || 0),
            created_at: user.created_at,
        };

        next();
    } catch (error) {
        if (error instanceof AuthenticationError) {
            return res.status(401).json({
                success: false,
                message: error.message,
                code: "AUTHENTICATION_ERROR",
            });
        }

        res.status(401).json({
            success: false,
            message: "Invalid token",
            code: "AUTHENTICATION_ERROR",
        });
    }
};

// =====================================================
// ROLE-BASED ACCESS CONTROL MIDDLEWARE
// =====================================================

export const requireRole = (...allowedRoles) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({
                success: false,
                message: "Authentication required",
                code: "AUTHENTICATION_ERROR",
            });
        }

        if (!allowedRoles.includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                message: `This action requires one of these roles: ${allowedRoles.join(
                    ", "
                )}`,
                code: "AUTHORIZATION_ERROR",
            });
        }

        next();
    };
};

// =====================================================
// CUSTOMER MIDDLEWARE
// =====================================================
export const requireCustomer = requireRole("customer");

// =====================================================
// RESTAURANT PARTNER MIDDLEWARE
// =====================================================
export const requireRestaurantPartner = requireRole("restaurant_partner");

// =====================================================
// DELIVERY PARTNER MIDDLEWARE
// =====================================================
export const requireDeliveryPartner = requireRole("delivery_partner");

// =====================================================
// ADMIN MIDDLEWARE
// =====================================================
export const requireAdmin = requireRole("admin");

// =====================================================
// ALLOW MULTIPLE ROLES
// =====================================================
export const requireCustomerOrRestaurant = requireRole(
    "customer",
    "restaurant_partner"
);
export const requireCustomerOrDelivery = requireRole(
    "customer",
    "delivery_partner"
);
export const requirePartnerOrAdmin = requireRole(
    "restaurant_partner",
    "delivery_partner",
    "admin"
);

// =====================================================
// RESTAURANT OWNERSHIP VERIFICATION
// =====================================================

export const verifyRestaurantOwnership = async (req, res, next) => {
    try {
        const restaurantId = req.params.restaurantId || req.body.restaurantId;

        if (!restaurantId) {
            throw new Error("Restaurant ID required");
        }

        const restaurant = await getOne(
            "SELECT owner_id FROM restaurants WHERE id = ?",
            [restaurantId]
        );

        if (!restaurant) {
            return res.status(404).json({
                success: false,
                message: "Restaurant not found",
                code: "NOT_FOUND",
            });
        }

        // Check if user is the restaurant owner or admin
        if (req.user.role === "admin" || req.user.id === restaurant.owner_id) {
            req.restaurant = restaurant;
            next();
        } else {
            throw new AuthorizationError("You do not own this restaurant");
        }
    } catch (error) {
        res.status(403).json({
            success: false,
            message: error.message,
            code: "AUTHORIZATION_ERROR",
        });
    }
};

// =====================================================
// ORDER OWNERSHIP VERIFICATION
// =====================================================

export const verifyOrderAccess = async (req, res, next) => {
    try {
        const orderId = req.params.orderId || req.body.orderId;

        if (!orderId) {
            throw new Error("Order ID required");
        }

        const order = await getOne(
            "SELECT customer_id, restaurant_id, delivery_partner_id FROM orders WHERE id = ?",
            [orderId]
        );

        if (!order) {
            return res.status(404).json({
                success: false,
                message: "Order not found",
                code: "NOT_FOUND",
            });
        }

        // Verify user has access to this order
        const hasAccess =
            req.user.role === "admin" ||
            (req.user.role === "customer" &&
                req.user.id === order.customer_id) ||
            (req.user.role === "restaurant_partner" &&
                req.user.id === order.restaurant_id) ||
            (req.user.role === "delivery_partner" &&
                req.user.id === order.delivery_partner_id);

        if (!hasAccess) {
            throw new AuthorizationError(
                "You do not have access to this order"
            );
        }

        req.order = order;
        next();
    } catch (error) {
        if (error instanceof AuthorizationError) {
            return res.status(403).json({
                success: false,
                message: error.message,
                code: "AUTHORIZATION_ERROR",
            });
        }

        res.status(403).json({
            success: false,
            message: error.message,
            code: "AUTHORIZATION_ERROR",
        });
    }
};

export default {
    authenticate,
    requireRole,
    requireCustomer,
    requireRestaurantPartner,
    requireDeliveryPartner,
    requireAdmin,
    requireCustomerOrRestaurant,
    requireCustomerOrDelivery,
    requirePartnerOrAdmin,
    verifyRestaurantOwnership,
    verifyOrderAccess,
};
