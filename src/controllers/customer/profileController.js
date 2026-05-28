import { asyncHandler } from "../../utils/asyncHandler.js";
import { sendSuccess } from "../../utils/http.js";
import { updateMe, getMe } from "../../services/auth/authService.js";
import { uploadImage } from "../../utils/cloudinary.js";

// GET /profile – returns current logged‑in user profile (sanitized)
export const getProfile = asyncHandler(async (req, res) => {
  const user = await getMe(req.user.id);
  sendSuccess(res, user, "Profile fetched successfully");
});

// PUT /profile – update fields; if avatar provided, upload to Cloudinary
export const updateProfile = asyncHandler(async (req, res) => {
  const { avatar, ...rest } = req.body;

  let avatarUrl = undefined;
  if (avatar) {
    // `avatar` is expected to be a base64 data URL or a temporary file path.
    // For simplicity we forward it to Cloudinary; Cloudinary will handle data URLs.
    const result = await uploadImage(avatar, { folder: "avatars" });
    avatarUrl = result.secure_url;
  }

  const payload = { ...rest };
  if (avatarUrl) payload.avatar = avatarUrl;

  const updated = await updateMe(req.user.id, payload);
  sendSuccess(res, updated, "Profile updated successfully");
});
