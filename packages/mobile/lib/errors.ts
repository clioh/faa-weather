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
 * Extract error message from various error formats
 */
function extractErrorMessage(error: unknown): string {
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
