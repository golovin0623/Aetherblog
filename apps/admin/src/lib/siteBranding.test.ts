import { describe, expect, it } from 'vitest';
import { DEFAULT_SITE_NAME, resolveSiteDescription, resolveSiteLogo, resolveSiteName } from './siteBranding';

describe('admin site branding', () => {
  it('prefers the backend-managed snake_case site name', () => {
    expect(resolveSiteName({
      site_name: '  My Managed Blog  ',
      siteName: 'Legacy Name',
      siteTitle: 'Legacy Title',
    })).toBe('My Managed Blog');
  });

  it('falls back through supported legacy name aliases', () => {
    expect(resolveSiteName({ siteName: 'Camel Name' })).toBe('Camel Name');
    expect(resolveSiteName({ siteTitle: 'Camel Title' })).toBe('Camel Title');
    expect(resolveSiteName({ site_name: '   ' })).toBe(DEFAULT_SITE_NAME);
  });

  it('normalizes description and logo values for shared admin branding', () => {
    expect(resolveSiteDescription({ site_description: '  Console copy  ' })).toBe('Console copy');
    expect(resolveSiteLogo({ site_logo: '/uploads/logo.png' })).toBe('/api/uploads/logo.png');
    expect(resolveSiteLogo({ site_logo: 'https://cdn.example.com/logo.svg' })).toBe('https://cdn.example.com/logo.svg');
  });
});
