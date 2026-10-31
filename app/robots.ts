import { MetadataRoute } from 'next'
import { getAbsoluteUrl } from '@/lib/seo/site'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/api/', '/en/b2b/', '/ru/b2b/', '/ky/b2b/'],
    },
    sitemap: getAbsoluteUrl('/sitemap.xml'),
  }
}
