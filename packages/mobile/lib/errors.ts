/**
 * Error Handling Utilities
 * Centralized error types, messages, and classification
 */

/**
 * Error type constants for classification
 */
export enum ErrorType {
  NETWORK_TIMEOUT = 'NETWORK_TIMEOUT',
  NETWORK_OFFLINE = 'NETWORK_OFFLINE',
  NETWORK_ERROR = 'NETWORK_ERROR',
  API_ERROR = 'API_ERROR',
  STORAGE_ERROR = 'STORAGE_ERROR',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  PERMISSION_DENIED = 'PERMISSION_DENIED',
  NOT_FOUND = 'NOT_FOUND',
  UNKNOWN = 'UNKNOWN',
}

/**
 * User-friendly error messages
 */
export const ERROR_MESSAGES: Record<ErrorType, string> = {
  [ErrorType.NETWORK_TIMEOUT]: 'Request timed out. Please check your connection and try again.',
  [ErrorType.NETWORK_OFFLINE]: 'No internet connection. Please check your network settings.',
  [ErrorType.NETWORK_ERROR]: 'Network error. Please check your connection.',
  [ErrorType.API_ERROR]: 'Server error. Please try again later.',
  [ErrorType.STORAGE_ERROR]: 'Could not save data. Please check storage permissions.',
  [ErrorType.VALIDATION_ERROR]: 'Invalid data provided. Please check your input.',
  [ErrorType.PERMISSION_DENIED]: 'Permission denied. Please grant the required permissions.',
  [ErrorType.NOT_FOUND]: 'The requested resource was not found.',
  [ErrorType.UNKNOWN]: 'An unexpected error occurred. Please try again.',
};

/**
 * Classify an error into a specific type
 */
export function classifyError(error: unknown): ErrorType {
  if (!error) {
    return ErrorType.UNKNOWN;
  }

  // Handle Error objects
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    const name = error.name.toLowerCase();

    // Timeout errors
    if (
      name === 'aborterror' ||
      message.includes('timeout') ||
      message.includes('aborted')
    ) {
      return ErrorType.NETWORK_TIMEOUT;
    }

    // Network/connection errors
    if (
      message.includes('network') ||
      message.includes('failed to fetch') ||
      message.includes('econnrefused') ||
      message.includes('enotfound') ||
      message.includes('connection')
    ) {
      return ErrorType.NETWORK_ERROR;
    }

    // Offline errors
    if (
      message.includes('offline') ||
      message.includes('no internet')
    ) {
      return ErrorType.NETWORK_OFFLINE;
    }

    // Storage errors
    if (
      message.includes('storage') ||
      message.includes('asyncstorage') ||
      message.includes('quota')
    ) {
      return ErrorType.STORAGE_ERROR;
    }

    // Permission errors
    if (
      message.includes('permission') ||
      message.includes('denied') ||
      message.includes('not allowed')
    ) {
      return ErrorType.PERMISSION_DENIED;
    }

    // Validation errors
    if (
      message.includes('invalid') ||
      message.includes('validation') ||
      message.includes('required')
    ) {
      return ErrorType.VALIDATION_ERROR;
    }

    // Not found errors
    if (
      message.includes('not found') ||
      message.includes('404')
    ) {
      return ErrorType.NOT_FOUND;
    }

    // HTTP errors
    if (
      message.includes('http') ||
      message.includes('status') ||
      /\b[45]\d{2}\b/.test(message)
    ) {
      return ErrorType.API_ERROR;
    }
  }

  // Handle response-like objects
  if (typeof error === 'object' && error !== null) {
    const err = error as Record<string, unknown>;
    if (err.status === 404 || err.statusCode === 404) {
      return ErrorType.NOT_FOUND;
    }
    if (typeof err.status === 'number' && err.status >= 400) {
      return ErrorType.API_ERROR;
    }
  }

  return ErrorType.UNKNOWN;
}

/**
 * Get a user-friendly message for an error
 */
export function getErrorMessage(error: unknown): string {
  const errorType = classifyError(error);
  return ERROR_MESSAGES[errorType];
}

/**
 * Extract error message from various error formats
 */
export function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'object' && error !== null) {
    const err = error as Record<string, unknown>;
    if (typeof err.message === 'string') {
      return err.message;
    }
    if (typeof err.error === 'string') {
      return err.error;
    }
  }

  if (typeof error === 'string') {
    return error;
  }

  return 'An unknown error occurred';
}

/**
 * Wrapper for async functions with error handling
 */
export async function withErrorHandling<T>(
  fn: () => Promise<T>,
  options?: {
    onError?: (error: Error, type: ErrorType) => void;
    fallback?: T;
    rethrow?: boolean;
  }
): Promise<T | null> {
  try {
    return await fn();
  } catch (error) {
    const errorType = classifyError(error);
    const wrappedError = error instanceof Error
      ? error
      : new Error(extractErrorMessage(error));

    if (options?.onError) {
      options.onError(wrappedError, errorType);
    }

    if (options?.rethrow) {
      throw wrappedError;
    }

    return options?.fallback ?? null;
  }
}

/**
 * Retry a function with exponential backoff
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options?: {
    maxAttempts?: number;
    delayMs?: number;
    backoffMultiplier?: number;
    retryableErrors?: ErrorType[];
    onRetry?: (attempt: number, error: Error) => void;
  }
): Promise<T> {
  const maxAttempts = options?.maxAttempts ?? 3;
  const initialDelay = options?.delayMs ?? 1000;
  const multiplier = options?.backoffMultiplier ?? 2;
  const retryableErrors = options?.retryableErrors ?? [
    ErrorType.NETWORK_TIMEOUT,
    ErrorType.NETWORK_ERROR,
    ErrorType.API_ERROR,
  ];

  let lastError: Error | null = null;
  let delay = initialDelay;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(extractErrorMessage(error));
      const errorType = classifyError(error);

      // Check if error is retryable
      if (!retryableErrors.includes(errorType) || attempt === maxAttempts) {
        throw lastError;
      }

      // Notify about retry
      if (options?.onRetry) {
        options.onRetry(attempt, lastError);
      }

      // Wait before retrying
      await new Promise((resolve) => setTimeout(resolve, delay));
      delay *= multiplier;
    }
  }

  throw lastError ?? new Error('Max retry attempts reached');
}

/**
 * Check if device appears to be online
 * Note: This is a basic check, actual connectivity may vary
 */
export function isNetworkError(error: unknown): boolean {
  const errorType = classifyError(error);
  return [
    ErrorType.NETWORK_TIMEOUT,
    ErrorType.NETWORK_OFFLINE,
    ErrorType.NETWORK_ERROR,
  ].includes(errorType);
}

/**
 * Check if error is recoverable (worth retrying)
 */
export function isRecoverableError(error: unknown): boolean {
  const errorType = classifyError(error);
  return [
    ErrorType.NETWORK_TIMEOUT,
    ErrorType.NETWORK_ERROR,
    ErrorType.API_ERROR,
  ].includes(errorType);
}

/**
 * Log error with context
 */
export function logError(
  context: string,
  error: unknown,
  extra?: Record<string, unknown>
): void {
  const errorType = classifyError(error);
  const message = extractErrorMessage(error);

  console.error(`[${context}] ${errorType}: ${message}`, {
    error,
    errorType,
    ...extra,
  });
}
