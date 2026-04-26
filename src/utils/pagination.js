export const getPagination = (query) => {
    const page = Math.max(1, Number(query.page || 1));
    const limit = Math.min(50, Math.max(1, Number(query.limit || 10)));
    const offset = (page - 1) * limit;

    return { page, limit, offset };
};

export const buildPagination = (page, limit, total) => ({
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit)),
});
