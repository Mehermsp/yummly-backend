const express = require("express");
const registerCatalogRoutes = require("./catalog");
const registerAuthRoutes = require("./auth");
const registerCustomerRoutes = require("./customer");
const registerRestaurantRoutes = require("./restaurant");
const registerAdminRoutes = require("./admin");
const registerDeliveryRoutes = require("./delivery");
const {
    requireAdmin,
    requireAuth,
    requireCustomer,
    requireDelivery,
    requireRestaurant,
} = require("./middleware");
const { HttpError } = require("./shared");

module.exports = function registerUnifiedApi(getPool) {
    const router = express.Router();
    const authRequired = requireAuth(getPool);

    router.use("/auth", registerAuthRoutes(getPool));
    router.use("/catalog", registerCatalogRoutes(getPool));
    router.use("/customer", authRequired, requireCustomer(), registerCustomerRoutes(getPool));
    router.use(
        "/restaurant",
        authRequired,
        requireRestaurant(),
        registerRestaurantRoutes(getPool)
    );
    router.use("/admin", authRequired, requireAdmin(), registerAdminRoutes(getPool));
    router.use("/delivery", authRequired, requireDelivery(), registerDeliveryRoutes(getPool));

    router.use((error, _req, res, _next) => {
        const status = error instanceof HttpError ? error.status : 500;
        return res.status(status).json({
            success: false,
            error: error.message || "Internal server error",
            details: error.details || undefined,
        });
    });

    return router;
};
