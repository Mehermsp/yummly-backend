const ORDER_STATUS_FLOW = [
    "placed",
    "confirmed",
    "preparing",
    "ready",
    "picked_up",
    "on_the_way",
    "delivered",
    "cancelled",
];

const ACTIVE_ORDER_STATUSES = ORDER_STATUS_FLOW.filter(
    (status) => !["delivered", "cancelled"].includes(status)
);

const PAYMENT_STATUSES = ["pending", "paid", "failed", "refunded"];

const USER_ROLES = {
    CUSTOMER: "customer",
    RESTAURANT: "restaurant_partner",
    DELIVERY: "delivery_partner",
    ADMIN: "admin",
};

module.exports = {
    ACTIVE_ORDER_STATUSES,
    ORDER_STATUS_FLOW,
    PAYMENT_STATUSES,
    USER_ROLES,
};
