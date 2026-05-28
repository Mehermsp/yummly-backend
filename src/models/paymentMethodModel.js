import { query, getOne } from "../config/db.js";

// Simplified payment method storage – only tokenised identifier & optional metadata.

export const addPaymentMethod = async (userId, { type, gatewayToken, details }) => {
  const result = await query(
    `INSERT INTO payment_methods (user_id, type, gateway_token, details, is_default) VALUES (?, ?, ?, ?, ?)`,
    [userId, type, gatewayToken, JSON.stringify(details || {}), 0]
  );
  return result.insertId;
};

export const listPaymentMethods = async (userId) =>
  query(
    `SELECT id, type, gateway_token AS token, details, is_default FROM payment_methods WHERE user_id = ? ORDER BY is_default DESC, id DESC`,
    [userId]
  );

export const getPaymentMethodById = async (userId, methodId) =>
  getOne(
    `SELECT id, type, gateway_token AS token, details, is_default FROM payment_methods WHERE user_id = ? AND id = ?`,
    [userId, methodId]
  );

export const deletePaymentMethod = async (userId, methodId) =>
  query(`DELETE FROM payment_methods WHERE user_id = ? AND id = ?`, [userId, methodId]);

export const setDefaultPaymentMethod = async (userId, methodId) =>
  query(
    `UPDATE payment_methods SET is_default = CASE WHEN id = ? THEN 1 ELSE 0 END WHERE user_id = ?`,
    [methodId, userId]
  );
