import * as aws from "@pulumi/aws"
import * as pulumi from "@pulumi/pulumi"

// AWS-managed policies, looked up by ID so they never drift from AWS's definitions.
const CACHING_OPTIMIZED = "658327ea-f89d-4fab-a63d-7e88639e58f6"

const tags = { project: "gaze-into-the-abyss", stack: pulumi.getStack() }

// The bucket stays private: only CloudFront reads it, through Origin Access Control.
const bucket = new aws.s3.Bucket("media", { bucketPrefix: "gaze-into-the-abyss-media-", forceDestroy: false, tags })

new aws.s3.BucketOwnershipControls("media", {
  bucket: bucket.id,
  rule: { objectOwnership: "BucketOwnerEnforced" },
})

const publicAccessBlock = new aws.s3.BucketPublicAccessBlock("media", {
  bucket: bucket.id,
  blockPublicAcls: true,
  ignorePublicAcls: true,
  blockPublicPolicy: true,
  restrictPublicBuckets: true,
})

const oac = new aws.cloudfront.OriginAccessControl("media", {
  description: "CloudFront reads the abyss media bucket",
  originAccessControlOriginType: "s3",
  signingBehavior: "always",
  signingProtocol: "sigv4",
})

const originId = "media-s3"

// WebGL reads video frames, so every response must carry Access-Control-Allow-Origin. AWS's Managed-SimpleCORS
// sends it only for "simple" requests, judged by the request headers, and browsers add cache-control and priority
// to media requests, so it withheld the header from exactly the requests that need it. This allows any header.
const cors = new aws.cloudfront.ResponseHeadersPolicy("media-cors", {
  comment: "Any origin may read abyss media, whatever headers the browser sends",
  corsConfig: {
    accessControlAllowOrigins: { items: ["*"] },
    accessControlAllowMethods: { items: ["GET", "HEAD", "OPTIONS"] },
    accessControlAllowHeaders: { items: ["*"] },
    accessControlAllowCredentials: false,
    accessControlMaxAgeSec: 86400,
    originOverride: true,
  },
})

// Paths are content-hashed and uploaded with `Cache-Control: public, max-age=31536000, immutable`,
// which CachingOptimized honours, so a new file is a new URL and nothing ever needs invalidating.
const distribution = new aws.cloudfront.Distribution("media", {
  enabled: true,
  comment: "gaze-into-the-abyss media",
  httpVersion: "http2and3",
  isIpv6Enabled: true,
  priceClass: "PriceClass_100",
  origins: [{
    originId,
    domainName: bucket.bucketRegionalDomainName,
    originAccessControlId: oac.id,
  }],
  defaultCacheBehavior: {
    targetOriginId: originId,
    viewerProtocolPolicy: "redirect-to-https",
    allowedMethods: ["GET", "HEAD", "OPTIONS"],
    cachedMethods: ["GET", "HEAD"],
    compress: true,
    cachePolicyId: CACHING_OPTIMIZED,
    responseHeadersPolicyId: cors.id,
  },
  restrictions: { geoRestriction: { restrictionType: "none" } },
  viewerCertificate: { cloudfrontDefaultCertificate: true },
  tags,
})

new aws.s3.BucketPolicy("media", {
  bucket: bucket.id,
  policy: pulumi.jsonStringify({
    Version: "2012-10-17",
    Statement: [{
      Sid: "CloudFrontReadsMedia",
      Effect: "Allow",
      Principal: { Service: "cloudfront.amazonaws.com" },
      Action: "s3:GetObject",
      Resource: pulumi.interpolate`${bucket.arn}/*`,
      Condition: { StringEquals: { "AWS:SourceArn": distribution.arn } },
    }],
  }),
}, { dependsOn: [publicAccessBlock] })

export const bucketName = bucket.bucket
export const distributionId = distribution.id
export const mediaOrigin = pulumi.interpolate`https://${distribution.domainName}`
