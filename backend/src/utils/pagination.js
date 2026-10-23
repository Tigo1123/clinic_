export function parsePagination(query = {}, { defaultPageSize = 50, maxPageSize = 100 } = {}) {
  const pageValue = Number(query.page ?? 1);
  const sizeValue = Number(query.pageSize ?? defaultPageSize);
  const page = Number.isSafeInteger(pageValue) && pageValue > 0 ? pageValue : 1;
  const pageSize = Number.isSafeInteger(sizeValue) && sizeValue > 0
    ? Math.min(sizeValue, maxPageSize)
    : defaultPageSize;
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}

export function paginationHeaders(res, { page, pageSize, hasMore }) {
  res.set('X-Page', String(page));
  res.set('X-Page-Size', String(pageSize));
  res.set('X-Has-More', hasMore ? 'true' : 'false');
  return res;
}
