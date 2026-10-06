export const SITE_HOST = 'mammothclub.com'

export function isSupportedUrl(url: string | undefined): boolean {
  if (!url) return false
  try {
    const { protocol, hostname } = new URL(url)
    return protocol === 'https:' && (hostname === SITE_HOST || hostname.endsWith(`.${SITE_HOST}`))
  } catch {
    return false
  }
}
