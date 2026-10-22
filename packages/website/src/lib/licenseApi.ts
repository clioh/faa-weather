/**
 * Client for the customer-facing license management API (docs/LICENSING.md, "Cloud API").
 * All endpoints are POST /api/license/:action with JSON bodies.
 * Errors come back as { status: "<code>", message: "<human text>" }.
 */

export type LicenseStatus = 'pending' | 'active' | 'revoked'

export interface ManagedLicense {
  id: string
  keyLast4: string | null
  productId: string
  status: LicenseStatus
  mirrorId: string | null
  activatedAt: string | null
  lastSeenAt: string | null
}

export interface ManageListResponse {
  email: string
  licenses: ManagedLicense[]
  releasesRemaining: number
}

/** A failed call. `code` is the API's `status` field, or 'network' when the request never completed. */
export class LicenseApiError extends Error {
  readonly code: string
  readonly httpStatus: number

  constructor(code: string, message: string, httpStatus: number) {
    super(message)
    this.code = code
    this.httpStatus = httpStatus
  }
}

async function post<T>(action: string, body: unknown): Promise<T> {
  let response: Response
  try {
    response = await fetch(`/api/license/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch {
    throw new LicenseApiError('network', "Couldn't reach SkyGlass. Check your connection and try again.", 0)
  }

  const data = (await response.json().catch(() => null)) as
    | (T & { status?: string; message?: string })
    | null

  if (!response.ok) {
    throw new LicenseApiError(
      data?.status ?? (response.status === 429 ? 'rate_limited' : 'error'),
      data?.message ?? 'Something went wrong. Please try again.',
      response.status
    )
  }
  if (data === null) {
    throw new LicenseApiError('error', 'Something went wrong. Please try again.', response.status)
  }
  return data
}

export const requestManageLink = (email: string) => post<{ ok: true }>('manage-request', { email })

export const listLicenses = (token: string) => post<ManageListResponse>('manage-list', { token })

export const releaseLicense = (token: string, licenseId: string) =>
  post<{ ok: true }>('manage-release', { token, licenseId })

export const reissueLicense = (token: string, licenseId: string) =>
  post<{ ok: true }>('manage-reissue', { token, licenseId })
