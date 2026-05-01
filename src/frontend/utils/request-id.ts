export function createRequestId(): string {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID()
  }

  const random = Math.random().toString(36).slice(2)
  const timestamp = Date.now().toString(36)
  return `req-${timestamp}-${random}`
}
