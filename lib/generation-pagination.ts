export function historyPage(value: unknown) {
  const page = Number(value ?? 1);
  if (!Number.isSafeInteger(page) || page < 1 || page > 1000000) throw Error("INVALID_INPUT");
  return page;
}
export function pagination(total: number, requested: number, pageSize: number) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return { total, page: Math.min(requested, totalPages), pageSize, totalPages };
}
