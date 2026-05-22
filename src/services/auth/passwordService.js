import { AppError } from "../../utils/http.js";

import {
    hashPassword,
    updateUserPasswordById,
    consumePasswordResetToken,
} from "../../models/userModel.js";

export const resetPassword = async ({ email, resetToken, newPassword }) => {
    if (!email || !resetToken || !newPassword) {
        throw new AppError(
            400,
            "email, resetToken and newPassword are required"
        );
    }

    if (String(newPassword).length < 6) {
        throw new AppError(400, "Password must be at least 6 characters");
    }

    const tokenRow = await consumePasswordResetToken({
        email,
        resetToken,
    });

    if (!tokenRow) {
        throw new AppError(400, "Reset token is invalid or expired");
    }

    const passwordHash = await hashPassword(newPassword);

    await updateUserPasswordById(tokenRow.user_id, passwordHash);

    return true;
};
