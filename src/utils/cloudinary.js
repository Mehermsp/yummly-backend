import { cloudinary } from "../config/cloudinary.js";

export const uploadImage = async (filePath, options = {}) =>
    cloudinary.uploader.upload(filePath, options);

export const updateImage = async (oldPublicId, newFilePath, options = {}) => {
    if (oldPublicId) {
        await cloudinary.uploader.destroy(oldPublicId);
    }

    return uploadImage(newFilePath, options);
};

export const deleteImage = async (publicId) =>
    cloudinary.uploader.destroy(publicId);
