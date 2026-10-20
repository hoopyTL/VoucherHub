import type { Request, Response, NextFunction } from 'express'

import { AppError } from '~/utils/app-error'
import { ErrorCode } from '~/utils/error-codes'
import { HttpError } from '~/errors/http-error'

export class NotFoundError extends AppError {
  constructor(message = 'Không tìm thấy dữ liệu') {
    super(message, 404, ErrorCode.RESOURCE_NOT_FOUND)
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Dữ liệu không hợp lệ', details?: Array<{ field: string; message: string }>) {
    super(message, 422, ErrorCode.UNPROCESSABLE_ENTITY, details)
  }
}

export class BadRequestError extends AppError {
  constructor(message = 'Yêu cầu không hợp lệ', details?: Array<{ field: string; message: string }>) {
    super(message, 400, ErrorCode.BAD_REQUEST, details)
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Xung đột trạng thái') {
    super(message, 409, ErrorCode.CONFLICT)
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Không đủ quyền') {
    super(message, 403, ErrorCode.FORBIDDEN)
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Chưa xác thực') {
    super(message, 401, ErrorCode.UNAUTHORIZED)
  }
}

interface ErrorResponseBody {
  success: false
  error: {
    code: string
    message: string
    details?: unknown
  }
}

export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction): void {
  void _next
  if (err instanceof HttpError && [400, 404, 409].includes(err.statusCode)) {
    const codes: Record<number, string> = {
      400: ErrorCode.BAD_REQUEST,
      404: ErrorCode.RESOURCE_NOT_FOUND,
      409: ErrorCode.CONFLICT
    }
    res.status(err.statusCode).json({
      success: false,
      error: {
        code: codes[err.statusCode],
        message: err.message,
        ...(err.details !== undefined && { details: err.details })
      }
    })
    return
  }
  // 1. AppError
  if (err instanceof AppError) {
    const isServerError = err.statusCode >= 500
    const body: ErrorResponseBody = {
      success: false,
      error: {
        code: err.code,
        message: isServerError ? 'An unexpected error occurred' : err.message,
        ...(!isServerError && err.details !== undefined && { details: err.details })
      }
    }
    if (isServerError && process.env.NODE_ENV !== 'test') {
      console.error(JSON.stringify({ event: 'server_error', code: err.code, requestId: res.locals.requestId }))
    }
    res.status(err.statusCode).json(body)
    return
  }

  // 2. Zod validation errors
  if (err.name === 'ZodError' && 'issues' in err) {
    const issues = (err as { issues: Array<{ path: (string | number)[]; message: string }> }).issues
    const details = issues.map((i) => ({
      field: i.path.join('.'),
      message: i.message
    }))

    const body: ErrorResponseBody = {
      success: false,
      error: {
        code: ErrorCode.VALIDATION_ERROR,
        message: 'Dữ liệu không hợp lệ',
        details
      }
    }
    res.status(400).json(body)
    return
  }

  // 3. Malformed JSON body (Express json() parser)
  if (err instanceof SyntaxError && 'body' in err) {
    const body: ErrorResponseBody = {
      success: false,
      error: {
        code: ErrorCode.BAD_REQUEST,
        message: 'Dữ liệu JSON trong yêu cầu không hợp lệ'
      }
    }
    res.status(400).json(body)
    return
  }

  // 4. Prisma known errors
  if (err.constructor?.name === 'PrismaClientKnownRequestError' && 'code' in err) {
    const prismaErr = err as { code: string; meta?: { target?: string[] } }

    if (prismaErr.code === 'P2002') {
      // Unique constraint violation
      const body: ErrorResponseBody = {
        success: false,
        error: {
          code: ErrorCode.DUPLICATE_ENTRY,
          message: 'Đã tồn tại bản ghi có giá trị này',
          details: prismaErr.meta?.target ? { fields: prismaErr.meta.target } : undefined
        }
      }
      res.status(409).json(body)
      return
    }

    if (prismaErr.code === 'P2025') {
      // Record not found
      const body: ErrorResponseBody = {
        success: false,
        error: {
          code: ErrorCode.RESOURCE_NOT_FOUND,
          message: 'Không tìm thấy bản ghi'
        }
      }
      res.status(404).json(body)
      return
    }
  }

  // 5. Unknown / unhandled — log + generic response
  if (process.env.NODE_ENV !== 'test') {
    console.error(
      JSON.stringify({ event: 'unhandled_error', code: ErrorCode.INTERNAL_ERROR, requestId: res.locals.requestId })
    )
  }

  const body: ErrorResponseBody = {
    success: false,
    error: {
      code: ErrorCode.INTERNAL_ERROR,
      message: 'Đã xảy ra lỗi không mong muốn'
    }
  }
  res.status(500).json(body)
}
