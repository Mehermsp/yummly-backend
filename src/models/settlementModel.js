import { getOne, query, withTransaction } from "../config/db.js";

const maskAccountNumber = (accountNumber = "") => {
    const value = String(accountNumber);
    if (value.length <= 4) return value;
    return `${"*".repeat(Math.max(0, value.length - 4))}${value.slice(-4)}`;
};

export const normalizeBankAccount = (row) =>
    row
        ? {
              ...row,
              masked_account_number: maskAccountNumber(row.account_number),
          }
        : null;

export const validateBankDetails = ({
    accountHolderName,
    bankName,
    accountNumber,
    ifscCode,
}) => {
    const errors = [];
    const normalizedIfsc = String(ifscCode || "").trim().toUpperCase();
    const normalizedAccount = String(accountNumber || "").trim();

    if (!String(accountHolderName || "").trim()) {
        errors.push("Account holder name is required");
    }

    if (!String(bankName || "").trim()) {
        errors.push("Bank name is required");
    }

    if (!/^\d{9,18}$/.test(normalizedAccount)) {
        errors.push("Account number must be 9 to 18 digits");
    }

    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(normalizedIfsc)) {
        errors.push("IFSC code is invalid");
    }

    return {
        valid: errors.length === 0,
        errors,
        normalized: {
            accountHolderName: String(accountHolderName || "").trim(),
            bankName: String(bankName || "").trim(),
            accountNumber: normalizedAccount,
            ifscCode: normalizedIfsc,
        },
    };
};

export const upsertPartnerBankAccount = async ({
    partnerType,
    partnerId,
    accountHolderName,
    bankName,
    accountNumber,
    ifscCode,
    upiId = null,
}) => {
    const validation = validateBankDetails({
        accountHolderName,
        bankName,
        accountNumber,
        ifscCode,
    });

    if (!validation.valid) {
        const error = new Error(validation.errors.join(", "));
        error.details = validation.errors;
        throw error;
    }

    const result = await query(
        `
        INSERT INTO partner_bank_accounts (
            partner_type,
            partner_id,
            account_holder_name,
            bank_name,
            account_number,
            ifsc_code,
            upi_id,
            status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
        ON DUPLICATE KEY UPDATE
            account_holder_name = VALUES(account_holder_name),
            bank_name = VALUES(bank_name),
            account_number = VALUES(account_number),
            ifsc_code = VALUES(ifsc_code),
            upi_id = VALUES(upi_id),
            status = 'pending',
            verification_notes = NULL,
            verified_by = NULL,
            verified_at = NULL,
            rejected_at = NULL,
            updated_at = CURRENT_TIMESTAMP
        `,
        [
            partnerType,
            partnerId,
            validation.normalized.accountHolderName,
            validation.normalized.bankName,
            validation.normalized.accountNumber,
            validation.normalized.ifscCode,
            upiId || null,
        ]
    );

    return result;
};

export const getPartnerBankAccount = async (partnerType, partnerId) =>
    normalizeBankAccount(
        await getOne(
            `
            SELECT *
            FROM partner_bank_accounts
            WHERE partner_type = ? AND partner_id = ?
            LIMIT 1
            `,
            [partnerType, partnerId]
        )
    );

export const listPartnerBankAccounts = async ({ partnerType, status } = {}) => {
    const rows = await query(
        `
        SELECT
            pba.*,
            CASE
                WHEN pba.partner_type = 'restaurant' THEN r.name
                ELSE u.name
            END AS partner_name,
            CASE
                WHEN pba.partner_type = 'restaurant' THEN r.phone
                ELSE u.phone
            END AS partner_phone,
            verifier.name AS verified_by_name
        FROM partner_bank_accounts pba
        LEFT JOIN restaurants r
            ON pba.partner_type = 'restaurant' AND r.id = pba.partner_id
        LEFT JOIN users u
            ON pba.partner_type = 'delivery_partner' AND u.id = pba.partner_id
        LEFT JOIN users verifier
            ON verifier.id = pba.verified_by
        WHERE (? IS NULL OR pba.partner_type = ?)
          AND (? IS NULL OR pba.status = ?)
        ORDER BY
            FIELD(pba.status, 'pending', 'rejected', 'verified'),
            pba.updated_at DESC
        `,
        [
            partnerType || null,
            partnerType || null,
            status || null,
            status || null,
        ]
    );

    return rows.map(normalizeBankAccount);
};

export const updateBankVerification = async ({
    bankAccountId,
    status,
    adminId,
    notes,
}) => {
    await query(
        `
        UPDATE partner_bank_accounts
        SET status = ?,
            verification_notes = ?,
            verified_by = ?,
            verified_at = CASE WHEN ? = 'verified' THEN CURRENT_TIMESTAMP ELSE NULL END,
            rejected_at = CASE WHEN ? = 'rejected' THEN CURRENT_TIMESTAMP ELSE NULL END,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        `,
        [status, notes || null, adminId, status, status, bankAccountId]
    );
};

