// Video (and later music) is served from the CDN in infra/, under content-hashed, immutable paths.
const MEDIA_ORIGIN: string = import.meta.env.PUBLIC_MEDIA_ORIGIN ?? "https://d19iphx0l37kqa.cloudfront.net"

export const mediaUrl = (path: string): string => `${MEDIA_ORIGIN}/${path}`
