import { asyncHandler } from "../utils/asyncHandler.js";
import { AppError, sendSuccess } from "../utils/http.js";
import {
    approveRestaurantApplication,
    getOverviewMetrics,
    listAdminActivityLogs,
    rejectRestaurantApplication,
} from "../models/adminModel.js";
import { listUsers } from "../models/userModel.js";
import { listApplications } from "../models/restaurantModel.js";
import { adminAssignOrder, getDeliveryPartnerStats, getDeliveryOpenOrders } from "../models/orderModel.js";
import { query } from "../config/db.js";

export const getOverview = asyncHandler(async (req, res) => {
    const overview = await getOverviewMetrics();
    sendSuccess(res, overview, "Admin overview fetched successfully");
});

export const getApplications = asyncHandler(async (req, res) => {
    const items = await listApplications(req.query.status);
    sendSuccess(res, items, "Restaurant applications fetched successfully");
});

export const approveApplication = asyncHandler(async (req, res) => {
    await approveRestaurantApplication({
        applicationId: req.params.applicationId,
        adminId: req.user.id,
        notes: req.body.notes,
    });
    sendSuccess(res, null, "Restaurant application approved");
});

export const rejectApplication = asyncHandler(async (req, res) => {
    await rejectRestaurantApplication({
        applicationId: req.params.applicationId,
        adminId: req.user.id,
        reason: req.body.reason,
    });
    sendSuccess(res, null, "Restaurant application rejected");
});

export const getUsers = asyncHandler(async (req, res) => {
    const items = await listUsers(req.query.role || undefined);
    sendSuccess(res, items, "Users fetched successfully");
});

export const getOrders = asyncHandler(async (req, res) => {
    const items = await query(
        `
        SELECT
            o.id,
            o.order_number,
            o.status,
            o.total,
            o.created_at,
            c.name AS customer_name,
            r.name AS restaurant_name
        FROM orders o
        INNER JOIN users c ON c.id = o.customer_id
        INNER JOIN restaurants r ON r.id = o.restaurant_id
        ORDER BY o.created_at DESC
        LIMIT 100
        `
    );
    sendSuccess(res, items, "Orders fetched successfully");
});

export const getLogs = asyncHandler(async (req, res) => {
    const items = await listAdminActivityLogs();
    sendSuccess(res, items, "Admin activity logs fetched successfully");
});

export const getDeliveryPartners = asyncHandler(async (req, res) => {
    const items = await listUsers("delivery_partner");
    sendSuccess(res, items, "Delivery partners fetched successfully");
});

export const getReadyForPickupOrders = asyncHandler(async (req, res) => {
    const items = await getDeliveryOpenOrders();
    sendSuccess(res, items, "Ready for pickup orders fetched successfully");
});

export const assignOrderToPartner = asyncHandler(async (req, res) => {
    const { orderId } = req.params;
    const { deliveryPartnerId } = req.body;

    if (!deliveryPartnerId) {
        throw new AppError(400, "deliveryPartnerId is required");
    }

    await adminAssignOrder({
        orderId,
        deliveryPartnerId,
        adminId: req.user.id,
    });

    sendSuccess(res, null, "Order assigned to delivery partner successfully");
});
