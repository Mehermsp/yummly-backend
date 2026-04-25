const { v2: cloudinary } = require("cloudinary");
const { Readable } = require("stream");

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
});

const UPLOAD_PRESETS = {
    restaurant_logo: {
        folder: "tastiekit/restaurants/logos",
        transformation: [
            { width: 300, height: 300, crop: "fill", gravity: "center" },
            { quality: "auto", fetch_format: "auto" },
        ],
    },
    restaurant_cover: {
        folder: "tastiekit/restaurants/covers",
        transformation: [
            { width: 1920, height: 400, crop: "fill", gravity: "auto" },
            { quality: "auto", fetch_format: "auto" },
        ],
    },
    menu_item: {
        folder: "tastiekit/menu",
        transformation: [
            { width: 800, height: 600, crop: "fill", gravity: "auto" },
            { quality: "auto", fetch_format: "auto" },
        ],
    },
    user_profile: {
        folder: "tastiekit/users/profiles",
        transformation: [
            { width: 400, height: 400, crop: "fill", gravity: "face" },
            { quality: "auto", fetch_format: "auto" },
        ],
    },
    general: {
        folder: "tastiekit/general",
        transformation: [{ quality: "auto", fetch_format: "auto" }],
    },
};

function bufferToStream(buffer) {
    const readable = new Readable();
    readable._read = () => {};
    readable.push(buffer);
    readable.push(null);
    return readable;
}

async function uploadImage(buffer, preset = "general", originalName = "") {
    const config = UPLOAD_PRESETS[preset] || UPLOAD_PRESETS.general;

    const publicId = originalName
        ? `${config.folder}/${originalName
              .replace(/\.[^/.]+$/, "")
              .replace(/[^a-zA-Z0-9-_]/g, "_")}`
        : undefined;

    const uploadOptions = {
        // Only set folder if public_id is not provided (to avoid path duplication)
        ...(publicId ? { public_id: publicId } : { folder: config.folder }),
        transformation: config.transformation,
        resource_type: "image",
        use_filename: true,
        unique_filename: true,
        overwrite: publicId ? true : false,
    };

    return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
            uploadOptions,
            (error, result) => {
                if (error) {
                    reject(error);
                } else {
                    resolve({
                        url: result.secure_url,
                        publicId: result.public_id,
                        version: result.version,
                        format: result.format,
                        width: result.width,
                        height: result.height,
                        bytes: result.bytes,
                        createdAt: result.created_at,
                    });
                }
            }
        );

        bufferToStream(buffer).pipe(stream).on("error", reject);
    });
}

async function deleteImage(publicId) {
    return cloudinary.uploader.destroy(publicId);
}

async function deleteMultiple(publicIds) {
    return cloudinary.api.delete_resources(publicIds);
}

function getOptimizedUrl(publicId, options = {}) {
    const {
        width = 800,
        height,
        crop = "fill",
        gravity = "auto",
        quality = "auto",
        format = "auto",
    } = options;

    return cloudinary.url(publicId, {
        transformation: [
            { width, height, crop, gravity },
            { quality, fetch_format: format },
        ],
    });
}

function getThumbnailUrl(publicId, size = 150) {
    return cloudinary.url(publicId, {
        transformation: [
            { width: size, height: size, crop: "thumb", gravity: "face" },
            { quality: "auto", fetch_format: "auto" },
        ],
    });
}

function getResponsiveUrls(publicId) {
    return {
        thumbnail: getThumbnailUrl(publicId, 150),
        small: getOptimizedUrl(publicId, { width: 400 }),
        medium: getOptimizedUrl(publicId, { width: 800 }),
        large: getOptimizedUrl(publicId, { width: 1200 }),
    };
}

async function uploadFromUrl(url, preset = "general") {
    const config = UPLOAD_PRESETS[preset] || UPLOAD_PRESETS.general;

    return cloudinary.uploader.upload(url, {
        folder: config.folder,
        transformation: config.transformation,
        resource_type: "image",
    });
}

module.exports = {
    default: cloudinary,
    uploadImage,
    deleteImage,
    deleteMultiple,
    getOptimizedUrl,
    getThumbnailUrl,
    getResponsiveUrls,
    uploadFromUrl,
};
