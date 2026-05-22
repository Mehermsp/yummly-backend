import { query } from "../../config/db.js";

export const ensureAdminSettingsTable = async () => {
    await query(`
        CREATE TABLE IF NOT EXISTS admin_settings (
            id INT AUTO_INCREMENT PRIMARY KEY,
            setting_key VARCHAR(120) NOT NULL UNIQUE,
            setting_value TEXT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )
    `);
};

// ==============================
// GENERIC HELPERS
// ==============================

export const getSettingsByPrefix = async (
    prefix,
    defaults = {},
    parser = null
) => {
    await ensureAdminSettingsTable();

    const settings = await query(
        `
        SELECT *
        FROM admin_settings
        WHERE setting_key LIKE ?
        `,
        [`${prefix}_%`]
    );

    const result = { ...defaults };

    settings.forEach((s) => {
        const key = s.setting_key.replace(`${prefix}_`, "");

        result[key] = parser ? parser(key, s.setting_value) : s.setting_value;
    });

    return result;
};

export const updateSettingsByPrefix = async (prefix, settings) => {
    await ensureAdminSettingsTable();

    for (const [key, value] of Object.entries(settings)) {
        await query(
            `
            INSERT INTO admin_settings (
                setting_key,
                setting_value
            )
            VALUES (?, ?)
            ON DUPLICATE KEY UPDATE
                setting_value = ?
            `,
            [`${prefix}_${key}`, value.toString(), value.toString()]
        );
    }

    return {
        success: true,
        message: `${prefix} settings updated successfully`,
    };
};

// ==============================
// GENERAL SETTINGS
// ==============================

export const getGeneralSettings = async () => {
    return getSettingsByPrefix("general", {
        platform_name: "TastieKit",
        support_email: "support@tastiekit.com",
        support_phone: "+91 9876543210",
        currency: "INR",
        timezone: "Asia/Kolkata",
    });
};

export const updateGeneralSettings = async (settings) => {
    return updateSettingsByPrefix("general", settings);
};

// ==============================
// NOTIFICATION SETTINGS
// ==============================

export const getNotificationSettings = async () => {
    return getSettingsByPrefix(
        "notification",
        {
            email_notifications: true,
            sms_notifications: false,
            push_notifications: true,
            new_order_alert: true,
            new_application_alert: true,
            low_stock_alert: false,
        },
        (_, value) => value === "true"
    );
};

export const updateNotificationSettings = async (settings) => {
    return updateSettingsByPrefix("notification", settings);
};

// ==============================
// SECURITY SETTINGS
// ==============================

export const getSecuritySettings = async () => {
    return getSettingsByPrefix(
        "security",
        {
            two_factor_auth: false,
            session_timeout: 30,
            password_expiry_days: 90,
            max_login_attempts: 5,
        },
        (key, value) =>
            key === "two_factor_auth" ? value === "true" : parseInt(value)
    );
};

export const updateSecuritySettings = async (settings) => {
    return updateSettingsByPrefix("security", settings);
};

// ==============================
// COMMISSION SETTINGS
// ==============================

export const getRestaurantCommission = async () => {
    return getSettingsByPrefix(
        "commission",
        {
            percentage: 15,
            fixed_fee: 0,
            min_order_amount: 100,
            max_commission: 500,
        },
        (_, value) => parseFloat(value)
    );
};

export const updateRestaurantCommission = async (settings) => {
    return updateSettingsByPrefix("commission", settings);
};

// ==============================
// DELIVERY SETTINGS
// ==============================

export const getDeliverySettings = async () => {
    return getSettingsByPrefix(
        "delivery",
        {
            base_delivery_fee: 30,
            per_km_rate: 10,
            min_delivery_fee: 25,
            max_delivery_fee: 100,
            peak_hour_multiplier: 1.5,
            peak_hours: "12:00-14:00,19:00-22:00",
        },
        (key, value) => (key === "peak_hours" ? value : parseFloat(value))
    );
};

export const updateDeliverySettings = async (settings) => {
    return updateSettingsByPrefix("delivery", settings);
};
