import { check, body } from "express-validator";

export const registerSchema = [
  body("role").isString().notEmpty(),
  body("name").isString().notEmpty(),
  body("email").isEmail(),
  body("phone").optional().isString(),
  body("password").isLength({ min: 6 }),
];

export const loginSchema = [
  body("identifier").optional().isString(),
  body("email").optional().isEmail(),
  body("phone").optional().isString(),
  body("password").isString().notEmpty(),
];

export const requestOtpSchema = [
  body("identifier").optional().isString(),
  body("phone").optional().isString(),
  body("email").optional().isEmail(),
  body("type").optional().isString(),
];

export const verifyOtpSchema = [
  body("identifier").optional().isString(),
  body("phone").optional().isString(),
  body("email").optional().isEmail(),
  body("otp").optional().isString(),
  body("otpCode").optional().isString(),
  body("type").optional().isString(),
];

export const passwordResetSchema = [
  body("identifier").optional().isString(),
  body("email").optional().isEmail(),
  body("phone").optional().isString(),
];

export const updateMeSchema = [
  body("name").optional().isString(),
  body("email").optional().isEmail(),
  body("phone").optional().isString(),
  body("avatar").optional().isString(),
];
