const normalizeToken = (value) =>
    String(value || "")
        .trim()
        .toLowerCase()
        .replace(/[-\s]+/g, "_")
        .replace(/_+/g, "_");

export const PRODUCT_ORDER_STATUS = {
    PENDING: "pending",
    ACCEPTED: "accepted",
    PREPARING: "preparing",
    READY_FOR_PICKUP: "ready_for_pickup",
    PICKED_UP: "picked_up",
    OUT_FOR_DELIVERY: "out_for_delivery",
    DELIVERED: "delivered",
    CANCELLED: "cancelled",
    REFUNDED: "refunded",
};

export const PERSISTED_ORDER_STATUS = {
    PLACED: "placed",
    CONFIRMED: "confirmed",
    PREPARING: "preparing",
    PREPARED: "prepared",
    READY: "ready",
    PICKED_UP: "picked_up",
    ON_THE_WAY: "on_the_way",
    DELIVERED: "delivered",
    CANCELLED: "cancelled",
    REFUNDED: "refunded",
};

const inputToPersistedStatus = {
    pending: PERSISTED_ORDER_STATUS.PLACED,
    placed: PERSISTED_ORDER_STATUS.PLACED,

    accepted: PERSISTED_ORDER_STATUS.CONFIRMED,
    confirmed: PERSISTED_ORDER_STATUS.CONFIRMED,

    preparing: PERSISTED_ORDER_STATUS.PREPARING,
    prepared: PERSISTED_ORDER_STATUS.PREPARED,

    ready: PERSISTED_ORDER_STATUS.READY,
    ready_to_pickup: PERSISTED_ORDER_STATUS.READY,
    ready_forpickup: PERSISTED_ORDER_STATUS.READY,
    ready_for_pickup: PERSISTED_ORDER_STATUS.READY,

    picked_up: PERSISTED_ORDER_STATUS.PICKED_UP,

    out_for_delivery: PERSISTED_ORDER_STATUS.ON_THE_WAY,
    on_the_way: PERSISTED_ORDER_STATUS.ON_THE_WAY,

    delivered: PERSISTED_ORDER_STATUS.DELIVERED,
    cancelled: PERSISTED_ORDER_STATUS.CANCELLED,
    refunded: PERSISTED_ORDER_STATUS.REFUNDED,
};

const persistedToProductStatus = {
    [PERSISTED_ORDER_STATUS.PLACED]: PRODUCT_ORDER_STATUS.PENDING,
    [PERSISTED_ORDER_STATUS.CONFIRMED]: PRODUCT_ORDER_STATUS.ACCEPTED,
    [PERSISTED_ORDER_STATUS.PREPARING]: PRODUCT_ORDER_STATUS.PREPARING,
    [PERSISTED_ORDER_STATUS.PREPARED]: PRODUCT_ORDER_STATUS.PREPARING,
    [PERSISTED_ORDER_STATUS.READY]: PRODUCT_ORDER_STATUS.READY_FOR_PICKUP,
    [PERSISTED_ORDER_STATUS.PICKED_UP]: PRODUCT_ORDER_STATUS.PICKED_UP,
    [PERSISTED_ORDER_STATUS.ON_THE_WAY]:
        PRODUCT_ORDER_STATUS.OUT_FOR_DELIVERY,
    [PERSISTED_ORDER_STATUS.DELIVERED]: PRODUCT_ORDER_STATUS.DELIVERED,
    [PERSISTED_ORDER_STATUS.CANCELLED]: PRODUCT_ORDER_STATUS.CANCELLED,
    [PERSISTED_ORDER_STATUS.REFUNDED]: PRODUCT_ORDER_STATUS.REFUNDED,
};

export const normalizeOrderStatusInput = (value) => {
    const normalized = normalizeToken(value);

    return inputToPersistedStatus[normalized] || normalized;
};

export const toProductOrderStatus = (value) => {
    const normalized = normalizeToken(value);

    return persistedToProductStatus[normalized] || normalized;
};

export const withProductOrderStatus = (record) => {
    if (!record || typeof record !== "object") return record;

    return {
        ...record,
        product_status: toProductOrderStatus(record.status),
    };
};

export const withProductOrderStatusList = (records) =>
    Array.isArray(records) ? records.map(withProductOrderStatus) : records;

