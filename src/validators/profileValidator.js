import { body } from "express-validator";

export const updateProfileSchema = [
  body("name").optional().isString().trim().notEmpty(),
  body("email").optional().isEmail(),
  body("phone").optional().isString().trim(),
  body("avatar").optional().isString(), // expecting base64 data URL or file path reference
];