export const listMonthlySettlements = async ({
    partnerType,
    status,
    periodStart,
    periodEnd,
} = {}) =>
    query(
        `
        SELECT
            ms.*,
            pba.masked_account_number,
            pba.bank_name,
            CASE
                WHEN ms.partner_type = 'restaurant' THEN r.name
                ELSE u.name
            END AS partner_name,
            CASE
                WHEN ms.partner_type = 'restaurant' THEN r.phone
                ELSE u.phone
            END AS partner_phone
        FROM monthly_settlements ms
        INNER JOIN (
            SELECT
                *,
                CONCAT(REPEAT('*', GREATEST(CHAR_LENGTH(account_number) - 4, 0)), RIGHT(account_number, 4)) AS masked_account_number
            FROM partner_bank_accounts
        ) pba ON pba.id = ms.bank_account_id
        LEFT JOIN restaurants r
            ON ms.partner_type = 'restaurant' AND r.id = ms.partner_id
        LEFT JOIN users u
            ON ms.partner_type = 'delivery_partner' AND u.id = ms.partner_id
        WHERE (? IS NULL OR ms.partner_type = ?)
          AND (? IS NULL OR ms.status = ?)
          AND (? IS NULL OR ms.period_start = ?)
          AND (? IS NULL OR ms.period_end = ?)
        ORDER BY ms.generated_at DESC
        `,
        [
            partnerType || null,
            partnerType || null,
            status || null,
            status || null,
            periodStart || null,
            periodStart || null,
            periodEnd || null,
            periodEnd || null,
        ]
    );

export const generateMonthlySettlements = async ({
    periodStart,
    periodEnd,
    generatedBy,
    restaurantCommissionPercent = 15,
    deliveryPartnerSharePercent = 100,
}) =>
    withTransaction(async (connection) => {
        const [restaurantRows] = await connection.execute(
            `
            SELECT
                r.id AS partner_id,
                pba.id AS bank_account_id,
                COALESCE(SUM(o.total), 0) AS gross_amount
            FROM restaurants r
            INNER JOIN partner_bank_accounts pba
                ON pba.partner_type = 'restaurant'
                AND pba.partner_id = r.id
                AND pba.status = 'verified'
            INNER JOIN orders o
                ON o.restaurant_id = r.id
                AND o.status IN ('delivered', 'refunded')
                AND DATE(o.created_at) BETWEEN ? AND ?
            GROUP BY r.id, pba.id
            HAVING gross_amount > 0
            `,
            [periodStart, periodEnd]
        );

        const [deliveryRows] = await connection.execute(
            `
            SELECT
                u.id AS partner_id,
                pba.id AS bank_account_id,
                COALESCE(SUM(o.delivery_fee), 0) AS gross_amount
            FROM users u
            INNER JOIN partner_bank_accounts pba
                ON pba.partner_type = 'delivery_partner'
                AND pba.partner_id = u.id
                AND pba.status = 'verified'
            INNER JOIN orders o
                ON o.delivery_partner_id = u.id
                AND o.status = 'delivered'
                AND DATE(o.created_at) BETWEEN ? AND ?
            WHERE u.role = 'delivery_partner'
            GROUP BY u.id, pba.id
            HAVING gross_amount > 0
            `,
            [periodStart, periodEnd]
        );

        const insertSettlement = async ({
            partnerType,
            partnerId,
            bankAccountId,
            grossAmount,
            platformFee,
        }) => {
            const gross = Number(grossAmount || 0);
            const fee = Number(platformFee || 0);
            const net = Math.max(0, gross - fee);
            const settlementNumber = `TK-SET-${partnerType
                .slice(0, 3)
                .toUpperCase()}-${periodStart.replace(/-/g, "")}-${partnerId}`;

            await connection.execute(
                `
                INSERT INTO monthly_settlements (
                    settlement_number,
                    partner_type,
                    partner_id,
                    bank_account_id,
                    period_start,
                    period_end,
                    gross_amount,
                    platform_fee,
                    net_amount,
                    status,
                    generated_by
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'generated', ?)
                ON DUPLICATE KEY UPDATE
                    bank_account_id = VALUES(bank_account_id),
                    gross_amount = VALUES(gross_amount),
                    platform_fee = VALUES(platform_fee),
                    net_amount = VALUES(net_amount),
                    status = CASE
                        WHEN status IN ('paid', 'processing') THEN status
                        ELSE 'generated'
                    END,
                    generated_by = VALUES(generated_by),
                    updated_at = CURRENT_TIMESTAMP
                `,
                [
                    settlementNumber,
                    partnerType,
                    partnerId,
                    bankAccountId,
                    periodStart,
                    periodEnd,
                    gross,
                    fee,
                    net,
                    generatedBy || null,
                ]
            );
        };

        for (const row of restaurantRows) {
            const gross = Number(row.gross_amount || 0);
            await insertSettlement({
                partnerType: "restaurant",
                partnerId: row.partner_id,
                bankAccountId: row.bank_account_id,
                grossAmount: gross,
                platformFee: Number(
                    ((gross * Number(restaurantCommissionPercent || 0)) / 100).toFixed(2)
                ),
            });
        }

        for (const row of deliveryRows) {
            const gross = Number(row.gross_amount || 0);
            const payout = Number(deliveryPartnerSharePercent || 100);
            const platformFee = Number(
                (gross * Math.max(0, 100 - payout) / 100).toFixed(2)
            );
            await insertSettlement({
                partnerType: "delivery_partner",
                partnerId: row.partner_id,
                bankAccountId: row.bank_account_id,
                grossAmount: gross,
                platformFee,
            });
        }

        return {
            restaurants: restaurantRows.length,
            deliveryPartners: deliveryRows.length,
        };
    });

export const updateSettlementStatus = async ({
    settlementId,
    status,
    paymentReference,
    adminNotes,
}) =>
    query(
        `
        UPDATE monthly_settlements
        SET status = ?,
            payment_reference = COALESCE(?, payment_reference),
            admin_notes = COALESCE(?, admin_notes),
            paid_at = CASE WHEN ? = 'paid' THEN CURRENT_TIMESTAMP ELSE paid_at END,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        `,
        [
            status,
            paymentReference || null,
            adminNotes || null,
            status,
            settlementId,
        ]
    );
