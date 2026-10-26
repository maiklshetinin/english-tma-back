// HTTP-ошибки сервера. Отдельный чистый файл (без Firebase), чтобы им могли пользоваться и проверки данных (clean.ts), и фронт в тестах.
export type HttpError = Error & { status: number }
export const fail = (status: number, message: string): HttpError => Object.assign(new Error(message), { status })
