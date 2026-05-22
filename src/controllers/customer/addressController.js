import { asyncHandler } from "../../utils/asyncHandler.js";

import { AppError, sendSuccess } from "../../utils/http.js";

import {
    createAddress,
    deleteAddress,
    getAddressById,
    listAddresses,
    setDefaultAddress,
    updateAddress,
} from "../../models/customerModel.js";

export const getAddresses = asyncHandler(async (req, res) => {
    const items = await listAddresses(req.user.id);

    sendSuccess(res, items, "Addresses fetched successfully");
});

export const createCustomerAddress = asyncHandler(async (req, res) => {
    const { street, city, pincode } = req.body;

    if (!street || !city || !pincode) {
        throw new AppError(400, "street, city and pincode are required");
    }

    const addressId = await createAddress(req.user.id, req.body);

    const address = await getAddressById(req.user.id, addressId);

    sendSuccess(res, address, "Address created successfully", 201);
});

export const updateCustomerAddress = asyncHandler(async (req, res) => {
    const existing = await getAddressById(req.user.id, req.params.addressId);

    if (!existing) {
        throw new AppError(404, "Address not found");
    }

    await updateAddress(req.user.id, req.params.addressId, req.body);

    const address = await getAddressById(req.user.id, req.params.addressId);

    sendSuccess(res, address, "Address updated successfully");
});

export const deleteCustomerAddress = asyncHandler(async (req, res) => {
    const existing = await getAddressById(req.user.id, req.params.addressId);

    if (!existing) {
        throw new AppError(404, "Address not found");
    }

    await deleteAddress(req.user.id, req.params.addressId);

    sendSuccess(res, null, "Address deleted successfully");
});

export const markDefaultCustomerAddress = asyncHandler(async (req, res) => {
    const existing = await getAddressById(req.user.id, req.params.addressId);

    if (!existing) {
        throw new AppError(404, "Address not found");
    }

    await setDefaultAddress(req.user.id, req.params.addressId);

    const addresses = await listAddresses(req.user.id);

    sendSuccess(res, addresses, "Default address updated successfully");
});
